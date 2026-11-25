import { Injectable } from '@nestjs/common';
import { MembershipState, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { UUID_PATTERN } from '../access/access-verification.service';
import { OutboxWriter } from '../platform/outbox/outbox.writer';

export const NOTIFICATION_REQUESTED_EVENT = 'notification.requested';

const identifier = z.string().regex(UUID_PATTERN);
export const notificationRequestSchema = z
  .object({
    kind: z.enum([
      'activity_published',
      'grade_posted',
      'announcement',
      'mention',
      'activity_forum_reply',
      'badge_awarded',
    ]),
    // Classroom-free notices exist for student-owned events (badge awards),
    // which are scoped to the recipient alone and need no classroom context.
    classroomId: identifier.optional(),
    resourceId: identifier,
    recipientId: identifier,
    studentId: identifier.optional(),
  })
  .strict()
  .refine((request) => request.kind !== 'grade_posted' || request.studentId !== undefined)
  .refine(
    (request) =>
      request.kind !== 'badge_awarded' ||
      (request.classroomId === undefined &&
        request.studentId !== undefined &&
        request.studentId === request.recipientId),
  );

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

/**
 * Records `grade_posted` notification requests inside the grading transaction for the graded
 * student and, when the classroom is not in adult education mode, every ACTIVE linked parent.
 * Each parent notice carries `studentId` so `NotificationsService.hasCurrentAccess` re-verifies
 * link, enrollment, and adultMode state on materialization and read.
 */
export async function recordGradePostedNotifications(
  tx: Prisma.TransactionClient,
  notifications: NotificationRecorder,
  input: { classroomId: string; gradeId: string; studentId: string },
): Promise<void> {
  await notifications.record(tx, {
    kind: 'grade_posted',
    classroomId: input.classroomId,
    resourceId: input.gradeId,
    recipientId: input.studentId,
    studentId: input.studentId,
  });

  const classroom = await tx.classroom.findUnique({
    where: { id: input.classroomId },
    select: { adultMode: true },
  });
  if (!classroom || classroom.adultMode) {
    return;
  }

  const parentLinks = await tx.parentLink.findMany({
    where: {
      classroomId: input.classroomId,
      childId: input.studentId,
      state: MembershipState.ACTIVE,
    },
    select: { parentId: true },
    orderBy: { id: 'asc' },
  });

  for (const link of parentLinks) {
    if (link.parentId === input.studentId) continue;
    await notifications.record(tx, {
      kind: 'grade_posted',
      classroomId: input.classroomId,
      resourceId: input.gradeId,
      recipientId: link.parentId,
      studentId: input.studentId,
    });
  }
}
