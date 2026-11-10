import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import {
  INTERNAL_SERVICE_SECRET_HEADER,
  InternalServiceGuard,
  secretsMatch,
} from './internal-service.guard';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const config = authTestConfig();
const SECRET = config.internalServiceSecret;

function contextWith(headers: Record<string, string | string[] | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

describe('InternalServiceGuard', () => {
  const guard = new InternalServiceGuard(config);

  it('reads the secret from a lowercase header', () => {
    expect(INTERNAL_SERVICE_SECRET_HEADER).toBe('x-internal-service-secret');
  });

  it('admits the configured secret', () => {
    expect(guard.canActivate(contextWith({ [INTERNAL_SERVICE_SECRET_HEADER]: SECRET }))).toBe(true);
  });

  it.each([
    ['a missing header', {}],
    ['an empty header', { [INTERNAL_SERVICE_SECRET_HEADER]: '' }],
    [
      'a wrong secret of the same length',
      { [INTERNAL_SERVICE_SECRET_HEADER]: 'x'.repeat(SECRET.length) },
    ],
    ['a shorter secret', { [INTERNAL_SERVICE_SECRET_HEADER]: SECRET.slice(0, -1) }],
    ['a longer secret', { [INTERNAL_SERVICE_SECRET_HEADER]: `${SECRET}x` }],
    ['a repeated header', { [INTERNAL_SERVICE_SECRET_HEADER]: [SECRET, SECRET] }],
  ])('rejects %s with a generic 401', (_label, headers) => {
    expect(() => guard.canActivate(contextWith(headers))).toThrow(UnauthorizedException);
  });

  it('rejects a secret that differs only in its last character', () => {
    const almost = `${SECRET.slice(0, -1)}${SECRET.endsWith('a') ? 'b' : 'a'}`;
    expect(() =>
      guard.canActivate(contextWith({ [INTERNAL_SERVICE_SECRET_HEADER]: almost })),
    ).toThrow(UnauthorizedException);
  });
});

describe('secretsMatch', () => {
  it('matches equal secrets and rejects different ones', () => {
    expect(secretsMatch('abcdef', 'abcdef')).toBe(true);
    expect(secretsMatch('abcdef', 'abcdeg')).toBe(false);
  });

  it('rejects a length mismatch without throwing', () => {
    expect(secretsMatch('abc', 'abcdef')).toBe(false);
    expect(secretsMatch('', 'abcdef')).toBe(false);
  });

  it('compares multi-byte secrets by byte length without throwing', () => {
    // Same character count, different byte length: must not reach timingSafeEqual.
    expect(secretsMatch('aé', 'ab')).toBe(false);
  });

  it('uses timingSafeEqual for equal-length input only', () => {
    vi.mocked(timingSafeEqual).mockClear();
    secretsMatch('abc', 'abcdef');
    expect(timingSafeEqual).not.toHaveBeenCalled();
    secretsMatch('abcdef', 'abcdeg');
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });
});
