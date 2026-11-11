import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OutboxWriter } from '../outbox/outbox.writer';
import {
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
  type ClassroomAccessRevokedPayload,
} from './realtime-events';

/**
 * Records the events that evict a user from live classrooms. Every method takes the caller's
 * transaction: the event exists if and only if the change that caused it commits.
 *
 * Whoever deactivates or removes a classroom membership MUST call
 * {@link recordClassroomAccessRevoked} in that same transaction. No such operation exists yet
 * (membership management arrives with the invitation and member-directory stories); until it does,
 * a removed member is only refused at their next join or reconnection.
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
}
