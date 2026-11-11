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

/**
 * Generic on purpose: the outbox stores handler error messages, and neither the secret nor a
 * user id may end up in that table.
 */
export class RealtimeEvictionError extends Error {
  constructor() {
    super('realtime eviction failed');
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
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SERVICE_SECRET_HEADER]: this.serviceSecret,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
    } catch {
      throw new RealtimeEvictionError();
    } finally {
      clearTimeout(timer);
    }
  }
}
