import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { CurrentSession, CurrentUser } from './current-user.decorator';
import type { VerifiedSession } from './session-verifier.service';

describe('CurrentUser and CurrentSession decorators', () => {
  const mockSession: VerifiedSession = {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  // Helper to extract the parameter decorator factory registered by NestJS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getParamDecoratorFactory = (decorator: any, data?: any) => {
    class TestController {
      testMethod(@decorator(data) _param: unknown) {}
    }

    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      TestController,
      'testMethod',
    ) as Record<string, { factory: (data: unknown, ctx: unknown) => unknown }>;

    const key = Object.keys(metadata)[0];
    return metadata[key].factory;
  };

  const createMockContext = (user?: VerifiedSession) => ({
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  });

  it('extracts full session object when no property name is specified', () => {
    const factory = getParamDecoratorFactory(CurrentUser);
    const ctx = createMockContext(mockSession);

    const result = factory(undefined, ctx);

    expect(result).toEqual(mockSession);
  });

  it('extracts specific property (userId) when specified', () => {
    const factory = getParamDecoratorFactory(CurrentUser, 'userId');
    const ctx = createMockContext(mockSession);

    const result = factory('userId', ctx);

    expect(result).toBe(mockSession.userId);
  });

  it('extracts specific property (sessionId) when specified', () => {
    const factory = getParamDecoratorFactory(CurrentUser, 'sessionId');
    const ctx = createMockContext(mockSession);

    const result = factory('sessionId', ctx);

    expect(result).toBe(mockSession.sessionId);
  });

  it('returns undefined if request.user is not set', () => {
    const factory = getParamDecoratorFactory(CurrentUser);
    const ctx = createMockContext(undefined);

    const result = factory(undefined, ctx);

    expect(result).toBeUndefined();
  });

  it('CurrentSession behaves identically to CurrentUser', () => {
    const factory = getParamDecoratorFactory(CurrentSession, 'sessionId');
    const ctx = createMockContext(mockSession);

    const result = factory('sessionId', ctx);

    expect(result).toBe(mockSession.sessionId);
  });
});
