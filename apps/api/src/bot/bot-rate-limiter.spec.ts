import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BotRateLimiterService } from './bot-rate-limiter.service';

describe('BotRateLimiterService', () => {
  it('enforces per-user, per-classroom, and global sliding windows without leaking failed checks', () => {
    let nowMs = 1_000_000;
    const limiter = new BotRateLimiterService(undefined, {
      windowMs: 60_000,
      userMax: 2,
      classroomMax: 3,
      globalMax: 4,
      now: () => nowMs,
    });

    // User 1 in classroom A uses 2 requests (hits userMax = 2).
    limiter.consume('u1', 'cA');
    limiter.consume('u1', 'cA');
    expect(() => limiter.consume('u1', 'cA')).toThrow(HttpException);
    try {
      limiter.consume('u1', 'cA');
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    // User 2 in classroom A can still make 1 request (reaches classroomMax = 3),
    // while rejected User 1 calls did not burn classroom or global quota.
    limiter.consume('u2', 'cA');
    expect(() => limiter.consume('u3', 'cA')).toThrow(HttpException);

    // User 3 in classroom B can still make 1 request (reaches globalMax = 4).
    limiter.consume('u3', 'cB');
    expect(() => limiter.consume('u4', 'cC')).toThrow(HttpException);

    // After sliding window expires, all buckets reset cleanly.
    nowMs += 60_001;
    expect(() => limiter.consume('u1', 'cA')).not.toThrow();
  });
});
