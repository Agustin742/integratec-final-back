import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionVerifier, type VerifiedSession } from './session-verifier.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: VerifiedSession;
      session?: VerifiedSession;
    }
  }
}

/**
 * Global authentication guard enforcing session validity by default across all endpoints.
 * Public routes explicitly bypass verification using the `@Public()` decorator.
 * Attaches `{ userId, sessionId }` to `request.user` on successful verification.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionVerifier: SessionVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException();
    }

    const verified = await this.sessionVerifier.verifyAuthorizationHeader(authorization);
    request.user = verified;
    request.session = verified;
    return true;
  }
}
