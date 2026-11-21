import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { MAX_CLASSROOM_DESKS } from '@aula/contracts';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  REALTIME_LAYOUT_PORT,
  RealtimeLayoutError,
  type RealtimeLayoutPort,
} from './realtime-layout.client';
import { REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT } from './realtime-events';

/**
 * Outbox attempts for a layout change before it is given up on, mirroring the appearance budget
 * (12 attempts, roughly 2.8 hours with the outbox backoff). A lost layout event is not an access
 * hole: the next join or reconnection re-verification carries the desk count and grows the room.
 */
export const LAYOUT_MAX_ATTEMPTS = 12;

const layoutChanged = z.object({
  classroomId: z.uuid(),
  deskCount: z.number().int().min(0).max(MAX_CLASSROOM_DESKS),
});

/**
 * Turns a layout outbox event into a call to the realtime server, which grows the live room's
 * layout. Delivery is at least once and may be reordered; rooms only grow, so a replay or an
 * older count is harmless. A failed call throws so the outbox retries it with backoff.
 */
@Injectable()
export class RealtimeLayoutHandler implements OnModuleInit {
  private readonly logger = new Logger(RealtimeLayoutHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(REALTIME_LAYOUT_PORT) private readonly realtime: RealtimeLayoutPort,
  ) {}

  onModuleInit(): void {
    this.registry.setRetryPolicy(REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT, {
      maxAttempts: LAYOUT_MAX_ATTEMPTS,
      // The row stays in `outbox_events` as failed; this makes the consequence impossible to miss.
      onExhausted: (event) =>
        this.logger.error({
          operation: 'realtime.layout.undelivered',
          eventId: event.id,
          type: event.type,
        }),
    });
    this.registry.register(REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT, (event) => this.handle(event));
  }

  private async handle(event: OutboxEventEnvelope): Promise<void> {
    const parsed = layoutChanged.safeParse(event.payload);
    // The message is stored in the outbox row, so it carries no part of the payload.
    if (!parsed.success) throw new RealtimeLayoutError('invalid_event');
    await this.realtime.applyDeskCount(parsed.data);
  }
}
