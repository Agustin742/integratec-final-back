import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionVerifier, type VerifiedSession } from './session-verifier.service';

describe('SessionAuthGuard', () => {
  const mockSession: VerifiedSession = {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  const createMockContext = (
    authorization?: string,
  ): { context: ExecutionContext; request: Record<string, unknown> } => {
    const request = {
      headers: {
        ...(authorization !== undefined ? { authorization } : {}),
      },
    };

    const handler = () => undefined;
    const targetClass = class {};

    const context = {
      getHandler: () => handler,
      getClass: () => targetClass,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => ({}),
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  };

  it('allows access to public endpoints without checking authorization', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const sessionVerifier = {
      verifyAuthorizationHeader: vi.fn(),
    } as unknown as SessionVerifier;

    const guard = new SessionAuthGuard(reflector, sessionVerifier);
    const { context, request } = createMockContext();

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    expect(sessionVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
    expect(request.user).toBeUndefined();
  });

  it('throws UnauthorizedException when authorization header is missing on protected route', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const sessionVerifier = {
      verifyAuthorizationHeader: vi.fn(),
    } as unknown as SessionVerifier;

    const guard = new SessionAuthGuard(reflector, sessionVerifier);
    const { context } = createMockContext();

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(sessionVerifier.verifyAuthorizationHeader).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when session verifier rejects token', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const sessionVerifier = {
      verifyAuthorizationHeader: vi
        .fn()
        .mockRejectedValue(new UnauthorizedException('Invalid token')),
    } as unknown as SessionVerifier;

    const guard = new SessionAuthGuard(reflector, sessionVerifier);
    const { context } = createMockContext('Bearer invalid.jwt.token');

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(sessionVerifier.verifyAuthorizationHeader).toHaveBeenCalledWith(
      'Bearer invalid.jwt.token',
    );
  });

  it('attaches verified session to request.user and request.session on valid token', async () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue(false),
    } as unknown as Reflector;
    const sessionVerifier = {
      verifyAuthorizationHeader: vi.fn().mockResolvedValue(mockSession),
    } as unknown as SessionVerifier;

    const guard = new SessionAuthGuard(reflector, sessionVerifier);
    const { context, request } = createMockContext('Bearer valid.jwt.token');

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(sessionVerifier.verifyAuthorizationHeader).toHaveBeenCalledWith(
      'Bearer valid.jwt.token',
    );
    expect(request.user).toEqual(mockSession);
    expect(request.session).toEqual(mockSession);
  });
});
