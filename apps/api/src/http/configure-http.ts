import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { createRequestContextMiddleware } from './request-context.middleware';
import { createValidationPipe } from './validation';

export interface HttpOptions {
  /** Where request log lines go. Defaults to stdout. */
  logSink?: (line: string) => void;
}

/**
 * Applies the HTTP baseline (correlation id + request log, validation, error
 * envelope). Called by `bootstrap` and by tests so both build the app the same way.
 */
export function configureHttp(app: INestApplication, options: HttpOptions = {}): void {
  const write = options.logSink ?? ((line: string) => process.stdout.write(`${line}\n`));
  app.use(createRequestContextMiddleware(write));
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
}
