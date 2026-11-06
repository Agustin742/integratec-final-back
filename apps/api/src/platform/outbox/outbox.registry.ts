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

/** In-process registry of handlers by event type; modules register in `onModuleInit`. */
@Injectable()
export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler[]>();

  register(type: string, handler: OutboxHandler): void {
    this.handlers.set(type, [...this.handlersFor(type), handler]);
  }

  handlersFor(type: string): readonly OutboxHandler[] {
    return this.handlers.get(type) ?? [];
  }
}
