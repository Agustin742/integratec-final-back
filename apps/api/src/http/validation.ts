import { BadRequestException, ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { ErrorDetail } from './error-envelope';

/** Carries per-field details so the exception filter can put them in the envelope. */
export class RequestValidationException extends BadRequestException {
  constructor(readonly details: ErrorDetail[]) {
    super('Request validation failed');
  }
}

/** Flattens nested class-validator errors into `{ field: 'a.b', messages }` entries. */
export function toErrorDetails(errors: ValidationError[], parentPath = ''): ErrorDetail[] {
  return errors.flatMap((error) => {
    const field = parentPath ? `${parentPath}.${error.property}` : error.property;
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    return [...own, ...toErrorDetails(error.children ?? [], field)];
  });
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => new RequestValidationException(toErrorDetails(errors)),
  });
}
