import { SERVICE_SECRET_HEADER } from '../join/api-join-verifier';

/** One aggregate: how long a user was connected to a classroom during one presence session. */
export interface ConnectedTimeEntry {
  userId: string;
  classroomId: string;
  connectedSeconds: number;
  /** ISO 8601 UTC instant at which the presence session ended. */
  endedAt: string;
}

/** Hands connected-time aggregates to the service that owns durable data. */
export interface ConnectedTimeReporter {
  /** Rejects when the aggregate could not be delivered; the caller decides what to do about it. */
  report(entry: ConnectedTimeEntry): Promise<void>;
}

/** Reporter used when none is configured (tests that do not care about connected time). */
export const noopConnectedTimeReporter: ConnectedTimeReporter = {
  report: () => Promise.resolve(),
};

const REPORT_PATH = '/internal/realtime/connected-time';
export const DEFAULT_REPORT_TIMEOUT_MS = 3000;

export interface ApiConnectedTimeReporterOptions {
  /** Base URL of the NestJS API, e.g. `http://api:3000`. */
  baseUrl: string;
  serviceSecret: string;
  timeoutMs?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Posts aggregates to the internal NestJS endpoint. Every failure becomes one generic error with no
 * cause, so neither the secret nor a user id can leak through a log of the failure.
 */
export class ApiConnectedTimeReporter implements ConnectedTimeReporter {
  private readonly url: string;
  private readonly serviceSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiConnectedTimeReporterOptions) {
    const url = new URL(options.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${REPORT_PATH}`;
    this.url = url.toString();
    this.serviceSecret = options.serviceSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REPORT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async report(entry: ConnectedTimeEntry): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SERVICE_SECRET_HEADER]: this.serviceSecret,
        },
        body: JSON.stringify(entry),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
    } catch {
      throw new Error('Connected time report failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
