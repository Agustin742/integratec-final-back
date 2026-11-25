import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { TUTOR_BOT_SKINS } from '@aula/contracts';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import { REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT } from './realtime-events';
import {
  REALTIME_TUTOR_BOT_SKIN_PORT,
  RealtimeTutorBotSkinError,
  type RealtimeTutorBotSkinPort,
} from './realtime-tutor-bot-skin.client';

/**
 * Outbox attempts for a skin change before it is given up on, mirroring the layout budget. A lost
 * event is only cosmetic: the next join or reconnection re-verification carries the current skin.
 */
export const TUTOR_BOT_SKIN_MAX_ATTEMPTS = 12;

const skinChanged = z.object({
  classroomId: z.uuid(),
  tutorBotSkin: z.enum(TUTOR_BOT_SKINS),
  tutorBotSkinRevision: z.number().int().nonnegative(),
});

/**
 * Turns a skin outbox event into a call to the realtime server. Delivery is at least once and may
 * be reordered; rooms drop an older revision. A failed call throws so the outbox retries it.
 */
@Injectable()
export class RealtimeTutorBotSkinHandler implements OnModuleInit {
  private readonly logger = new Logger(RealtimeTutorBotSkinHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    @Inject(REALTIME_TUTOR_BOT_SKIN_PORT) private readonly realtime: RealtimeTutorBotSkinPort,
  ) {}

  onModuleInit(): void {
    this.registry.setRetryPolicy(REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT, {
      maxAttempts: TUTOR_BOT_SKIN_MAX_ATTEMPTS,
      onExhausted: (event) =>
        this.logger.error({
          operation: 'realtime.tutor-bot-skin.undelivered',
          eventId: event.id,
          type: event.type,
        }),
    });
    this.registry.register(REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT, (event) =>
      this.handle(event),
    );
  }

  private async handle(event: OutboxEventEnvelope): Promise<void> {
    const parsed = skinChanged.safeParse(event.payload);
    // The message is stored in the outbox row, so it carries no part of the payload.
    if (!parsed.success) throw new RealtimeTutorBotSkinError('invalid_event');
    await this.realtime.applyTutorBotSkin(parsed.data);
  }
}
