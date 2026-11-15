import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_SHOP_PURCHASE_RATE_LIMIT_MAX_ATTEMPTS,
  DEFAULT_SHOP_PURCHASE_RATE_LIMIT_WINDOW_SECONDS,
  type ApiConfig,
} from '../config/api-config';
import { API_CONFIG } from '../config/config.module';

export interface ShopRateLimiterOptions {
  /** Sliding window duration in milliseconds. */
  windowMs?: number;
  /** Maximum purchase attempts allowed per user inside the window. */
  maxAttempts?: number;
}

/**
 * In-memory per-user sliding-window rate limiter protecting `POST /classrooms/:id/shop/purchase`
 * against burst purchase spam (`429 TOO_MANY_REQUESTS`).
 */
@Injectable()
export class ShopPurchaseRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxAttempts: number;

  constructor(
    @Optional()
    @Inject(API_CONFIG)
    config?: Pick<
      ApiConfig,
      'shopPurchaseRateLimitWindowSeconds' | 'shopPurchaseRateLimitMaxAttempts'
    >,
    @Optional() options?: ShopRateLimiterOptions,
  ) {
    const defaultWindowMs =
      (config?.shopPurchaseRateLimitWindowSeconds ??
        DEFAULT_SHOP_PURCHASE_RATE_LIMIT_WINDOW_SECONDS) * 1000;
    const defaultMaxAttempts =
      config?.shopPurchaseRateLimitMaxAttempts ?? DEFAULT_SHOP_PURCHASE_RATE_LIMIT_MAX_ATTEMPTS;

    this.windowMs = options?.windowMs ?? defaultWindowMs;
    this.maxAttempts = options?.maxAttempts ?? defaultMaxAttempts;
  }

  /**
   * Consumes one attempt slot for `userId` or throws `429 TOO_MANY_REQUESTS` when the
   * sliding window limit has been reached.
   */
  consume(userId: string): void {
    const now = Date.now();
    const recent = (this.attempts.get(userId) ?? []).filter((ts) => now - ts < this.windowMs);

    if (recent.length >= this.maxAttempts) {
      this.attempts.set(userId, recent);
      throw new HttpException(
        'Too many purchase attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.attempts.set(userId, recent);
  }

  /** Resets tracked attempt windows (useful for testing). */
  clear(): void {
    this.attempts.clear();
  }
}
