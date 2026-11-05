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
};

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'The request is invalid. Check the details and try again.',
  BAD_REQUEST: 'The request could not be understood.',
  UNAUTHENTICATED: 'Authentication is required.',
  FORBIDDEN: 'You are not allowed to perform this action.',
  NOT_FOUND: 'The requested resource was not found.',
  CONFLICT: 'The request conflicts with the current state of the resource.',
  TOO_MANY_REQUESTS: 'Too many requests. Try again later.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

/** Body-parser errors (e.g. malformed JSON) carry an HTTP status but are not HttpExceptions. */
function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus();
  const status = (exception as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : 500;
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
    if (!(status in CODE_BY_STATUS) && status < 500) {
      code = ERROR_CODES.BAD_REQUEST;
    }
    if (code === ERROR_CODES.INTERNAL_ERROR) {
      status = 500;
      // Server-side only: the stack helps debugging; the request is identified by path and id.
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.path} (${correlationId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
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
