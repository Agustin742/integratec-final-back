import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from './outbox.registry';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
const LAST_ERROR_MAX_LENGTH = 300;
/** The claiming transaction stays open while handlers run, so allow for slow ones. */
const TRANSACTION_TIMEOUT_MS = 60_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export interface OutboxDispatchResult {
  delivered: number;
  retried: number;
  exhausted: number;
}

interface ClaimedRow extends OutboxEventEnvelope {
  attempts: number;
}

/** Delay before the next attempt once `attempts` attempts have failed: 5s, 10s, 20s... capped at 1h. */
export const backoffMs = (attempts: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);

/**
 * Delivers recorded events to the registered handlers, at least once.
 *
 * Pending rows are claimed with `FOR UPDATE SKIP LOCKED` inside a transaction that
 * also records the outcome, so concurrent dispatchers never take the same row and a
 * crash mid-batch rolls back to "still pending". An event with no registered handler
 * counts as a failed attempt (retried, then marked failed) instead of being dropped,
 * so a rolling deploy or a missing registration never loses events silently.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly maxAttempts: number;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<unknown>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
    @Optional() @Inject(API_CONFIG) private readonly config?: ApiConfig,
  ) {
    this.maxAttempts = config?.outboxMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /** Starts the polling loop, except in tests (call `dispatchPending` there) or without config. */
  onModuleInit(): void {
    if (!this.config || this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => this.tick(), this.config.outboxPollIntervalSeconds * 1000);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  /** Claims up to `batchSize` due events and runs their handlers. `now` is injectable for tests. */
  async dispatchPending(
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
  ): Promise<OutboxDispatchResult> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const rows = await this.claim(tx, batchSize, now);
        const outcome: OutboxDispatchResult = { delivered: 0, retried: 0, exhausted: 0 };
        for (const row of rows) {
          const error = await this.deliver(row);
          if (!error) {
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { processedAt: now, lastError: null },
            });
            outcome.delivered += 1;
            continue;
          }
          const attempts = row.attempts + 1;
          const exhausted = attempts >= this.maxAttempts;
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: describe(error),
              ...(exhausted
                ? { failedAt: now }
                : { availableAt: new Date(now.getTime() + backoffMs(attempts)) }),
            },
          });
          outcome[exhausted ? 'exhausted' : 'retried'] += 1;
          const entry = { operation: 'outbox.event.failed', eventId: row.id, type: row.type };
          const detail = { ...entry, attempts, errorName: error.name };
          if (exhausted) this.logger.error({ ...detail, exhausted: true });
          else this.logger.warn(detail);
        }
        if (rows.length > 0) this.logger.log({ operation: 'outbox.dispatch', ...outcome });
        return outcome;
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS },
    );
    return result;
  }

  private claim(tx: Prisma.TransactionClient, batchSize: number, now: Date): Promise<ClaimedRow[]> {
    return tx.$queryRaw<ClaimedRow[]>`
      SELECT id, type, payload, occurred_at AS "occurredAt", attempts
      FROM outbox_events
      WHERE processed_at IS NULL AND failed_at IS NULL AND available_at <= ${now}
      ORDER BY available_at, occurred_at
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
  }

  /** Returns the failure, or undefined when every handler succeeded. */
  private async deliver(event: ClaimedRow): Promise<Error | undefined> {
    const handlers = this.registry.handlersFor(event.type);
    if (handlers.length === 0) return new Error('no handler registered for event type');
    const envelope: OutboxEventEnvelope = {
      id: event.id,
      type: event.type,
      payload: event.payload,
      occurredAt: event.occurredAt,
    };
    try {
      for (const handler of handlers) await handler(envelope);
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error('non-error value thrown by handler');
    }
  }

  private tick(): void {
    if (this.inFlight) return;
    this.inFlight = this.dispatchPending()
      .catch((error: unknown) =>
        this.logger.error({
          operation: 'outbox.dispatch',
          errorName: error instanceof Error ? error.name : 'unknown',
        }),
      )
      .finally(() => {
        this.inFlight = undefined;
      });
  }
}

const describe = (error: Error): string =>
  `${error.name}: ${error.message}`.slice(0, LAST_ERROR_MAX_LENGTH);
