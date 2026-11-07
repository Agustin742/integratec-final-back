import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { AuthDataCleanupService } from './auth-data-cleanup.service';

/**
 * Pause before the first run after boot. Without it a host that restarts more often than
 * `AUTH_CLEANUP_INTERVAL` (frequent deploys) would never reach its first interval tick.
 */
export const AUTH_CLEANUP_STARTUP_DELAY_MS = 60_000;

/**
 * Runs {@link AuthDataCleanupService} in-process: once shortly after boot and then every
 * `authCleanupIntervalSeconds`, mirroring the outbox dispatcher (single host, no job queue).
 *
 * A tick is skipped while the previous run is still going, and a failing run is logged and
 * swallowed so the timer never throws and the process never crashes. Nothing is scheduled
 * when `nodeEnv` is `test`; specs call the service directly or opt in with another `nodeEnv`.
 */
@Injectable()
export class AuthDataCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthDataCleanupScheduler.name);
  private startupTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;

  constructor(
    private readonly cleanup: AuthDataCleanupService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  onModuleInit(): void {
    if (this.config.nodeEnv === 'test') return;
    // Timers are unref'd so they never keep the process alive on their own.
    this.startupTimer = setTimeout(() => this.tick(), AUTH_CLEANUP_STARTUP_DELAY_MS);
    this.startupTimer.unref();
    this.intervalTimer = setInterval(
      () => this.tick(),
      this.config.authCleanupIntervalSeconds * 1000,
    );
    this.intervalTimer.unref();
  }

  /** Stops the timers and waits for a run in progress (bounded: batched short statements). */
  async onModuleDestroy(): Promise<void> {
    clearTimeout(this.startupTimer);
    clearInterval(this.intervalTimer);
    this.startupTimer = undefined;
    this.intervalTimer = undefined;
    await this.inFlight;
  }

  private tick(): void {
    if (this.inFlight) return;
    this.inFlight = this.execute().finally(() => {
      this.inFlight = undefined;
    });
  }

  /** Never rejects: counts and duration on success, only the error class on failure. */
  private async execute(): Promise<void> {
    const startedAt = Date.now();
    try {
      const counts = await this.cleanup.run();
      this.logger.log({ operation: 'auth.cleanup', ...counts, durationMs: Date.now() - startedAt });
    } catch (error) {
      this.logger.error({
        operation: 'auth.cleanup',
        errorName: error instanceof Error ? error.name : 'unknown',
        durationMs: Date.now() - startedAt,
      });
    }
  }
}
