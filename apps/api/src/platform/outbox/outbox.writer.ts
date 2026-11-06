import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface OutboxEventInput {
  /** Stable event name, for example `classroom.announcement.created`. */
  type: string;
  /** JSON-serializable data the handlers need; keep it minimal and free of secrets. */
  payload: Prisma.InputJsonValue;
}

/**
 * Records a domain event inside the caller's transaction, so the event exists
 * if and only if the business change commits (persistence before broadcast).
 */
@Injectable()
export class OutboxWriter {
  async record(tx: Prisma.TransactionClient, event: OutboxEventInput): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: { type: event.type, payload: event.payload },
      select: { id: true },
    });
    return row.id;
  }
}
