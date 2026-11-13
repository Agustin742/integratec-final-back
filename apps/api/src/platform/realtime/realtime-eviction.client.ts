import { Logger } from '@nestjs/common';

export const REALTIME_EVICTION_PORT = Symbol('REALTIME_EVICTION_PORT');

/** What to evict: a user's connections, optionally narrowed to a classroom or an account session. */
export interface EvictionRequest {
  userId: string;
  classroomId?: string;
  sessionId?: string;
}

/** Asks the realtime server to close the live connections of a user who lost access. */
export interface RealtimeEvictionPort {
  /** Resolves when the realtime server accepted the eviction; rejects so the outbox retries. */
  evict(request: EvictionRequest): Promise<void>;
}

/** Why an eviction call failed: the realtime server answered with an error, was slow, or was not reached. */
export type RealtimeEvictionFailureKind = 'http' | 'timeout' | 'unreachable' | 'invalid_event';

/**
 * Names the failure kind (and the HTTP status when there was one) so a configuration fault, such as
 * a 401 from a rotated secret, can be told apart from an outage. Still generic otherwise: the outbox
 * stores handler error messages, and neither the secret, a user id nor the underlying cause may end
 * up in that table or in a log.
 */
export class RealtimeEvictionError extends Error {
  constructor(
    readonly kind: RealtimeEvictionFailureKind,
    readonly status?: number,
  ) {
    super(`realtime eviction failed: ${kind === 'http' ? `http ${status}` : kind}`);
    this.name = 'RealtimeEvictionError';
  }
}

const EVICTION_PATH = '/internal/evictions';
const SERVICE_SECRET_HEADER = 'x-internal-service-secret';
const DEFAULT_TIMEOUT_MS = 5000;

export interface HttpRealtimeEvictionClientOptions {
  /** Base URL of the realtime server on the private network, e.g. `http://realtime:2567`. */
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** Calls the internal eviction route of the realtime server (never reachable from outside). */
export class HttpRealtimeEvictionClient implements RealtimeEvictionPort {
  private readonly url: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger = new Logger(HttpRealtimeEvictionClient.name);

  constructor(options: HttpRealtimeEvictionClientOptions) {
    const url = new URL(options.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${EVICTION_PATH}`;
    this.url = url.toString();
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async evict(request: EvictionRequest): Promise<void> {
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
          body: JSON.stringify(request),
          signal: controller.signal,
        });
      } catch {
        throw new RealtimeEvictionError(controller.signal.aborted ? 'timeout' : 'unreachable');
      }
      if (!response.ok) throw new RealtimeEvictionError('http', response.status);
    } catch (error) {
      const failure =
        error instanceof RealtimeEvictionError ? error : new RealtimeEvictionError('unreachable');
      // Kind and status only: no user id, no secret, no cause.
      this.logger.warn({
        operation: 'realtime.eviction.failed',
        kind: failure.kind,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}
