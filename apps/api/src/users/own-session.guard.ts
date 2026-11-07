import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { SessionVerifier } from '../auth/session-verifier.service';

export interface OwnUserRequest extends Request {
  verifiedUserId: string;
}

/** Local to /users/me until #19 supplies the shared authorization framework. */
@Injectable()
export class OwnSessionGuard implements CanActivate {
  constructor(private readonly verifier: SessionVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<OwnUserRequest>();
    const session = await this.verifier.verifyAuthorizationHeader(req.headers.authorization);
    req.verifiedUserId = session.userId;
    return true;
  }
}
