import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import {
  NOTIFICATION_REQUESTED_EVENT,
  notificationRequestSchema,
  type NotificationRequest,
} from './notification-recorder.service';
import { NOTIFICATION_EMAIL_REQUESTED_EVENT } from './notification-events';

import { type NotificationDto, type NotificationsQueryDto } from './notifications.dto';

const notificationEmailRequestSchema = z
  .object({
    notificationId: z.string().regex(UUID_PATTERN),
  })
  .strict();

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
    private readonly outbox: OutboxWriter,
  ) {}

  /** Reusable by future reads: check every stored context, not just classroom membership. */
  async hasCurrentAccess(request: NotificationRequest): Promise<boolean> {
    if (request.classroomId === undefined) {
      // Classroom-free notices are self-owned events (badge awards): the
      // recipient is the event's own student, so no shared context is checked.
      return request.kind === 'badge_awarded' && request.studentId === request.recipientId;
    }
    try {
      const result = request.studentId
        ? await this.access.verifyStudentResourceAccess(
            request.recipientId,
            request.studentId,
            request.classroomId,
          )
        : await this.access.verifyClassroomAccess(request.recipientId, request.classroomId);
      // Parents have no classroom-wide content access. Grade notices require the
      // exact active child; #37 does not extend parent announcement visibility.
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
    // Classroom-free notices (badge awards) are self-owned and need no shared access check.
    const allowed: Prisma.NotificationWhereInput[] = contexts.filter(
      (context) => context.classroomId === null && context.kind === 'badge_awarded',
    );
    const classroomContexts = contexts.filter(
      (context): context is typeof context & { classroomId: string } =>
        context.classroomId !== null,
    );
    // Cap concurrent shared-service checks. Repeated notices in a context cost one check.
    for (let offset = 0; offset < classroomContexts.length; offset += 4) {
      const batch = classroomContexts.slice(offset, offset + 4);
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
        classroomId: row.classroomId ?? undefined,
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

  /** Notification-owned persistence boundary for a committed announcement email request. */
  async prepareAnnouncementEmail(eventId: string): Promise<{
    notificationId: string;
    resourceId: string;
    to: string;
  } | null> {
    if (!UUID_PATTERN.test(eventId)) return null;
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event || event.type !== NOTIFICATION_EMAIL_REQUESTED_EVENT) return null;
    const parsed = notificationEmailRequestSchema.safeParse(event.payload);
    if (!parsed.success) throw new Error('Invalid notification email request');
    const { notificationId } = parsed.data;
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        kind: true,
        classroomId: true,
        resourceId: true,
        recipientId: true,
        studentId: true,
        recipient: { select: { email: true } },
      },
    });
    if (!notification) throw new Error('Notification not materialized');
    if (notification.kind !== 'announcement') return null;
    const request = notificationRequestSchema.safeParse({
      kind: notification.kind,
      classroomId: notification.classroomId ?? undefined,
      resourceId: notification.resourceId,
      recipientId: notification.recipientId,
      studentId: notification.studentId ?? undefined,
    });
    if (!request.success || !(await this.hasCurrentAccess(request.data))) return null;
    // Uniqueness protects receipts; the provider key protects external sends on replay.
    await this.prisma.notificationDelivery.createMany({
      data: [{ notificationId, channel: 'email' }],
      skipDuplicates: true,
    });
    const delivery = await this.prisma.notificationDelivery.findUniqueOrThrow({
      where: { notificationId_channel: { notificationId, channel: 'email' } },
      select: { deliveredAt: true },
    });
    if (delivery.deliveredAt !== null) return null;
    return {
      notificationId,
      resourceId: notification.resourceId,
      to: notification.recipient.email,
    };
  }

  /** Called only after the email port acknowledges this stable delivery identity. */
  async completeAnnouncementEmail(notificationId: string): Promise<void> {
    await this.prisma.notificationDelivery.update({
      where: { notificationId_channel: { notificationId, channel: 'email' } },
      data: { deliveredAt: new Date() },
    });
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
      const inserted = await tx.notification.createMany({
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
      // Announcement notices also travel by email: the request is recorded in the same
      // transaction, so the email job sees a committed notification and its unique
      // (notification, channel) delivery row makes retries idempotent.
      if (request.kind === 'announcement' && inserted.count > 0) {
        await this.outbox.record(tx, {
          type: NOTIFICATION_EMAIL_REQUESTED_EVENT,
          payload: { notificationId: notification.id },
        });
      }
    });
  }
}
