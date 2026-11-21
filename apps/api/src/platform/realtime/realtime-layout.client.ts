import { Logger } from '@nestjs/common';

export const REALTIME_LAYOUT_PORT = Symbol('REALTIME_LAYOUT_PORT');

/** A classroom's desk count after desks were added, as pushed to its live rooms (#79). */
export interface LayoutUpdateRequest {
  classroomId: string;
  deskCount: number;
}

/** Asks the realtime server to rebuild a live classroom layout after desks were added (#79). */
export interface RealtimeLayoutPort {
  /** Resolves when the realtime server accepted the update; rejects so the outbox retries. */
  applyDeskCount(request: LayoutUpdateRequest): Promise<void>;
}

/** Why a layout call failed: the realtime server answered with an error, was slow, or was not reached. */
export type RealtimeLayoutFailureKind = 'http' | 'timeout' | 'unreachable' | 'invalid_event';

/**
 * Names the failure kind (and the HTTP status when there was one) but nothing else: the outbox
 * stores handler error messages, and neither the secret, a classroom id nor the underlying cause
 * may end up in that table or in a log. Mirrors `RealtimeAppearanceError`.
 */
export class RealtimeLayoutError extends Error {
  constructor(
    readonly kind: RealtimeLayoutFailureKind,
    readonly status?: number,
  ) {
    super(`realtime layout failed: ${kind === 'http' ? `http ${status}` : kind}`);
    this.name = 'RealtimeLayoutError';
  }
}

const LAYOUT_PATH = '/internal/classroom-layout';
const SERVICE_SECRET_HEADER = 'x-internal-service-secret';
const DEFAULT_TIMEOUT_MS = 5000;

export interface HttpRealtimeLayoutClientOptions {
  /** Base URL of the realtime server on the private network, e.g. `http://realtime:2567`. */
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Calls the internal classroom-layout route of the realtime server (never reachable from
 * outside). Mirrors `HttpRealtimeAppearanceClient`.
 */
export class HttpRealtimeLayoutClient implements RealtimeLayoutPort {
  private readonly url: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger = new Logger(HttpRealtimeLayoutClient.name);

  constructor(options: HttpRealtimeLayoutClientOptions) {
    const url = new URL(options.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${LAYOUT_PATH}`;
    this.url = url.toString();
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async applyDeskCount(request: LayoutUpdateRequest): Promise<void> {
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
        throw new RealtimeLayoutError(controller.signal.aborted ? 'timeout' : 'unreachable');
      }
      if (!response.ok) throw new RealtimeLayoutError('http', response.status);
    } catch (error) {
      const failure =
        error instanceof RealtimeLayoutError ? error : new RealtimeLayoutError('unreachable');
      // Kind and status only: no classroom id, no secret, no cause.
      this.logger.warn({
        operation: 'realtime.layout.failed',
        kind: failure.kind,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}
