import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  REALTIME_EVICTION_PORT,
  RealtimeEvictionError,
  type EvictionRequest,
  type RealtimeEvictionPort,
} from './realtime-eviction.client';
import {
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
} from './realtime-events';

const classroomAccessRevoked = z.object({ userId: z.uuid(), classroomId: z.uuid() });
const sessionsRevoked = z.object({ userId: z.uuid(), sessionId: z.uuid().optional() });

/**
 * Turns an access-loss outbox event into a call to the realtime server, which closes the user's
 * live connections. Delivery is at least once, and an eviction that matches nothing is a harmless
 * no-op, so the handler is idempotent. A failed call throws so the outbox retries it with backoff;
 * that retry is how a transient realtime outage is covered (no periodic polling).
 */
@Injectable()
export class RealtimeEvictionHandler implements OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(REALTIME_EVICTION_PORT) private readonly realtime: RealtimeEvictionPort,
  ) {}

  onModuleInit(): void {
    this.registry.register(REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, (event) =>
      this.handle(classroomAccessRevoked, event),
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
    if (!parsed.success) throw new RealtimeEvictionError();
    await this.realtime.evict(parsed.data);
  }
}
