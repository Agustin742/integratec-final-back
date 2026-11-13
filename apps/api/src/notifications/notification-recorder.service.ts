import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { UUID_PATTERN } from '../access/access-verification.service';
import { OutboxWriter } from '../platform/outbox/outbox.writer';

export const NOTIFICATION_REQUESTED_EVENT = 'notification.requested';

const identifier = z.string().regex(UUID_PATTERN);
export const notificationRequestSchema = z
  .object({
    kind: z.enum(['activity_published', 'grade_posted', 'announcement', 'mention']),
    classroomId: identifier,
    resourceId: identifier,
    recipientId: identifier,
    studentId: identifier.optional(),
  })
  .strict()
  .refine((request) => request.kind !== 'grade_posted' || request.studentId !== undefined);

export type NotificationRequest = z.infer<typeof notificationRequestSchema>;

/** Trusted producers record one recipient in their business transaction, never after it. */
@Injectable()
export class NotificationRecorder {
  constructor(private readonly outbox: OutboxWriter) {}

  record(tx: Prisma.TransactionClient, request: NotificationRequest): Promise<string> {
    const parsed = notificationRequestSchema.safeParse(request);
    // Do not expose payloads in errors: outbox errors can be persisted by the dispatcher.
    if (!parsed.success) throw new Error('Invalid notification request');
    return this.outbox.record(tx, {
      type: NOTIFICATION_REQUESTED_EVENT,
      payload: parsed.data,
    });
  }
}
