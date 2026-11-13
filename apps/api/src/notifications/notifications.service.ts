import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import {
  NOTIFICATION_REQUESTED_EVENT,
  notificationRequestSchema,
  type NotificationRequest,
} from './notification-recorder.service';

import { type NotificationDto, type NotificationsQueryDto } from './notifications.dto';

const navigationSelect = {
  id: true,
  kind: true,
  resourceId: true,
  classroomId: true,
  studentId: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;
type Navigation = Prisma.NotificationGetPayload<{ select: typeof navigationSelect }>;
const project = (row: Navigation): NotificationDto => ({
  id: row.id,
  kind: row.kind,
  resourceId: row.resourceId,
  classroomId: row.classroomId,
  studentId: row.studentId,
  readAt: row.readAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

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

  /** Authorize distinct contexts, not each notice, without copying the shared permission matrix. */
  private async visibleWhere(recipientId: string): Promise<Prisma.NotificationWhereInput> {
    const contexts = await this.prisma.notification.groupBy({
      by: ['classroomId', 'studentId', 'kind'],
      where: { recipientId },
    });
    const allowed: Prisma.NotificationWhereInput[] = [];
    // Cap concurrent shared-service checks. Repeated notices in a context cost one check.
    for (let offset = 0; offset < contexts.length; offset += 4) {
      const batch = contexts.slice(offset, offset + 4);
      const decisions = await Promise.all(
        batch.map((context) => {
          const parsed = notificationRequestSchema.safeParse({
            ...context,
            recipientId,
            resourceId: context.classroomId,
            studentId: context.studentId ?? undefined,
          });
          return parsed.success ? this.hasCurrentAccess(parsed.data) : false;
        }),
      );
      batch.forEach((context, index) => {
        if (decisions[index]) allowed.push(context);
      });
    }
    // Prisma OR: [] matches nothing; never accidentally fall back to recipient-only access.
    return { recipientId, OR: allowed };
  }

  async list(
    recipientId: string,
    query: NotificationsQueryDto,
  ): Promise<Paginated<NotificationDto>> {
    const where = await this.visibleWhere(recipientId);
    const [total, rows] = await this.prisma.$transaction(
      [
        this.prisma.notification.count({ where }),
        this.prisma.notification.findMany({
          where,
          select: navigationSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return paginated(rows.map(project), total, query);
  }

  async markRead(recipientId: string, id: string): Promise<NotificationDto> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException('Notification not found');
    const row = await this.prisma.notification.findFirst({
      where: { id, recipientId },
      select: navigationSelect,
    });
    const parsed =
      row &&
      notificationRequestSchema.safeParse({
        kind: row.kind,
        resourceId: row.resourceId,
        classroomId: row.classroomId,
        recipientId,
        studentId: row.studentId ?? undefined,
      });
    if (!parsed || !parsed.success || !(await this.hasCurrentAccess(parsed.data))) {
      throw new NotFoundException('Notification not found');
    }
    return this.prisma.$transaction(async (tx) => {
      // Conditional UPDATE is atomic even when a single/all-read request races us.
      await tx.notification.updateMany({
        where: { id, recipientId, readAt: null },
        data: { readAt: new Date() },
      });
      return project(
        await tx.notification.findUniqueOrThrow({ where: { id }, select: navigationSelect }),
      );
    });
  }

  async markAllRead(recipientId: string): Promise<{ updated: number }> {
    const where = await this.visibleWhere(recipientId);
    const result = await this.prisma.notification.updateMany({
      where: { ...where, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
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
