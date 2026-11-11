import { HttpException, HttpStatus, Injectable, Optional } from '@nestjs/common';

export interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60,000 ms = 1 minute). */
  windowMs?: number;
  /** Maximum allowed failures within the time window before blocking (default: 5). */
  maxAttempts?: number;
}

/**
 * In-memory sliding-window rate limiter protecting against brute-force join code guessing.
 */
@Injectable()
export class JoinCodeRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(@Optional() options?: RateLimiterOptions) {
    this.windowMs = options?.windowMs ?? 60_000;
    this.maxAttempts = options?.maxAttempts ?? 5;
  }

  /**
   * Checks whether the actor key has exceeded the maximum failure threshold.
   * Throws 429 TOO_MANY_REQUESTS if blocked.
   */
  checkRateLimit(key: string): void {
    const now = Date.now();
    const timestamps = this.attempts.get(key) ?? [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);
    this.attempts.set(key, recent);

    if (recent.length >= this.maxAttempts) {
      throw new HttpException(
        'Too many invalid join code attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Records a failed join attempt.
   */
  recordFailure(key: string): void {
    const now = Date.now();
    const timestamps = this.attempts.get(key) ?? [];
    const recent = timestamps.filter((t) => now - t < this.windowMs);
    recent.push(now);
    this.attempts.set(key, recent);
  }

  /**
   * Clears failure history upon successful join.
   */
  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  /**
   * Resets all internal tracking (useful for testing).
   */
  clear(): void {
    this.attempts.clear();
  }
}
