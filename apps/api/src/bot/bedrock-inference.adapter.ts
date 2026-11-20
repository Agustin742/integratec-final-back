import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  type InvokeModelCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import {
  type DailyQuestionInferenceInput,
  type DailyReviewInferenceInput,
  type DailyReviewInferencePort,
  type GeneratedDailyQuestion,
} from './daily-review-inference.port';

/** Config defaults (decision L3): in-Region on-demand model reachable from an AWS Free plan. */
const DEFAULT_MODEL_ID = 'amazon.nova-micro-v1:0';
const DEFAULT_REGION = 'us-east-2';
const DEFAULT_TIMEOUT_SECONDS = 15;

/** The response summary is bounded to the contract's `summary` max length (issue #119). */
const SUMMARY_MAX_CHARS = 400;
/** Bounded generation: enough tokens for a 400-character Spanish paragraph, no more. */
const SUMMARY_MAX_TOKENS = 300;
/** Bounded prompt: sections are already capped by composition; these caps are a second line. */
const PROMPT_MAX_SECTIONS = 2;
const PROMPT_MAX_ITEMS = 5;
const PROMPT_MAX_FIELD_CHARS = 120;
/** Bounded question prompt: material list capped so a huge classroom cannot flood it. */
const PROMPT_MAX_MATERIALS = 10;
/** Bounded question generation: prompt + options + key fit comfortably, no more. */
const QUESTION_MAX_TOKENS = 400;

const SYSTEM_PROMPT =
  'You write the daily review summary for a school platform user (many students are minors). ' +
  'Write in Spanish, rioplatense-friendly, using a natural tone for Argentina. ' +
  'Produce ONE plain-text paragraph of at most 400 characters: no markdown, no lists, no greetings, ' +
  'no signatures, no emojis. Use ONLY the section rows provided; never invent activities, grades, ' +
  'dates, names or results, and never reveal or guess answer keys or solutions. Address the user ' +
  'directly with a warm, encouraging tone and propose concrete next steps: you are a study guide, ' +
  'so motivate and point, never solve.';

const QUESTION_SYSTEM_PROMPT =
  'You write one multiple-choice study question for a school platform student (many students ' +
  'are minors), based ONLY on the enabled material titles provided. Write in Spanish, ' +
  'rioplatense-friendly. Respond with ONE JSON object and NOTHING else: ' +
  '{"prompt": string, "options": string[], "correctOption": string, "materialTitle": string | null}. ' +
  'The prompt asks about a concept present in the material titles, never about the file itself, ' +
  'and is at most 280 characters. There are 2 to 6 distinct options, each at most 120 characters; ' +
  'exactly one is correct and `correctOption` repeats that option text verbatim. ' +
  '`materialTitle` names the material the question came from, or null. You are a study guide: ' +
  'the question teaches and checks understanding; it never asks for personal data, never ' +
  'trivially repeats a title, and never includes the answer inside the prompt.';

/**
 * Bedrock adapter for the daily-review summary (HU-BOT-003, S2/S6). Invoked only from
 * NestJS with the service's IAM role (`rules/ai-bot-and-daily-briefing.md`); without
 * configured keys the SDK default provider chain resolves the instance role, exactly
 * like the S3 adapter.
 *
 * Fails closed: ANY error, timeout, throttle or invalid output returns `null`, which the
 * delivery engine turns into the structured fallback that still counts as delivered.
 * Logs only the operation, user id, outcome and latency: prompt and response content are
 * never logged (`rules/observability-and-privacy.md`).
 */
@Injectable()
export class BedrockInferenceAdapter implements DailyReviewInferencePort, OnModuleDestroy {
  private readonly logger = new Logger(BedrockInferenceAdapter.name);
  private readonly client: BedrockRuntimeClient;
  private readonly modelId: string;
  private readonly timeoutMs: number;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.modelId = config.bedrockModelId ?? DEFAULT_MODEL_ID;
    this.timeoutMs = (config.bedrockInferenceTimeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
    this.client = new BedrockRuntimeClient({ region: config.bedrockRegion ?? DEFAULT_REGION });
  }

  async generateSummary(input: DailyReviewInferenceInput): Promise<string | null> {
    const startedAt = Date.now();
    try {
      const prompt = this.buildPrompt(input);
      // Nothing composed means nothing to summarize honestly: fail closed to the
      // structured fallback instead of letting the model invent filler.
      if (prompt === null) return null;

      const response = await this.invokeWithTimeout(SYSTEM_PROMPT, prompt, SUMMARY_MAX_TOKENS);
      const summary = this.parseSummary(response);
      this.logger.log({
        operation: 'dailyReview.generateSummary',
        userId: input.userId,
        outcome: summary === null ? 'fallback' : 'generated',
        latencyMs: Date.now() - startedAt,
      });
      return summary;
    } catch (error) {
      // Any failure cause (down provider, throttle, timeout, malformed response) is the
      // same decision for the caller: null = structured fallback. The error name is safe
      // to log; SDK messages may echo request fields, so they are not logged.
      this.logger.warn({
        operation: 'dailyReview.generateSummary',
        userId: input.userId,
        outcome: 'fallback',
        latencyMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }

  async generateDailyQuestion(
    input: DailyQuestionInferenceInput,
  ): Promise<GeneratedDailyQuestion | null> {
    const startedAt = Date.now();
    try {
      const prompt = this.buildQuestionPrompt(input);
      // Without material titles there is nothing honest to ask about: fail closed.
      if (prompt === null) return null;

      const response = await this.invokeWithTimeout(
        QUESTION_SYSTEM_PROMPT,
        prompt,
        QUESTION_MAX_TOKENS,
      );
      const question = this.parseQuestion(response);
      this.logger.log({
        operation: 'dailyReview.generateDailyQuestion',
        userId: input.userId,
        outcome: question === null ? 'fallback' : 'generated',
        latencyMs: Date.now() - startedAt,
      });
      return question;
    } catch (error) {
      // Same fail-closed contract as the summary path; content never logged.
      this.logger.warn({
        operation: 'dailyReview.generateDailyQuestion',
        userId: input.userId,
        outcome: 'fallback',
        latencyMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  /**
   * Builds the user turn from the composed sections only: titles, classroom names and
   * due dates the user may already see through the same services REST uses. Sections
   * and items are re-capped so a composition bug can never flood the prompt.
   */
  private buildPrompt(input: DailyReviewInferenceInput): string | null {
    const bounded = input.sections.slice(0, PROMPT_MAX_SECTIONS);
    if (bounded.every((section) => section.items.length === 0)) return null;

    const line = (text: string): string => text.slice(0, PROMPT_MAX_FIELD_CHARS);
    const lines: string[] = [`audience: ${input.audience.toLowerCase()}`];
    for (const section of bounded) {
      lines.push(`${section.kind}:`);
      for (const item of section.items.slice(0, PROMPT_MAX_ITEMS)) {
        const due = item.dueAt === null ? '' : ` (due ${item.dueAt})`;
        lines.push(`- [${line(item.classroomName)}] ${line(item.title)}${due}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * Builds the question user turn from the enabled material list only: titles and
   * classroom names the student may already see. Re-capped defensively so a
   * composition bug can never flood the prompt.
   */
  private buildQuestionPrompt(input: DailyQuestionInferenceInput): string | null {
    const bounded = input.materials.slice(0, PROMPT_MAX_MATERIALS);
    if (bounded.length === 0) return null;
    const line = (text: string): string => text.slice(0, PROMPT_MAX_FIELD_CHARS);
    const lines: string[] = ['enabled material:'];
    for (const material of bounded) {
      lines.push(`- [${line(material.classroomName)}] ${line(material.title)}`);
    }
    return lines.join('\n');
  }

  /** One bounded-time invoke: the SDK call never outlives `bedrockInferenceTimeoutSeconds`. */
  private async invokeWithTimeout(
    systemPrompt: string,
    prompt: string,
    maxTokens: number,
  ): Promise<InvokeModelCommandOutput> {
    const body = JSON.stringify({
      schemaVersion: 'messages-v1',
      system: [{ text: systemPrompt }],
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens, temperature: 0.3, topP: 0.9 },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: InvokeModelCommandOutput;
    try {
      response = await Promise.race([
        this.client.send(
          new InvokeModelCommand({
            modelId: this.modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: new TextEncoder().encode(body),
          }),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Bedrock inference timed out')),
            this.timeoutMs,
          );
        }),
      ]);
      return response;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /**
   * Defensive response parsing: every hop is checked, so any unexpected shape, non-text
   * content block, JSON error, empty or oversized output is an invalid `null`, never a
   * crash and never unbounded text.
   */
  private parseSummary(response: { body: Uint8Array }): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      return null;
    }
    const blocks = (parsed as { output?: { message?: { content?: unknown } } })?.output?.message
      ?.content;
    if (!Array.isArray(blocks)) return null;
    for (const block of blocks) {
      const text = (block as { text?: unknown })?.text;
      if (typeof text !== 'string') continue;
      // The model occasionally wraps the paragraph in quotes; strip that artifact.
      const trimmed = text
        .trim()
        .replace(/^"+|"+$/g, '')
        .trim();
      if (trimmed.length > 0) return trimmed.slice(0, SUMMARY_MAX_CHARS);
    }
    return null;
  }

  /**
   * Defensive JSON extraction for the question path: the message text is pulled
   * structurally, code fences are stripped, and every field is type-checked before
   * it becomes a {@link GeneratedDailyQuestion}. Domain bounds (lengths, option
   * counts, key membership) are re-validated by the caller before persisting.
   */
  private parseQuestion(response: { body: Uint8Array }): GeneratedDailyQuestion | null {
    const blocks = this.textBlocks(response);
    for (const text of blocks) {
      // Models occasionally wrap JSON in a code fence; strip the wrapper only.
      const stripped = text
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        continue;
      }
      const candidate = parsed as {
        prompt?: unknown;
        options?: unknown;
        correctOption?: unknown;
        materialTitle?: unknown;
      };
      if (
        typeof candidate.prompt !== 'string' ||
        !Array.isArray(candidate.options) ||
        candidate.options.some((option) => typeof option !== 'string') ||
        typeof candidate.correctOption !== 'string'
      ) {
        continue;
      }
      if (
        candidate.materialTitle !== null &&
        typeof candidate.materialTitle !== 'string' &&
        candidate.materialTitle !== undefined
      ) {
        continue;
      }
      return {
        prompt: candidate.prompt,
        options: candidate.options as string[],
        correctOption: candidate.correctOption,
        materialTitle:
          candidate.materialTitle === undefined || candidate.materialTitle === null
            ? null
            : (candidate.materialTitle as string),
      };
    }
    return null;
  }

  /** The text content blocks of a Bedrock messages-API response, defensively walked. */
  private textBlocks(response: { body: Uint8Array }): string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(response.body));
    } catch {
      return [];
    }
    const blocks = (parsed as { output?: { message?: { content?: unknown } } })?.output?.message
      ?.content;
    if (!Array.isArray(blocks)) return [];
    const texts: string[] = [];
    for (const block of blocks) {
      const text = (block as { text?: unknown })?.text;
      if (typeof text === 'string') texts.push(text);
    }
    return texts;
  }
}
