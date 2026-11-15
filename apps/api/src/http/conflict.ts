import { ConflictException } from '@nestjs/common';
import type { ErrorDetail } from './error-envelope';

/**
 * A 409 that tells the client which rule blocked the request. The envelope keeps its fixed
 * `CONFLICT` message; `details` carries the specific, user-facing reason (for example "the
 * deadline has passed"), exactly like `RequestValidationException` does for 400.
 */
export class RequestConflictException extends ConflictException {
  constructor(readonly details: ErrorDetail[]) {
    super('Request conflicts with the current state');
  }
}
