import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { memberAppearanceSchema } from '@aula/contracts';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  REALTIME_APPEARANCE_PORT,
  RealtimeAppearanceError,
  type AppearanceUpdateRequest,
  type RealtimeAppearancePort,
} from './realtime-appearance.client';
import { REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT } from './realtime-events';

/**
 * Outbox attempts for an appearance change before it is given up on, mirroring the eviction
 * budget (12 attempts, roughly 2.8 hours with the outbox backoff). A lost appearance event is
 * not an access hole, only a stale snapshot: the reconnect/second-join re-verification (T1)
 * refreshes the appearance, so the same long budget that evictions need is enough here too.
 */
export const APPEARANCE_MAX_ATTEMPTS = 12;

const appearanceChanged = z.object({
  classroomId: z.uuid(),
  userId: z.uuid(),
  appearance: memberAppearanceSchema,
});

/**
 * Turns an appearance outbox event into a call to the realtime server, which updates the user's
 * avatar in the live room. Delivery is at least once and the route's update is idempotent
 * (last write wins, a missing room or avatar is a no-op), so redeliveries are safe. A failed call
 * throws so the outbox retries it with backoff; there is no periodic polling.
 */
@Injectable()
export class RealtimeAppearanceHandler implements OnModuleInit {
  private readonly logger = new Logger(RealtimeAppearanceHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(REALTIME_APPEARANCE_PORT) private readonly realtime: RealtimeAppearancePort,
  ) {}

  onModuleInit(): void {
    this.registry.setRetryPolicy(REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT, {
      maxAttempts: APPEARANCE_MAX_ATTEMPTS,
      // The row stays in `outbox_events` as failed; this makes the consequence impossible to miss.
      onExhausted: (event) =>
        this.logger.error({
          operation: 'realtime.appearance.undelivered',
          eventId: event.id,
          type: event.type,
        }),
    });
    this.registry.register(REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT, (event) =>
      this.handle(event),
    );
  }

  private async handle(event: OutboxEventEnvelope): Promise<void> {
    const parsed = appearanceChanged.safeParse(event.payload);
    // The message is stored in the outbox row, so it carries no part of the payload.
    if (!parsed.success) throw new RealtimeAppearanceError('invalid_event');
    const request: AppearanceUpdateRequest = parsed.data;
    await this.realtime.applyAppearance(request);
  }
}
