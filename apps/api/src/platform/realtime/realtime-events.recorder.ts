import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OutboxWriter } from '../outbox/outbox.writer';
import {
  REALTIME_CHAT_MESSAGE_CREATED_EVENT,
  REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
  type ClassroomAccessRevokedPayload,
  type RealtimeChatMessageCreatedPayload,
  type RealtimeChatMessageHiddenPayload,
} from './realtime-events';

/**
 * Records realtime events in the caller's transaction, so each event exists if and only if its
 * persisted change commits.
 *
 * Student removal (#23) records `classroom.membership.removed`, which
 * `RealtimeEvictionHandler` also handles, so one event both documents the removal and evicts the
 * student. Other membership deactivations MUST call {@link recordClassroomAccessRevoked}.
 */
@Injectable()
export class RealtimeEventsRecorder {
  constructor(private readonly outbox: OutboxWriter) {}

  async recordClassroomAccessRevoked(
    tx: Prisma.TransactionClient,
    payload: ClassroomAccessRevokedPayload,
  ): Promise<void> {
    await this.outbox.record(tx, {
      type: REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
      payload: { userId: payload.userId, classroomId: payload.classroomId },
    });
  }

  async recordSessionRevoked(
    tx: Prisma.TransactionClient,
    payload: { userId: string; sessionId: string },
  ): Promise<void> {
    await this.outbox.record(tx, {
      type: REALTIME_SESSIONS_REVOKED_EVENT,
      payload: { userId: payload.userId, sessionId: payload.sessionId },
    });
  }

  async recordAllSessionsRevoked(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await this.outbox.record(tx, {
      type: REALTIME_SESSIONS_REVOKED_EVENT,
      payload: { userId },
    });
  }

  /** Returns the outbox event id so the caller can dispatch it right after commit. */
  async recordChatMessageCreated(
    tx: Prisma.TransactionClient,
    payload: RealtimeChatMessageCreatedPayload,
  ): Promise<string> {
    return this.outbox.record(tx, {
      type: REALTIME_CHAT_MESSAGE_CREATED_EVENT,
      payload: { classroomId: payload.classroomId, messageId: payload.messageId },
    });
  }

  /** Returns the outbox event id so the caller can dispatch it right after commit. */
  async recordChatMessageHidden(
    tx: Prisma.TransactionClient,
    payload: RealtimeChatMessageHiddenPayload,
  ): Promise<string> {
    return this.outbox.record(tx, {
      type: REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
      payload: {
        classroomId: payload.classroomId,
        messageId: payload.messageId,
        hiddenAt: payload.hiddenAt,
      },
    });
  }
}
