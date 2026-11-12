import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath, SchoolRole } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationRecorder,
  NOTIFICATION_REQUESTED_EVENT,
  type NotificationRequest,
} from './notification-recorder.service';
import { NotificationsModule } from './notifications.module';
import { NotificationsService } from './notifications.service';

// Caller-provisioned disposable database only. Fixtures are append-only and UUID scoped;
// no broad cleanup or destructive SQL is used. Dispose of the task database externally.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function identifiers() {
  return {
    owner: randomUUID(),
    admin: randomUUID(),
    teacher: randomUUID(),
    otherTeacher: randomUUID(),
    independent: randomUUID(),
    stranger: randomUUID(),
    student: randomUUID(),
    sibling: randomUUID(),
    parent: randomUUID(),
    otherParent: randomUUID(),
    otherAdmin: randomUUID(),
    school: randomUUID(),
    otherSchool: randomUUID(),
    classroom: randomUUID(),
    otherClassroom: randomUUID(),
    independentClassroom: randomUUID(),
    resource: randomUUID(),
  };
}

describe('notifications (public recorder, dispatcher and service; real PostgreSQL)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let recorder: NotificationRecorder;
  let service: NotificationsService;
  let dispatcher: OutboxDispatcher;
  let ids: ReturnType<typeof identifiers>;

  const request = (overrides: Partial<NotificationRequest> = {}): NotificationRequest => ({
    kind: 'mention',
    classroomId: ids.classroom,
    resourceId: ids.resource,
    recipientId: ids.student,
    ...overrides,
  });
  const record = (input = request()) => prisma.$transaction((tx) => recorder.record(tx, input));
  const dispatch = () =>
    dispatcher.dispatchPending(1000, new Date(), [NOTIFICATION_REQUESTED_EVENT]);
  const notices = () =>
    prisma.notification.findMany({
      where: { resourceId: ids.resource },
      include: { deliveries: true },
      orderBy: { id: 'asc' },
    });

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), NotificationsModule],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    recorder = module.get(NotificationRecorder);
    service = module.get(NotificationsService);
    dispatcher = module.get(OutboxDispatcher);
  }, 20_000);

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    ids = identifiers();
    await prisma.$transaction(async (tx) => {
      const users = [
        ids.owner,
        ids.admin,
        ids.teacher,
        ids.otherTeacher,
        ids.independent,
        ids.stranger,
        ids.student,
        ids.sibling,
        ids.parent,
        ids.otherParent,
        ids.otherAdmin,
      ];
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: 'Synthetic user',
          email: `notification-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          registrationPath: RegistrationPath.SCHOOL,
        })),
      });
      await tx.school.createMany({
        data: [ids.school, ids.otherSchool].map((id) => ({
          id,
          name: 'Synthetic school',
          slug: id,
        })),
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: ids.school, userId: ids.owner, role: SchoolRole.OWNER },
          { schoolId: ids.school, userId: ids.admin, role: SchoolRole.ADMIN },
          { schoolId: ids.school, userId: ids.teacher, role: SchoolRole.TEACHER },
          { schoolId: ids.school, userId: ids.otherTeacher, role: SchoolRole.TEACHER },
          { schoolId: ids.otherSchool, userId: ids.otherAdmin, role: SchoolRole.ADMIN },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: ids.classroom, name: 'Synthetic class', schoolId: ids.school },
          { id: ids.otherClassroom, name: 'Other class', schoolId: ids.otherSchool },
          {
            id: ids.independentClassroom,
            name: 'Independent class',
            independentTeacherId: ids.independent,
          },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: ids.classroom, userId: ids.teacher, role: ClassroomRole.TEACHER },
          { classroomId: ids.classroom, userId: ids.student, role: ClassroomRole.STUDENT },
          { classroomId: ids.classroom, userId: ids.sibling, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.createMany({
        data: [
          { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
          { classroomId: ids.classroom, parentId: ids.otherParent, childId: ids.sibling },
        ],
      });
    });
  });

  it('records a reusable notification request in the originating transaction', async () => {
    const input = request();
    const id = await record(input);
    const events = await prisma.outboxEvent.findMany({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['resourceId'], equals: ids.resource },
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id, payload: input, processedAt: null });
    expect(await notices()).toEqual([]);
    expect(await dispatch()).toMatchObject({ delivered: 1, retried: 0, exhausted: 0 });
    const rows = await notices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...input, sourceEventId: id, studentId: null, readAt: null });
    expect(rows[0].deliveries).toEqual([
      expect.objectContaining({ channel: 'in_app', deliveredAt: expect.any(Date) }),
    ]);
  });

  it('does not create or dispatch before commit, even if the service receives the event id', async () => {
    await prisma.$transaction(async (tx) => {
      const eventId = await recorder.record(tx, request());
      expect(await tx.outboxEvent.count({ where: { id: eventId } })).toBe(1);
      await service.materializeCommittedEvent(eventId);
      expect((await dispatch()).delivered).toBe(0);
      expect(await notices()).toEqual([]);
    });
    expect((await dispatch()).delivered).toBe(1);
    expect(await notices()).toHaveLength(1);
  });

  it('rolls back both the originating change and recorded request', async () => {
    let eventId = '';
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.classroom.update({ where: { id: ids.classroom }, data: { name: 'Rolled back' } });
        eventId = await recorder.record(tx, request());
        throw new Error('Synthetic business rollback');
      }),
    ).rejects.toThrow('Synthetic business rollback');
    await service.materializeCommittedEvent(eventId);
    await dispatch();
    expect(await prisma.outboxEvent.findUnique({ where: { id: eventId } })).toBeNull();
    expect(await notices()).toEqual([]);
    expect((await prisma.classroom.findUniqueOrThrow({ where: { id: ids.classroom } })).name).toBe(
      'Synthetic class',
    );
  });

  it.each(['owner', 'admin', 'teacher', 'student'] as const)(
    'allows current %s without inventing memberships',
    async (actor) => {
      await record(request({ recipientId: ids[actor] }));
      await dispatch();
      expect(await notices()).toHaveLength(1);
      if (actor === 'admin' || actor === 'owner') {
        expect(
          await prisma.classroomMembership.count({
            where: { classroomId: ids.classroom, userId: ids[actor] },
          }),
        ).toBe(0);
      }
    },
  );

  it.each(['stranger', 'otherAdmin', 'otherTeacher'] as const)(
    'does not create for %s',
    async (actor) => {
      await record(request({ recipientId: ids[actor] }));
      await dispatch();
      expect(await notices()).toEqual([]);
    },
  );

  it('isolates independent classrooms from unrelated teachers', async () => {
    await record(request({ classroomId: ids.independentClassroom, recipientId: ids.independent }));
    await record(request({ classroomId: ids.independentClassroom, recipientId: ids.teacher }));
    await dispatch();
    expect((await notices()).map((row) => row.recipientId)).toEqual([ids.independent]);
  });

  it('uses current membership at dispatch rather than at recording', async () => {
    await record();
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: ids.classroom, userId: ids.student } },
      data: { state: MembershipState.INACTIVE },
    });
    await dispatch();
    expect(await notices()).toEqual([]);
  });

  it('allows access granted after recording but before dispatch', async () => {
    await record(request({ recipientId: ids.stranger }));
    await prisma.classroomMembership.create({
      data: { classroomId: ids.classroom, userId: ids.stranger, role: ClassroomRole.STUDENT },
    });
    await dispatch();
    expect((await notices())[0].recipientId).toBe(ids.stranger);
  });

  it.each(['classroom', 'school'] as const)('denies a deleted %s', async (context) => {
    await record();
    if (context === 'classroom')
      await prisma.classroom.update({
        where: { id: ids.classroom },
        data: { deletedAt: new Date() },
      });
    else await prisma.school.update({ where: { id: ids.school }, data: { deletedAt: new Date() } });
    await dispatch();
    expect(await notices()).toEqual([]);
  });

  it('delivers a grade only to its active child, linked parent and authorized staff', async () => {
    for (const recipientId of [ids.student, ids.sibling, ids.parent, ids.otherParent, ids.admin]) {
      await record(request({ kind: 'grade_posted', studentId: ids.student, recipientId }));
    }
    await dispatch();
    expect((await notices()).map((row) => row.recipientId).sort()).toEqual(
      [ids.student, ids.parent, ids.admin].sort(),
    );
    expect((await notices()).every((row) => row.studentId === ids.student)).toBe(true);
  });

  it.each(['inactive_link', 'inactive_child', 'adult_mode'] as const)(
    'denies parent grade delivery with %s',
    async (state) => {
      await record(
        request({ kind: 'grade_posted', studentId: ids.student, recipientId: ids.parent }),
      );
      if (state === 'inactive_link')
        await prisma.parentLink.updateMany({
          where: { classroomId: ids.classroom, parentId: ids.parent },
          data: { state: MembershipState.INACTIVE },
        });
      if (state === 'inactive_child')
        await prisma.classroomMembership.updateMany({
          where: { classroomId: ids.classroom, userId: ids.student },
          data: { state: MembershipState.INACTIVE },
        });
      if (state === 'adult_mode')
        await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
      await dispatch();
      expect(await notices()).toEqual([]);
    },
  );

  it.each(['announcement', 'mention', 'activity_published'] as const)(
    'denies parent %s even with a child context',
    async (kind) => {
      await record(request({ kind, studentId: ids.student, recipientId: ids.parent }));
      await dispatch();
      expect(await notices()).toEqual([]);
    },
  );

  it('never treats a remaining sibling link as authority over another child', async () => {
    await prisma.parentLink.create({
      data: { classroomId: ids.classroom, parentId: ids.parent, childId: ids.sibling },
    });
    await prisma.parentLink.updateMany({
      where: { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
      data: { state: MembershipState.INACTIVE },
    });
    await record(
      request({ kind: 'grade_posted', studentId: ids.student, recipientId: ids.parent }),
    );
    await record(
      request({ kind: 'grade_posted', studentId: ids.sibling, recipientId: ids.parent }),
    );
    await dispatch();
    expect((await notices()).map((row) => row.studentId)).toEqual([ids.sibling]);
  });

  it('replays and concurrent handlers preserve one notification, delivery and read state', async () => {
    const id = await record();
    await dispatch();
    const [notice] = await notices();
    const readAt = new Date('2026-11-12T10:00:00.000Z');
    await prisma.notification.update({ where: { id: notice.id }, data: { readAt } });
    const event = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    const [handler] = module.get(OutboxHandlerRegistry).handlersFor(NOTIFICATION_REQUESTED_EVENT);
    await Promise.all([handler(event), handler(event), handler(event)]);
    expect(
      (await notices()).map((row) => ({
        id: row.id,
        readAt: row.readAt,
        deliveries: row.deliveries.length,
      })),
    ).toEqual([{ id: notice.id, readAt, deliveries: 1 }]);
    await expect(
      prisma.notificationDelivery.create({
        data: { notificationId: notice.id, channel: 'in_app' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await prisma.notificationDelivery.create({
      data: { notificationId: notice.id, channel: 'email' },
    });
    expect((await notices())[0].deliveries).toHaveLength(2);
  });

  it('exposes current context checks for T2 without leaking old child notices', async () => {
    const input = request({
      kind: 'grade_posted',
      studentId: ids.student,
      recipientId: ids.parent,
    });
    await record(input);
    await dispatch();
    expect(await service.hasCurrentAccess(input)).toBe(true);
    await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
    expect(await service.hasCurrentAccess(input)).toBe(false);
    expect(await notices()).toHaveLength(1); // History is preserved; T2 must filter it.
  });

  it.each([
    { recipientId: 'not-a-uuid' },
    { classroomId: 'not-a-uuid' },
    { resourceId: 'not-a-uuid' },
    { studentId: 'not-a-uuid' },
    { kind: 'unknown' },
    { kind: 'grade_posted' },
    { body: 'Private content must not be accepted' },
  ])('rejects malformed or content-bearing producer input: %j', async (override) => {
    await expect(record({ ...request(), ...override } as NotificationRequest)).rejects.toThrow(
      'Invalid notification request',
    );
    expect(
      await prisma.outboxEvent.count({
        where: { payload: { path: ['resourceId'], equals: ids.resource } },
      }),
    ).toBe(0);
    expect(await notices()).toEqual([]);
  });

  it('denies nonexistent identifiers without creating records', async () => {
    await record(request({ classroomId: randomUUID() }));
    await record(request({ recipientId: randomUUID() }));
    await record(request({ kind: 'grade_posted', studentId: randomUUID() }));
    await dispatch();
    expect(await notices()).toEqual([]);
  });

  it('retries operational access failures without treating them as denied recipients', async () => {
    const id = await record();
    const unavailable = vi
      .spyOn(module.get(AccessVerificationService), 'verifyClassroomAccess')
      .mockRejectedValueOnce(new Error('Synthetic connection failure'));
    try {
      expect(await dispatch()).toMatchObject({ delivered: 0, retried: 1, exhausted: 0 });
      expect(await notices()).toEqual([]);
      const pending = await prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
      expect(pending.processedAt).toBeNull();
      expect(pending.attempts).toBe(1);
      await prisma.outboxEvent.update({ where: { id }, data: { availableAt: new Date(0) } });
      expect((await dispatch()).delivered).toBe(1);
      expect(await notices()).toHaveLength(1);
    } finally {
      unavailable.mockRestore();
    }
  });

  it('does not resolve an unrelated event type or malformed event identifier', async () => {
    const id = await prisma.$transaction((tx) =>
      module.get(OutboxWriter).record(tx, {
        type: 'synthetic.not-notifications',
        payload: request(),
      }),
    );
    await service.materializeCommittedEvent(id);
    await service.materializeCommittedEvent('invalid-id');
    expect(await notices()).toEqual([]);
  });

  it('rechecks removed school staff authority before creating a notification', async () => {
    await record(request({ recipientId: ids.teacher }));
    await prisma.schoolMember.updateMany({
      where: { schoolId: ids.school, userId: ids.teacher },
      data: { state: MembershipState.INACTIVE },
    });
    await dispatch();
    expect(await notices()).toEqual([]);
  });

  it('keeps independent staff authority in adult mode rather than globally rejecting parents', async () => {
    // This account is both school Admin and a linked guardian; the shared hierarchy
    // resolves its staff authority, which is not disabled by adult mode.
    await prisma.parentLink.create({
      data: { classroomId: ids.classroom, parentId: ids.admin, childId: ids.student },
    });
    await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
    await record(request({ recipientId: ids.admin }));
    await dispatch();
    expect((await notices()).map((row) => row.recipientId)).toEqual([ids.admin]);
  });

  it('invalid persisted payload fails rather than silently losing an event', async () => {
    const id = await prisma.$transaction((tx) =>
      module.get(OutboxWriter).record(tx, {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { resourceId: ids.resource },
      }),
    );
    await expect(service.materializeCommittedEvent(id)).rejects.toThrow(
      'Invalid notification request',
    );
    expect(await notices()).toEqual([]);
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).processedAt).toBeNull();
    // Keep the deliberately invalid fixture out of later test dispatch batches.
    await prisma.outboxEvent.update({ where: { id }, data: { failedAt: new Date() } });
  });
});
