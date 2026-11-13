import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows a burst up to the limit and drops the excess', () => {
    const limiter = new RateLimiter(30);
    const results = Array.from({ length: 35 }, () => limiter.tryConsume(0));

    expect(results.filter(Boolean)).toHaveLength(30);
    expect(results.slice(30).every((allowed) => !allowed)).toBe(true);
  });

  it('refills at the limit rate', () => {
    const limiter = new RateLimiter(30);
    for (let i = 0; i < 30; i++) limiter.tryConsume(0);

    expect(limiter.tryConsume(10)).toBe(false); // 0.3 token back
    expect(limiter.tryConsume(34)).toBe(true); // one full token back
    expect(limiter.tryConsume(34)).toBe(false);
  });

  it('sustains exactly the limit over time', () => {
    const limiter = new RateLimiter(30);
    let allowed = 0;
    for (let ms = 0; ms < 10_000; ms += 10) if (limiter.tryConsume(ms)) allowed += 1;

    // 100 attempts per second against 30 per second, plus the initial burst of 30.
    expect(allowed).toBeGreaterThanOrEqual(30 * 10);
    expect(allowed).toBeLessThanOrEqual(30 * 10 + 30);
  });

  it('never stores more than one second of credit', () => {
    const limiter = new RateLimiter(30);
    limiter.tryConsume(0);
    const results = Array.from({ length: 40 }, () => limiter.tryConsume(60_000));

    expect(results.filter(Boolean)).toHaveLength(30);
  });

  it('ignores a clock that goes backwards', () => {
    const limiter = new RateLimiter(30);
    for (let i = 0; i < 30; i++) limiter.tryConsume(1000);

    expect(limiter.tryConsume(0)).toBe(false);
  });
});
