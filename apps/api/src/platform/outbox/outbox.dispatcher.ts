import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OutboxHandlerRegistry,
  type OutboxEventEnvelope,
  type OutboxRetryPolicy,
} from './outbox.registry';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BATCH_SIZE = 50;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 60 * 60 * 1000;
const LAST_ERROR_MAX_LENGTH = 300;
const DEFAULT_HANDLER_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export interface OutboxDispatcherOptions {
  /** Longest a single handler may run before the attempt counts as failed. Must be below the lease. */
  handlerTimeoutMs: number;
  /** How long a claimed row stays hidden from other dispatchers if its outcome is never recorded. */
  leaseMs: number;
}

export const OUTBOX_DISPATCHER_OPTIONS = Symbol('OUTBOX_DISPATCHER_OPTIONS');

export interface OutboxDispatchResult {
  delivered: number;
  retried: number;
  exhausted: number;
}

interface ClaimedRow extends OutboxEventEnvelope {
  attempts: number;
}

export class OutboxHandlerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`handler exceeded ${timeoutMs}ms`);
    this.name = 'OutboxHandlerTimeoutError';
  }
}

/** Delay before the next attempt once `attempts` attempts have failed: 5s, 10s, 20s... capped at 1h. */
export const backoffMs = (attempts: number): number =>
  Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);

/**
 * Delivers recorded events to the registered handlers, at least once.
 *
 * Due rows are leased in one short statement (`FOR UPDATE SKIP LOCKED` plus pushing
 * `available_at` to the lease end), so concurrent dispatchers never take the same row.
 * Handlers then run outside any transaction, each with a timeout, and every outcome is
 * persisted on its own, so a slow or failing event never undoes another one. If the
 * process dies after claiming, the lease expires and the row is delivered again. An
 * event with no registered handler counts as a failed attempt (retried, then marked
 * failed) instead of being dropped, so a rolling deploy or a missing registration never
 * loses events silently.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private readonly maxAttempts: number;
  private readonly handlerTimeoutMs: number;
  private readonly leaseMs: number;
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<unknown>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
    @Optional() @Inject(API_CONFIG) private readonly config?: ApiConfig,
    @Optional()
    @Inject(OUTBOX_DISPATCHER_OPTIONS)
    options?: Partial<OutboxDispatcherOptions>,
  ) {
    this.maxAttempts = config?.outboxMaxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.handlerTimeoutMs = options?.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
    this.leaseMs = options?.leaseMs ?? DEFAULT_LEASE_MS;
    if (this.handlerTimeoutMs >= this.leaseMs) {
      throw new Error('outbox handler timeout must be shorter than the lease');
    }
  }

  /** Starts the polling loop, except in tests (call `dispatchPending` there) or without config. */
  onModuleInit(): void {
    if (!this.config || this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => this.tick(), this.config.outboxPollIntervalSeconds * 1000);
    this.timer.unref();
  }

  /** Waits for the running batch; bounded because every handler has a timeout. */
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  /**
   * Claims up to `batchSize` due events (optionally only of the given `types`), runs
   * their handlers and records each outcome. `now` is injectable for tests.
   */
  async dispatchPending(
    batchSize = DEFAULT_BATCH_SIZE,
    now = new Date(),
    types?: readonly string[],
  ): Promise<OutboxDispatchResult> {
    const outcome: OutboxDispatchResult = { delivered: 0, retried: 0, exhausted: 0 };
    if (types?.length === 0) return outcome;
    const startedAt = Date.now();
    const leaseUntil = new Date(now.getTime() + this.leaseMs);
    const rows = await this.claim(batchSize, now, leaseUntil, types);
    const skipped: string[] = [];
    for (const row of rows) {
      if (!this.fitsInLease(row, startedAt)) {
        skipped.push(row.id);
        continue;
      }
      const error = await this.deliver(row);
      try {
        await this.settle(row, error, now, outcome);
      } catch (persistError) {
        // The lease expires and the event is redelivered: at-least-once is preserved.
        this.logger.error({
          operation: 'outbox.event.persist',
          eventId: row.id,
          errorName: persistError instanceof Error ? persistError.name : 'unknown',
        });
      }
    }
    await this.release(skipped, now, leaseUntil);
    if (rows.length > 0) this.logger.log({ operation: 'outbox.dispatch', ...outcome });
    return outcome;
  }

  /**
   * Leases due rows in one statement: `FOR UPDATE SKIP LOCKED` keeps concurrent
   * dispatchers on disjoint rows, and moving `available_at` to the lease end hides
   * the rows from everyone else without holding a transaction while handlers run.
   */
  private async claim(
    batchSize: number,
    now: Date,
    leaseUntil: Date,
    types?: readonly string[],
  ): Promise<ClaimedRow[]> {
    const typeFilter = types ? Prisma.sql`AND type = ANY(${[...types]}::text[])` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<ClaimedRow[]>`
      UPDATE outbox_events SET available_at = ${leaseUntil}
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE processed_at IS NULL AND failed_at IS NULL AND available_at <= ${now} ${typeFilter}
        ORDER BY available_at, occurred_at
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED)
      RETURNING id, type, payload, occurred_at AS "occurredAt", attempts`;
    return rows.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  /** Whether the worst-case handler time still ends before this batch's lease does. */
  private fitsInLease(row: ClaimedRow, startedAt: number): boolean {
    const handlerCount = Math.max(this.registry.handlersFor(row.type).length, 1);
    return Date.now() - startedAt + handlerCount * this.handlerTimeoutMs <= this.leaseMs;
  }

  /** Gives rows we did not get to back to the pool right away instead of waiting for the lease. */
  private async release(ids: string[], now: Date, leaseUntil: Date): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.prisma.outboxEvent.updateMany({
        where: { id: { in: ids }, processedAt: null, availableAt: leaseUntil },
        data: { availableAt: now },
      });
    } catch {
      // Not fatal: the lease expiry makes them due anyway.
    }
  }

  /** Persists one event's outcome on its own, so events never undo each other. */
  private async settle(
    row: ClaimedRow,
    error: Error | undefined,
    now: Date,
    outcome: OutboxDispatchResult,
  ): Promise<void> {
    if (!error) {
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { processedAt: now, lastError: null },
      });
      outcome.delivered += 1;
      return;
    }
    const attempts = row.attempts + 1;
    const policy = this.registry.retryPolicyFor(row.type);
    const exhausted = attempts >= (policy.maxAttempts ?? this.maxAttempts);
    await this.prisma.outboxEvent.update({
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
    const detail = {
      operation: 'outbox.event.failed',
      eventId: row.id,
      type: row.type,
      attempts,
      errorName: error.name,
    };
    if (exhausted) {
      this.logger.error({ ...detail, exhausted: true });
      this.notifyExhausted(policy, row);
    } else {
      this.logger.warn(detail);
    }
  }

  /** A faulty hook must not undo the outcome that was just persisted. */
  private notifyExhausted(policy: OutboxRetryPolicy, row: ClaimedRow): void {
    try {
      policy.onExhausted?.({
        id: row.id,
        type: row.type,
        payload: row.payload,
        occurredAt: row.occurredAt,
      });
    } catch {
      this.logger.error({ operation: 'outbox.event.exhausted-hook', eventId: row.id });
    }
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
      for (const handler of handlers) await this.withTimeout(handler(envelope));
      return undefined;
    } catch (error) {
      return error instanceof Error ? error : new Error('non-error value thrown by handler');
    }
  }

  /** Stops waiting for a handler after the timeout; its late result or rejection is ignored. */
  private withTimeout(running: Promise<void>): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new OutboxHandlerTimeoutError(this.handlerTimeoutMs)),
        this.handlerTimeoutMs,
      );
    });
    running.catch(() => undefined);
    return Promise.race([running, timeout]).finally(() => clearTimeout(timer));
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
