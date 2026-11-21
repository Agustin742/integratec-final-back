import { Logger } from '@nestjs/common';
import type { ChatRealtimeBroadcast } from '@aula/contracts';

export const REALTIME_CHAT_BROADCAST_PORT = Symbol('REALTIME_CHAT_BROADCAST_PORT');

export interface RealtimeChatBroadcastPort {
  broadcast(event: ChatRealtimeBroadcast): Promise<void>;
}

export type RealtimeChatBroadcastFailureKind = 'http' | 'timeout' | 'unreachable';

export class RealtimeChatBroadcastError extends Error {
  constructor(
    readonly kind: RealtimeChatBroadcastFailureKind,
    readonly status?: number,
  ) {
    super(`realtime chat broadcast failed: ${kind === 'http' ? `http ${status}` : kind}`);
    this.name = 'RealtimeChatBroadcastError';
  }
}

const CHAT_EVENTS_PATH = '/internal/chat-events';
const SERVICE_SECRET_HEADER = 'x-internal-service-secret';
const DEFAULT_TIMEOUT_MS = 5000;

export interface HttpRealtimeChatBroadcastClientOptions {
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Calls the authenticated internal Colyseus endpoint for committed chat events. */
export class HttpRealtimeChatBroadcastClient implements RealtimeChatBroadcastPort {
  private readonly url: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger = new Logger(HttpRealtimeChatBroadcastClient.name);

  constructor(options: HttpRealtimeChatBroadcastClientOptions) {
    const url = new URL(options.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${CHAT_EVENTS_PATH}`;
    this.url = url.toString();
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async broadcast(event: ChatRealtimeBroadcast): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SERVICE_SECRET_HEADER]: this.serviceSecret,
          },
          body: JSON.stringify(event),
          signal: controller.signal,
        });
      } catch {
        throw new RealtimeChatBroadcastError(controller.signal.aborted ? 'timeout' : 'unreachable');
      }
      if (!response.ok) throw new RealtimeChatBroadcastError('http', response.status);
    } catch (error) {
      const failure =
        error instanceof RealtimeChatBroadcastError
          ? error
          : new RealtimeChatBroadcastError('unreachable');
      this.logger.warn({
        operation: 'realtime.chat-broadcast.failed',
        kind: failure.kind,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}
