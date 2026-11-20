import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  chatMessageHiddenPayloadSchema,
  chatMessagePayloadSchema,
  type ChatRealtimeBroadcast,
} from '@aula/contracts';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CHAT_MENTION_SOURCE_TYPE } from '../../chat/chat-policy';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  REALTIME_CHAT_MESSAGE_CREATED_EVENT,
  REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
} from './realtime-events';
import { EVICTION_MAX_ATTEMPTS } from './realtime-eviction.handler';
import {
  REALTIME_CHAT_BROADCAST_PORT,
  type RealtimeChatBroadcastPort,
} from './realtime-chat.client';

const messageCreated = z.strictObject({ classroomId: z.uuid(), messageId: z.uuid() });
const messageHidden = z.strictObject({
  classroomId: z.uuid(),
  messageId: z.uuid(),
  hiddenAt: z.iso.datetime(),
});

/**
 * Outbox attempts for a hidden-message event. Students keep seeing a moderated message until the
 * event lands, so it shares the eviction budget (same at-least-once path). A missed created event
 * is recovered from history, so it stays on the default budget.
 */
export const CHAT_HIDDEN_MAX_ATTEMPTS = EVICTION_MAX_ATTEMPTS;

/** Resolves committed message IDs from PostgreSQL before at-least-once realtime delivery. */
@Injectable()
export class RealtimeChatEventHandler implements OnModuleInit {
  private readonly logger = new Logger(RealtimeChatEventHandler.name);

  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly prisma: PrismaService,
    @Inject(REALTIME_CHAT_BROADCAST_PORT) private readonly realtime: RealtimeChatBroadcastPort,
  ) {}

  onModuleInit(): void {
    for (const type of [REALTIME_CHAT_MESSAGE_CREATED_EVENT, REALTIME_CHAT_MESSAGE_HIDDEN_EVENT]) {
      this.registry.setRetryPolicy(type, {
        ...(type === REALTIME_CHAT_MESSAGE_HIDDEN_EVENT
          ? { maxAttempts: CHAT_HIDDEN_MAX_ATTEMPTS }
          : {}),
        onExhausted: (event) =>
          this.logger.error({
            operation: 'realtime.chat-broadcast.undelivered',
            eventId: event.id,
            type: event.type,
          }),
      });
    }
    this.registry.register(REALTIME_CHAT_MESSAGE_CREATED_EVENT, (event) =>
      this.handleCreated(event),
    );
    this.registry.register(REALTIME_CHAT_MESSAGE_HIDDEN_EVENT, (event) => this.handleHidden(event));
  }

  private async handleCreated(event: OutboxEventEnvelope): Promise<void> {
    const parsed = messageCreated.safeParse(event.payload);
    if (!parsed.success) throw new Error('invalid realtime chat event');
    const { classroomId, messageId } = parsed.data;
    const message = await this.prisma.$transaction(
      async (tx) => {
        const row = await tx.message.findFirst({
          where: { id: messageId, classroomId },
          select: {
            id: true,
            classroomId: true,
            authorId: true,
            body: true,
            createdAt: true,
            hiddenAt: true,
          },
        });
        if (!row) throw new Error('committed chat message is unavailable');
        if (row.hiddenAt !== null) return null;
        const mentions = await tx.mention.findMany({
          where: { sourceType: CHAT_MENTION_SOURCE_TYPE, sourceId: row.id },
          select: { mentionedUserId: true },
          orderBy: { mentionedUserId: 'asc' },
        });
        return {
          id: row.id,
          classroomId: row.classroomId!,
          authorId: row.authorId,
          body: row.body,
          mentionedUserIds: mentions.map((mention) => mention.mentionedUserId),
          createdAt: row.createdAt.toISOString(),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (message === null) return;
    const checked = chatMessagePayloadSchema.safeParse(message);
    if (!checked.success) throw new Error('persisted chat message violates realtime contract');
    const broadcast: ChatRealtimeBroadcast = {
      classroomId,
      event: CHAT_MESSAGE_EVENT,
      payload: checked.data,
    };
    await this.realtime.broadcast(broadcast);
  }

  private async handleHidden(event: OutboxEventEnvelope): Promise<void> {
    const parsed = messageHidden.safeParse(event.payload);
    if (!parsed.success) throw new Error('invalid realtime chat event');
    const payload = chatMessageHiddenPayloadSchema.safeParse({
      messageId: parsed.data.messageId,
      hiddenAt: parsed.data.hiddenAt,
    });
    if (!payload.success) throw new Error('invalid realtime chat event');
    await this.realtime.broadcast({
      classroomId: parsed.data.classroomId,
      event: CHAT_MESSAGE_HIDDEN_EVENT,
      payload: payload.data,
    });
  }
}
