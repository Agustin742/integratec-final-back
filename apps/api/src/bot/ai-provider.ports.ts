export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  id: string;
  name: string;
  argumentsJson: string;
  /**
   * Opaque provider data attached to this call. Callers MUST return it unchanged with
   * the same call on later turns, and MUST NOT inspect or log it.
   */
  providerContext?: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  toolCallId?: string;
  toolCalls?: ChatToolCall[];
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  /** Optional remaining request-deadline budget in milliseconds. */
  timeoutMs?: number;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ChatToolCall[];
  usage: ChatUsage;
}

export interface ChatModelPort {
  chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

export interface EmbeddingResult {
  vectors: number[][];
  totalTokens: number;
}

export interface EmbeddingRequestOptions {
  /** Optional remaining request-deadline budget in milliseconds. */
  timeoutMs?: number;
}

export interface EmbeddingModelPort {
  embed(texts: string[], options?: EmbeddingRequestOptions): Promise<EmbeddingResult>;
}

/** Injection tokens for external AI provider ports. */
export const CHAT_MODEL_PORT = Symbol('CHAT_MODEL_PORT');
export const EMBEDDING_MODEL_PORT = Symbol('EMBEDDING_MODEL_PORT');

/** Thrown when the external AI provider is unconfigured, unreachable, throttled, or returns invalid output. */
export class AiProviderUnavailableError extends Error {
  constructor(message = 'External AI provider is temporarily unavailable') {
    super(message);
    this.name = 'AiProviderUnavailableError';
  }
}
