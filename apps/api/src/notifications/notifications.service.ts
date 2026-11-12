import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  NOTIFICATION_REQUESTED_EVENT,
  notificationRequestSchema,
  type NotificationRequest,
} from './notification-recorder.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  /** Reusable by future reads: check every stored context, not just classroom membership. */
  async hasCurrentAccess(request: NotificationRequest): Promise<boolean> {
    try {
      const result = request.studentId
        ? await this.access.verifyStudentResourceAccess(
            request.recipientId,
            request.studentId,
            request.classroomId,
          )
        : await this.access.verifyClassroomAccess(request.recipientId, request.classroomId);
      // Parents have no classroom-wide content access. Grade notices require the
      // exact active child; announcements remain deferred until issue #37.
      return (
        result.myRole !== 'PARENT' ||
        (request.kind === 'grade_posted' && request.studentId !== undefined)
      );
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) return false;
      throw error; // Database/operational failures must retry, never masquerade as denial.
    }
  }

  /** Load committed state, not the supplied envelope: uncommitted events are invisible. */
  async materializeCommittedEvent(eventId: string): Promise<void> {
    if (!UUID_PATTERN.test(eventId)) return;
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event || event.type !== NOTIFICATION_REQUESTED_EVENT) return;
    const parsed = notificationRequestSchema.safeParse(event.payload);
    if (!parsed.success) throw new Error('Invalid notification request');
    const request = parsed.data;
    if (!(await this.hasCurrentAccess(request))) return;

    await this.prisma.$transaction(async (tx) => {
      // createMany(skipDuplicates) is database-level ON CONFLICT DO NOTHING. A
      // timeout/replay/concurrent handler cannot overwrite read state or create a twin.
      await tx.notification.createMany({
        data: [{ ...request, sourceEventId: event.id }],
        skipDuplicates: true,
      });
      const notification = await tx.notification.findUniqueOrThrow({
        where: { sourceEventId: event.id },
        select: { id: true },
      });
      await tx.notificationDelivery.createMany({
        data: [{ notificationId: notification.id, channel: 'in_app', deliveredAt: new Date() }],
        skipDuplicates: true,
      });
    });
  }
}
