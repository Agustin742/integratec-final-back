import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/** What a handler receives. `id` is stable across redeliveries; use it to deduplicate. */
export interface OutboxEventEnvelope {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  occurredAt: Date;
}

/**
 * Delivery is at-least-once: a handler can run again for the same event (after a
 * failure, a crash or a retry), so every handler MUST be idempotent. Throw to ask
 * for a retry; never put personal data in the error message, it is stored.
 */
export type OutboxHandler = (event: OutboxEventEnvelope) => Promise<void>;

/** Retry behavior for one event type; omitted fields keep the global defaults. */
export interface OutboxRetryPolicy {
  /** Attempts before the event is marked failed, instead of the global `OUTBOX_MAX_ATTEMPTS`. */
  maxAttempts?: number;
  /** Called once, with the event, when it runs out of attempts: the place to make that loud. */
  onExhausted?: (event: OutboxEventEnvelope) => void;
}

/** In-process registry of handlers by event type; modules register in `onModuleInit`. */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler[]>();
  private readonly retryPolicies = new Map<string, OutboxRetryPolicy>();

  register(type: string, handler: OutboxHandler): void {
    this.handlers.set(type, [...this.handlersFor(type), handler]);
  }

  /** Overrides the retry behavior of one type, for events that justify a longer budget. */
  setRetryPolicy(type: string, policy: OutboxRetryPolicy): void {
    this.retryPolicies.set(type, policy);
  }

  retryPolicyFor(type: string): OutboxRetryPolicy {
    return this.retryPolicies.get(type) ?? {};
  }

  handlersFor(type: string): readonly OutboxHandler[] {
    return this.handlers.get(type) ?? [];
  }
}
