import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  REALTIME_EVICTION_PORT,
  RealtimeEvictionError,
  type EvictionRequest,
  type RealtimeEvictionPort,
} from './realtime-eviction.client';
import {
  CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
} from './realtime-events';

/**
 * Outbox attempts for an eviction before it is given up on. With the outbox backoff (5 s doubling,
 * capped at 1 h) twelve attempts cover roughly 2.8 hours, far beyond the default budget, because a
 * revoked user stays connected until the eviction lands. There is no periodic fallback (approved
 * decision), so the residual risk is an outage longer than this, which is logged at error level.
 */
export const EVICTION_MAX_ATTEMPTS = 12;

const classroomAccessRevoked = z.object({ userId: z.uuid(), classroomId: z.uuid() });
// `membershipId` is part of the removal payload but not of the eviction, so it is dropped here.
const membershipRemoved = z.object({ userId: z.uuid(), classroomId: z.uuid() });
const sessionsRevoked = z.object({ userId: z.uuid(), sessionId: z.uuid().optional() });

/**
 * Turns an access-loss outbox event into a call to the realtime server, which closes the user's
 * live connections. Delivery is at least once, and an eviction that matches nothing is a harmless
 * no-op, so the handler is idempotent. A failed call throws so the outbox retries it with backoff;
 * that retry is how a transient realtime outage is covered (no periodic polling).
 */
@Injectable()
export class RealtimeEvictionHandler implements OnModuleInit {
  private readonly logger = new Logger(RealtimeEvictionHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(REALTIME_EVICTION_PORT) private readonly realtime: RealtimeEvictionPort,
  ) {}

  onModuleInit(): void {
    for (const type of [
      REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
      REALTIME_SESSIONS_REVOKED_EVENT,
      CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
    ]) {
      this.registry.setRetryPolicy(type, {
        maxAttempts: EVICTION_MAX_ATTEMPTS,
        // The row stays in `outbox_events` as failed; this makes the consequence impossible to miss.
        onExhausted: (event) =>
          this.logger.error({
            operation: 'realtime.eviction.undelivered',
            eventId: event.id,
            type: event.type,
          }),
      });
    }
    this.registry.register(REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, (event) =>
      this.handle(classroomAccessRevoked, event),
    );
    this.registry.register(CLASSROOM_MEMBERSHIP_REMOVED_EVENT, (event) =>
      this.handle(membershipRemoved, event),
    );
    this.registry.register(REALTIME_SESSIONS_REVOKED_EVENT, (event) =>
      this.handle(sessionsRevoked, event),
    );
  }

  private async handle(
    schema: z.ZodType<EvictionRequest>,
    event: OutboxEventEnvelope,
  ): Promise<void> {
    const parsed = schema.safeParse(event.payload);
    // The message is stored in the outbox row, so it carries no part of the payload.
    if (!parsed.success) throw new RealtimeEvictionError('invalid_event');
    await this.realtime.evict(parsed.data);
  }
}
