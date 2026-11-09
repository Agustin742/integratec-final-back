import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';

/** Header carrying the shared service secret on service-to-service calls (Node lowercases it). */
export const INTERNAL_SERVICE_SECRET_HEADER = 'x-internal-service-secret';

/**
 * Compares two secrets without leaking where they differ. `timingSafeEqual` throws
 * on buffers of different length, so a length mismatch is rejected up front; the
 * length of the configured secret is not a secret worth hiding.
 */
export function secretsMatch(presented: string, expected: string): boolean {
  const presentedBytes = Buffer.from(presented, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (presentedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(presentedBytes, expectedBytes);
}

/**
 * Authenticates calls from other Aula services (the realtime server) with the
 * shared `INTERNAL_SERVICE_SECRET`. Internal routes opt out of the user session
 * guard with `@Public()` and must use this guard instead. Every failure is the
 * same generic 401; the secret is never logged or echoed.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'internalServiceSecret'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers[
      INTERNAL_SERVICE_SECRET_HEADER
    ];
    if (typeof header !== 'string' || !secretsMatch(header, this.config.internalServiceSecret)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
