import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { VerifiedSession } from './session-verifier.service';

/**
 * Parameter decorator extracting the verified user session attached by `SessionAuthGuard`.
 * Can extract the full `VerifiedSession` object or a specific field (`userId` or `sessionId`).
 */
export const CurrentUser = createParamDecorator(
  (data: keyof VerifiedSession | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as VerifiedSession | undefined;
    return data ? user?.[data] : user;
  },
);

/**
 * Semantic alias for `CurrentUser`, extracting the verified session.
 */
export const CurrentSession = CurrentUser;
