import { Logger } from '@nestjs/common';
import type { ClassroomTutorBotSkinChangedPayload } from './realtime-events';

export const REALTIME_TUTOR_BOT_SKIN_PORT = Symbol('REALTIME_TUTOR_BOT_SKIN_PORT');

/** A classroom's tutor bot skin and its revision, as pushed to its live rooms (#154). */
export type TutorBotSkinUpdateRequest = ClassroomTutorBotSkinChangedPayload;

/** Asks the realtime server to repaint the tutor bot of a live classroom (#154). */
export interface RealtimeTutorBotSkinPort {
  /** Resolves when the realtime server accepted the update; rejects so the outbox retries. */
  applyTutorBotSkin(request: TutorBotSkinUpdateRequest): Promise<void>;
}

/** Why a skin call failed: the realtime server answered with an error, was slow, or was not reached. */
export type RealtimeTutorBotSkinFailureKind = 'http' | 'timeout' | 'unreachable' | 'invalid_event';

/**
 * Names the failure kind (and the HTTP status when there was one) but nothing else: the outbox
 * stores handler error messages, and neither the secret, a classroom id nor the underlying cause
 * may end up in that table or in a log. Mirrors `RealtimeAppearanceError`.
 */
export class RealtimeTutorBotSkinError extends Error {
  constructor(
    readonly kind: RealtimeTutorBotSkinFailureKind,
    readonly status?: number,
  ) {
    super(`realtime tutor bot skin failed: ${kind === 'http' ? `http ${status}` : kind}`);
    this.name = 'RealtimeTutorBotSkinError';
  }
}

const TUTOR_BOT_SKIN_PATH = '/internal/classroom-tutor-bot-skin';
const SERVICE_SECRET_HEADER = 'x-internal-service-secret';
const DEFAULT_TIMEOUT_MS = 5000;

export interface HttpRealtimeTutorBotSkinClientOptions {
  /** Base URL of the realtime server on the private network, e.g. `http://realtime:2567`. */
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Calls the internal tutor bot skin route of the realtime server (never reachable from
 * outside). Mirrors `HttpRealtimeAppearanceClient`.
 */
export class HttpRealtimeTutorBotSkinClient implements RealtimeTutorBotSkinPort {
  private readonly url: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger = new Logger(HttpRealtimeTutorBotSkinClient.name);

  constructor(options: HttpRealtimeTutorBotSkinClientOptions) {
    const url = new URL(options.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${TUTOR_BOT_SKIN_PATH}`;
    this.url = url.toString();
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async applyTutorBotSkin(request: TutorBotSkinUpdateRequest): Promise<void> {
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
        throw new RealtimeTutorBotSkinError(controller.signal.aborted ? 'timeout' : 'unreachable');
      }
      if (!response.ok) throw new RealtimeTutorBotSkinError('http', response.status);
    } catch (error) {
      const failure =
        error instanceof RealtimeTutorBotSkinError
          ? error
          : new RealtimeTutorBotSkinError('unreachable');
      // Kind and status only: no classroom id, no secret, no cause.
      this.logger.warn({
        operation: 'realtime.tutor-bot-skin.failed',
        kind: failure.kind,
        ...(failure.status === undefined ? {} : { status: failure.status }),
      });
      throw failure;
    } finally {
      clearTimeout(timer);
    }
  }
}
