import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_AI_CHAT_MODEL,
  DEFAULT_AI_EMBEDDING_DIMENSION,
  DEFAULT_AI_EMBEDDING_MODEL,
  DEFAULT_AI_MAX_RETRIES,
  DEFAULT_AI_PROVIDER_BASE_URL,
  DEFAULT_AI_REQUEST_TIMEOUT_SECONDS,
  type ApiConfig,
} from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import {
  AiProviderUnavailableError,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatModelPort,
  type ChatToolCall,
  type EmbeddingModelPort,
  type EmbeddingRequestOptions,
  type EmbeddingResult,
} from './ai-provider.ports';

export const OPENAI_ADAPTER_HOOKS = Symbol('OPENAI_ADAPTER_HOOKS');

export interface OpenAiAdapterHooks {
  fetchFn?: typeof fetch;
  retryBaseDelayMs?: number;
}

interface RawChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: Array<{
        id?: unknown;
        type?: unknown;
        function?: { name?: unknown; arguments?: unknown };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
  };
}

interface RawEmbeddingsResponse {
  data?: Array<{
    index?: unknown;
    embedding?: unknown;
  }>;
  usage?: {
    total_tokens?: unknown;
  };
}

const DEFAULT_RETRY_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function toWireMessages(messages: readonly ChatMessage[]) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content ?? '',
      };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.argumentsJson },
        })),
      };
    }
    return {
      role: message.role,
      content: message.content ?? '',
    };
  });
}

/**
 * Vendor-neutral OpenAI-compatible REST adapter over Node 22 native `fetch`.
 * Defaults target Google Gemini's OpenAI-compatible endpoints so one server-side
 * key supports both chat+tool calling and embeddings without adding provider SDKs.
 */
@Injectable()
export class OpenAiCompatibleAiAdapter implements ChatModelPort, EmbeddingModelPort {
  private readonly fetchFn: typeof fetch;
  private readonly retryBaseDelayMs: number;

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Optional() @Inject(OPENAI_ADAPTER_HOOKS) hooks?: OpenAiAdapterHooks,
  ) {
    this.fetchFn = hooks?.fetchFn ?? fetch;
    this.retryBaseDelayMs = hooks?.retryBaseDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const model = this.config.aiChatModel ?? DEFAULT_AI_CHAT_MODEL;
    const payload: Record<string, unknown> = {
      model,
      messages: toWireMessages(request.messages),
    };
    if (request.tools && request.tools.length > 0) {
      payload.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      payload.tool_choice = 'auto';
    }

    const raw = (await this.postJson(
      '/chat/completions',
      payload,
      request.timeoutMs,
    )) as RawChatCompletionResponse;
    const choice = Array.isArray(raw.choices) ? raw.choices[0] : undefined;
    const message = choice?.message;
    if (!message || typeof message !== 'object') {
      throw new AiProviderUnavailableError();
    }

    const content = typeof message.content === 'string' ? message.content : null;
    const toolCalls: ChatToolCall[] = [];
    if (Array.isArray(message.tool_calls)) {
      for (const rawCall of message.tool_calls) {
        if (
          typeof rawCall?.id !== 'string' ||
          typeof rawCall?.function?.name !== 'string' ||
          typeof rawCall?.function?.arguments !== 'string'
        ) {
          throw new AiProviderUnavailableError();
        }
        toolCalls.push({
          id: rawCall.id,
          name: rawCall.function.name,
          argumentsJson: rawCall.function.arguments,
        });
      }
    }

    const promptTokens =
      typeof raw.usage?.prompt_tokens === 'number' && Number.isFinite(raw.usage.prompt_tokens)
        ? Math.max(0, Math.trunc(raw.usage.prompt_tokens))
        : 0;
    const completionTokens =
      typeof raw.usage?.completion_tokens === 'number' &&
      Number.isFinite(raw.usage.completion_tokens)
        ? Math.max(0, Math.trunc(raw.usage.completion_tokens))
        : 0;

    return {
      content,
      toolCalls,
      usage: { promptTokens, completionTokens },
    };
  }

  async embed(texts: string[], options?: EmbeddingRequestOptions): Promise<EmbeddingResult> {
    if (texts.length === 0) {
      return { vectors: [], totalTokens: 0 };
    }
    const model = this.config.aiEmbeddingModel ?? DEFAULT_AI_EMBEDDING_MODEL;
    const dimension = this.config.aiEmbeddingDimension ?? DEFAULT_AI_EMBEDDING_DIMENSION;

    const raw = (await this.postJson(
      '/embeddings',
      {
        model,
        input: texts,
        dimensions: dimension,
      },
      options?.timeoutMs,
    )) as RawEmbeddingsResponse;

    if (!Array.isArray(raw.data) || raw.data.length !== texts.length) {
      throw new AiProviderUnavailableError();
    }

    const ordered = new Array<number[]>(texts.length);
    for (const item of raw.data) {
      if (
        typeof item?.index !== 'number' ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= texts.length ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== dimension
      ) {
        throw new AiProviderUnavailableError();
      }
      const vector = item.embedding;
      if (
        !vector.every(
          (value): value is number => typeof value === 'number' && Number.isFinite(value),
        )
      ) {
        throw new AiProviderUnavailableError();
      }
      ordered[item.index] = vector;
    }

    if (ordered.some((vector) => vector === undefined)) {
      throw new AiProviderUnavailableError();
    }

    const totalTokens =
      typeof raw.usage?.total_tokens === 'number' && Number.isFinite(raw.usage.total_tokens)
        ? Math.max(0, Math.trunc(raw.usage.total_tokens))
        : 0;

    return { vectors: ordered, totalTokens };
  }

  private async postJson(path: string, body: unknown, requestTimeoutMs?: number): Promise<unknown> {
    const apiKey = this.config.aiProviderApiKey?.trim();
    if (!apiKey) {
      throw new AiProviderUnavailableError('External AI provider API key is not configured');
    }

    const baseUrl = (this.config.aiProviderBaseUrl ?? DEFAULT_AI_PROVIDER_BASE_URL).replace(
      /\/+$/,
      '',
    );
    const configTimeoutMs =
      (this.config.aiRequestTimeoutSeconds ?? DEFAULT_AI_REQUEST_TIMEOUT_SECONDS) * 1000;
    const effectiveTimeoutMs =
      requestTimeoutMs !== undefined
        ? Math.min(configTimeoutMs, Math.floor(requestTimeoutMs))
        : configTimeoutMs;
    if (effectiveTimeoutMs <= 0) {
      throw new AiProviderUnavailableError('AI request deadline exceeded');
    }

    const deadlineAt = Date.now() + effectiveTimeoutMs;
    const maxRetries = this.config.aiMaxRetries ?? DEFAULT_AI_MAX_RETRIES;
    const serialized = JSON.stringify(body);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw new AiProviderUnavailableError('AI request deadline exceeded');
      }

      try {
        const response = await this.fetchFn(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: serialized,
          signal: AbortSignal.timeout(remainingMs),
        });

        if (response.ok) {
          try {
            return await response.json();
          } catch {
            throw new AiProviderUnavailableError();
          }
        }

        const retryDelay = this.retryBaseDelayMs * (attempt + 1);
        if (
          attempt < maxRetries &&
          isRetryableStatus(response.status) &&
          deadlineAt - Date.now() > retryDelay
        ) {
          await sleep(retryDelay);
          continue;
        }
        throw new AiProviderUnavailableError();
      } catch (error) {
        if (error instanceof AiProviderUnavailableError) {
          throw error;
        }
        const retryDelay = this.retryBaseDelayMs * (attempt + 1);
        if (attempt < maxRetries && deadlineAt - Date.now() > retryDelay) {
          await sleep(retryDelay);
          continue;
        }
        throw new AiProviderUnavailableError();
      }
    }

    throw new AiProviderUnavailableError();
  }
}
