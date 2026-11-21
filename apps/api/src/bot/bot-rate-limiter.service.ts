import { HttpException, HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_AI_BOT_RATE_LIMIT_CLASSROOM_MAX,
  DEFAULT_AI_BOT_RATE_LIMIT_GLOBAL_MAX,
  DEFAULT_AI_BOT_RATE_LIMIT_USER_MAX,
  DEFAULT_AI_BOT_RATE_LIMIT_WINDOW_SECONDS,
  type ApiConfig,
} from '../config/api-config';
import { API_CONFIG } from '../config/config.module';

export const BOT_RATE_LIMITER_OPTIONS = Symbol('BOT_RATE_LIMITER_OPTIONS');

export interface BotRateLimiterOptions {
  windowMs?: number;
  userMax?: number;
  classroomMax?: number;
  globalMax?: number;
  now?: () => number;
}

/**
 * In-memory sliding-window rate limiter enforcing per-user, per-classroom, and
 * global caps for Study Guide Bot queries (`429 TOO_MANY_REQUESTS`). All three
 * buckets are verified before any timestamp is recorded so rejected requests do
 * not consume another bucket's quota.
 */
@Injectable()
export class BotRateLimiterService {
  private readonly buckets = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly userMax: number;
  private readonly classroomMax: number;
  private readonly globalMax: number;
  private readonly now: () => number;

  constructor(
    @Optional()
    @Inject(API_CONFIG)
    config?: Pick<
      ApiConfig,
      | 'aiBotRateLimitWindowSeconds'
      | 'aiBotRateLimitUserMax'
      | 'aiBotRateLimitClassroomMax'
      | 'aiBotRateLimitGlobalMax'
    >,
    @Optional() @Inject(BOT_RATE_LIMITER_OPTIONS) options?: BotRateLimiterOptions,
  ) {
    const defaultWindowMs =
      (config?.aiBotRateLimitWindowSeconds ?? DEFAULT_AI_BOT_RATE_LIMIT_WINDOW_SECONDS) * 1000;
    this.windowMs = options?.windowMs ?? defaultWindowMs;
    this.userMax =
      options?.userMax ?? config?.aiBotRateLimitUserMax ?? DEFAULT_AI_BOT_RATE_LIMIT_USER_MAX;
    this.classroomMax =
      options?.classroomMax ??
      config?.aiBotRateLimitClassroomMax ??
      DEFAULT_AI_BOT_RATE_LIMIT_CLASSROOM_MAX;
    this.globalMax =
      options?.globalMax ?? config?.aiBotRateLimitGlobalMax ?? DEFAULT_AI_BOT_RATE_LIMIT_GLOBAL_MAX;
    this.now = options?.now ?? (() => Date.now());
  }

  consume(userId: string, classroomId: string): void {
    const nowMs = this.now();
    const cutoff = nowMs - this.windowMs;
    const checks: Array<[string, number]> = [
      [`user:${userId}`, this.userMax],
      [`classroom:${classroomId}`, this.classroomMax],
      ['global', this.globalMax],
    ];

    const pruned = checks.map(([key, limit]) => {
      const recent = (this.buckets.get(key) ?? []).filter((ts) => ts > cutoff);
      if (recent.length === 0) {
        this.buckets.delete(key);
      } else {
        this.buckets.set(key, recent);
      }
      return { key, limit, recent };
    });

    for (const item of pruned) {
      if (item.recent.length >= item.limit) {
        throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    for (const item of pruned) {
      item.recent.push(nowMs);
      this.buckets.set(item.key, item.recent);
    }
  }
}
