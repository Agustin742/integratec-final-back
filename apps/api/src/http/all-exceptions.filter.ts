import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CORRELATION_ID_HEADER,
  ERROR_CODES,
  type ErrorCode,
  type ErrorEnvelope,
} from './error-envelope';
import { RequestValidationException } from './validation';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ERROR_CODES.BAD_REQUEST,
  401: ERROR_CODES.UNAUTHENTICATED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  429: ERROR_CODES.TOO_MANY_REQUESTS,
  503: ERROR_CODES.SERVICE_UNAVAILABLE,
};

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'The request is invalid. Check the details and try again.',
  BAD_REQUEST: 'The request could not be understood.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You are not allowed to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  TOO_MANY_REQUESTS: 'Too many requests. Try again later.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Try again later.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

/**
 * Body-parser / http-errors style client errors (e.g. malformed JSON) carry a 4xx
 * status and `expose: true` but are not HttpExceptions. Any other object with a
 * numeric `status` is not trusted.
 */
function exposedClientStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, statusCode, expose } = exception as Record<string, unknown>;
  const value = typeof status === 'number' ? status : statusCode;
  return expose === true && typeof value === 'number' && value >= 400 && value < 500
    ? value
    : undefined;
}

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  return exposedClientStatus(exception) ?? 500;
}

/**
 * Server-side diagnostic text for the log only: the exception message and, when
 * present, its cause (name, message and stack). Never sent to the client and
 * never built from request data.
 */
function describeFailure(exception: unknown): string {
  if (!(exception instanceof Error)) return '';
  let text = `: ${exception.message}`;
  const { cause } = exception;
  if (cause instanceof Error) {
    text += ` | cause ${cause.name}: ${cause.message}\n${cause.stack ?? ''}`;
  } else if (cause !== undefined) {
    text += ` | cause: ${String(cause)}`;
  }
  return text;
}

/**
 * Turns every thrown error into the single `ErrorEnvelope`. Messages are fixed
 * per code on purpose: exception messages and stacks never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const correlationId = String(response.getHeader(CORRELATION_ID_HEADER) ?? '');

    let status = statusOf(exception);
    let code: ErrorCode = CODE_BY_STATUS[status] ?? ERROR_CODES.INTERNAL_ERROR;
    if (code === ERROR_CODES.INTERNAL_ERROR && status < 500) {
      code = ERROR_CODES.BAD_REQUEST; // unmapped 4xx keeps its own status
    }
    const where = `${request.method} ${request.path} (${correlationId})`;
    if (code === ERROR_CODES.SERVICE_UNAVAILABLE) {
      // An intentional, expected 503: not an unhandled failure.
      this.logger.warn(`Service unavailable on ${where}${describeFailure(exception)}`);
    } else if (code === ERROR_CODES.INTERNAL_ERROR) {
      status = 500;
      // Server-side only: the stack helps debugging; the request is identified by path and id.
      this.logger.error(
        `Unhandled exception on ${where}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (response.headersSent) {
      // Too late to send an envelope. Ending normally would present a truncated
      // body as complete, so abort the connection and let the client see the failure.
      this.logger.warn(`Headers already sent, connection aborted on ${where}`);
      response.destroy();
      return;
    }

    const body: ErrorEnvelope = { error: { code, message: SAFE_MESSAGES[code], correlationId } };
    if (exception instanceof RequestValidationException) {
      body.error.code = ERROR_CODES.VALIDATION_FAILED;
      body.error.message = SAFE_MESSAGES.VALIDATION_FAILED;
      body.error.details = exception.details;
    }

    response.status(status).json(body);
  }
}
