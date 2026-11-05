import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER } from './error-envelope';

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_LOGGED_PATH_LENGTH = 200;

export function resolveCorrelationId(incoming: unknown): string {
  return typeof incoming === 'string' && SAFE_CORRELATION_ID.test(incoming)
    ? incoming
    : randomUUID();
}

/**
 * Assigns the correlation id and writes one JSON log line per request when the
 * response finishes. Only method, path (no query string), status, duration and
 * id are logged: never bodies, headers, cookies or query values.
 */
export function createRequestContextMiddleware(write: (line: string) => void) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);
    const startedAt = process.hrtime.bigint();

    let logged = false;
    const log = (aborted: boolean): void => {
      if (logged) return;
      logged = true;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      write(
        JSON.stringify({
          level: 'info',
          event: 'http_request',
          method: request.method,
          path: request.originalUrl.split('?')[0].slice(0, MAX_LOGGED_PATH_LENGTH),
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          correlationId,
          ...(aborted ? { aborted: true } : {}),
        }),
      );
    };

    response.on('finish', () => log(false));
    // 'close' without a prior 'finish' means the client went away mid-request.
    response.on('close', () => log(true));

    next();
  };
}
