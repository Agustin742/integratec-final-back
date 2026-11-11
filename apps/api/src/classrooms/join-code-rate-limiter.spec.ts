import { HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { JoinCodeRateLimiter } from './join-code-rate-limiter.service';

describe('JoinCodeRateLimiter', () => {
  let rateLimiter: JoinCodeRateLimiter;

  beforeEach(() => {
    rateLimiter = new JoinCodeRateLimiter({
      windowMs: 1000,
      maxAttempts: 3,
    });
  });

  it('allows attempts within the threshold', () => {
    expect(() => rateLimiter.checkRateLimit('user-1')).not.toThrow();
    rateLimiter.recordFailure('user-1');
    expect(() => rateLimiter.checkRateLimit('user-1')).not.toThrow();
    rateLimiter.recordFailure('user-1');
    expect(() => rateLimiter.checkRateLimit('user-1')).not.toThrow();
  });

  it('throws 429 TOO_MANY_REQUESTS when max failure threshold is reached', () => {
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordFailure('user-1');

    try {
      rateLimiter.checkRateLimit('user-1');
      expect.unreachable('Should have thrown 429');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpError = error as HttpException;
      expect(httpError.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('isolates different users so one user failure does not block others', () => {
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordFailure('user-1');

    expect(() => rateLimiter.checkRateLimit('user-1')).toThrow();
    expect(() => rateLimiter.checkRateLimit('user-2')).not.toThrow();
  });

  it('resets failures when recordSuccess is called', () => {
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordSuccess('user-1');

    expect(() => rateLimiter.checkRateLimit('user-1')).not.toThrow();
    rateLimiter.recordFailure('user-1');
    rateLimiter.recordFailure('user-1');
    expect(() => rateLimiter.checkRateLimit('user-1')).not.toThrow();
  });

  it('expires older failure attempts past the time window', async () => {
    const fastLimiter = new JoinCodeRateLimiter({
      windowMs: 50,
      maxAttempts: 2,
    });

    fastLimiter.recordFailure('user-1');
    fastLimiter.recordFailure('user-1');
    expect(() => fastLimiter.checkRateLimit('user-1')).toThrow();

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(() => fastLimiter.checkRateLimit('user-1')).not.toThrow();
  });
});
