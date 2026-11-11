/**
 * Token bucket: `limitPerSecond` messages per second with a burst of one second's worth. `tryConsume`
 * answers whether the message may be processed; the caller drops it silently otherwise. Time is
 * injected (milliseconds) so tests and the room share one clock.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefillMs: number | undefined;

  constructor(private readonly limitPerSecond: number) {
    this.tokens = limitPerSecond;
  }

  tryConsume(nowMs: number): boolean {
    if (this.lastRefillMs === undefined) {
      this.lastRefillMs = nowMs;
    } else if (nowMs > this.lastRefillMs) {
      const refill = ((nowMs - this.lastRefillMs) / 1000) * this.limitPerSecond;
      this.tokens = Math.min(this.limitPerSecond, this.tokens + refill);
      this.lastRefillMs = nowMs;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
