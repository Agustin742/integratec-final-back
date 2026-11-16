import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { OutboxWriter } from '../outbox/outbox.writer';

export const CLASSROOM_CONTEXT_CHANGED_EVENT = 'classroom.context.changed';

/** Records a generic invalidation hint atomically with the owning mutation. */
@Injectable()
export class ClassroomContextRecorder {
  constructor(private readonly outbox: OutboxWriter) {}

  async recordChanged(tx: Prisma.TransactionClient, classroomId: string): Promise<void> {
    await this.outbox.record(tx, {
      type: CLASSROOM_CONTEXT_CHANGED_EVENT,
      payload: { classroomId },
    });
  }
}
