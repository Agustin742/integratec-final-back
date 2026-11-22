import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_AI_REQUEST_TIMEOUT_SECONDS, type ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { CHAT_MODEL_PORT, type ChatModelPort } from './ai-provider.ports';
import {
  type DailyQuestionInferenceInput,
  type DailyReviewInferenceInput,
  type DailyReviewInferencePort,
  type GeneratedDailyQuestion,
} from './daily-review-inference.port';

/** The response summary is bounded to the contract's `summary` max length (issue #119). */
const SUMMARY_MAX_CHARS = 400;
/** Bounded prompt: sections are already capped by composition; these caps are a second line. */
const PROMPT_MAX_SECTIONS = 2;
const PROMPT_MAX_ITEMS = 5;
const PROMPT_MAX_FIELD_CHARS = 120;
/** Bounded question prompt: material list capped so a huge classroom cannot flood it. */
const PROMPT_MAX_MATERIALS = 10;

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
 * External AI provider adapter for the daily-review summary and daily question
 * (HU-BOT-003, D20). Delegates completion calls to `CHAT_MODEL_PORT` (the configured
 * OpenAI-compatible provider, `rules/ai-bot-and-daily-briefing.md`).
 *
 * Fails closed: ANY error, timeout, throttle or invalid output returns `null`, which the
 * delivery engine turns into the structured fallback that still counts as delivered.
 * Logs only the operation, user id, outcome and latency: prompt and response content are
 * never logged (`rules/observability-and-privacy.md`).
 */
@Injectable()
export class AiDailyReviewInferenceAdapter implements DailyReviewInferencePort {
  private readonly logger = new Logger(AiDailyReviewInferenceAdapter.name);
  private readonly timeoutMs: number;

  constructor(
    @Inject(CHAT_MODEL_PORT) private readonly chatModel: ChatModelPort,
    @Inject(API_CONFIG) config: Pick<ApiConfig, 'aiRequestTimeoutSeconds'>,
  ) {
    this.timeoutMs = (config.aiRequestTimeoutSeconds ?? DEFAULT_AI_REQUEST_TIMEOUT_SECONDS) * 1000;
  }

  async generateSummary(input: DailyReviewInferenceInput): Promise<string | null> {
    const startedAt = Date.now();
    try {
      const prompt = this.buildPrompt(input);
      // Nothing composed means nothing to summarize honestly: fail closed to the
      // structured fallback instead of letting the model invent filler.
      if (prompt === null) return null;

      const response = await this.chatModel.chatCompletion({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        timeoutMs: this.timeoutMs,
      });
      const summary = this.parseSummary(response.content);
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
      // to log; provider messages may echo request fields, so they are not logged.
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

      const response = await this.chatModel.chatCompletion({
        messages: [
          { role: 'system', content: QUESTION_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        timeoutMs: this.timeoutMs,
      });
      const question = this.parseQuestion(response.content);
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

  /**
   * Defensive response parsing: any empty, non-string, or oversized output is bounded
   * or converted to `null`, never a crash and never unbounded text.
   */
  private parseSummary(content: string | null): string | null {
    if (typeof content !== 'string') return null;
    // The model occasionally wraps the paragraph in quotes; strip that artifact.
    const trimmed = content
      .trim()
      .replace(/^"+|"+$/g, '')
      .trim();
    if (trimmed.length === 0) return null;
    return trimmed.slice(0, SUMMARY_MAX_CHARS);
  }

  /**
   * Defensive JSON extraction for the question path: code fences are stripped, and
   * every field is type-checked before it becomes a {@link GeneratedDailyQuestion}.
   * Domain bounds (lengths, option counts, key membership) are re-validated by the
   * caller before persisting.
   */
  private parseQuestion(content: string | null): GeneratedDailyQuestion | null {
    if (typeof content !== 'string') return null;
    // Models occasionally wrap JSON in a code fence; strip the wrapper only.
    const stripped = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      return null;
    }
    if (typeof parsed !== 'object' || parsed === null) return null;
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
      return null;
    }
    if (
      candidate.materialTitle !== null &&
      typeof candidate.materialTitle !== 'string' &&
      candidate.materialTitle !== undefined
    ) {
      return null;
    }
    return {
      prompt: candidate.prompt,
      options: candidate.options as string[],
      correctOption: candidate.correctOption,
      materialTitle:
        candidate.materialTitle === undefined || candidate.materialTitle === null
          ? null
          : candidate.materialTitle,
    };
  }
}
