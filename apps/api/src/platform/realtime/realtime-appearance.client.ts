import { Logger } from '@nestjs/common';
import type { MemberAppearance } from '@aula/contracts';

export const REALTIME_APPEARANCE_PORT = Symbol('REALTIME_APPEARANCE_PORT');

/** A member's new public appearance in one classroom, as broadcast to the live room (#114). */
export interface AppearanceUpdateRequest {
  classroomId: string;
  userId: string;
  appearance: MemberAppearance;
}

/** Asks the realtime server to apply an appearance change already committed by NestJS (#114). */
export interface RealtimeAppearancePort {
  /** Resolves when the realtime server accepted the update; rejects so the outbox retries. */
  applyAppearance(request: AppearanceUpdateRequest): Promise<void>;
}

/** Why an appearance call failed: the realtime server answered with an error, was slow, or was not reached. */
export type RealtimeAppearanceFailureKind = 'http' | 'timeout' | 'unreachable' | 'invalid_event';

/**
 * Names the failure kind (and the HTTP status when there was one) so a configuration fault, such
 * as a 401 from a rotated secret, can be told apart from an outage. Still generic otherwise: the
 * outbox stores handler error messages, and neither the secret, a user id nor the underlying cause
 * may end up in that table or in a log. Mirrors `RealtimeEvictionError`.
 */
export class RealtimeAppearanceError extends Error {
  constructor(
    readonly kind: RealtimeAppearanceFailureKind,
    readonly status?: number,
  ) {
    super(`realtime appearance failed: ${kind === 'http' ? `http ${status}` : kind}`);
    this.name = 'RealtimeAppearanceError';
  }
}

const APPEARANCE_PATH = '/internal/appearance';
const SERVICE_SECRET_HEADER = 'x-internal-service-secret';
const DEFAULT_TIMEOUT_MS = 5000;

export interface HttpRealtimeAppearanceClientOptions {
  /** Base URL of the realtime server on the private network, e.g. `http://realtime:2567`. */
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Calls the internal appearance route of the realtime server (never reachable from outside).
 * Mirrors `HttpRealtimeEvictionClient`.
 */
export class HttpRealtimeAppearanceClient implements RealtimeAppearancePort {
  private readonly url: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger = new Logger(HttpRealtimeAppearanceClient.name);

  constructor(options: HttpRealtimeAppearanceClientOptions) {
    const url = new URL(options.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${APPEARANCE_PATH}`;
    this.url = url.toString();
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async applyAppearance(request: AppearanceUpdateRequest): Promise<void> {
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
        throw new RealtimeAppearanceError(controller.signal.aborted ? 'timeout' : 'unreachable');
      }
      if (!response.ok) throw new RealtimeAppearanceError('http', response.status);
    } catch (error) {
      const failure =
        error instanceof RealtimeAppearanceError
          ? error
          : new RealtimeAppearanceError('unreachable');
      // Kind and status only: no user id, no secret, no cause.
      this.logger.warn({
        operation: 'realtime.appearance.failed',
        kind: failure.kind,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}
