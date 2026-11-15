import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, RegistrationPath, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import {
  NOTIFICATION_REQUESTED_EVENT,
  type NotificationRequest,
} from '../notifications/notification-recorder.service';
import {
  NOTIFICATION_EMAIL_REQUESTED_EVENT,
  NotificationEmailService,
} from './notification-email.service';
import { InMemoryEmailAdapter } from '../platform/email/in-memory-email.adapter';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import { AnnouncementsModule } from './announcements.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();

describe('announcements PostgreSQL HTTP — communication-and-notifications, classrooms-and-roles, data', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let emailAdapter: InMemoryEmailAdapter;
  let fixtureReady = false;

  const [teacher, coTeacher, s1, s2, s3, parent, stranger, otherTeacher, sB, ownerUser, teacherC] =
    Array.from({ length: 11 }, () => randomUUID());
  const schoolC = randomUUID();
  const adminUser = randomUUID();
  const [classroomA, classroomB, classroomC, classroomD] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const boundStudents = Array.from({ length: 21 }, () => randomUUID());
  const users = [
    teacher,
    coTeacher,
    s1,
    s2,
    s3,
    parent,
    stranger,
    otherTeacher,
    sB,
    ownerUser,
    teacherC,
    adminUser,
    ...boundStudents,
  ];
  const token = (actor: string) => `Bearer ann-test:${actor}`;
  const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, actor: string) =>
    request(app.getHttpServer())[method](path).set('Authorization', token(actor));
  const base = (classroomId: string) => `/classrooms/${classroomId}/announcements`;

  const publish = (classroomId: string, content: string, actor = teacher, title = 'Aviso') =>
    api('post', base(classroomId), actor).send({ title, content });
  const storedMentions = (announcementId: string) =>
    prisma.mention.findMany({
      where: { sourceType: 'announcement', sourceId: announcementId },
      orderBy: { mentionedUserId: 'asc' },
      select: { mentionedUserId: true },
    });
  const notificationEvents = (announcementId: string) =>
    prisma.outboxEvent.findMany({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['resourceId'], equals: announcementId },
      },
      orderBy: { id: 'asc' },
    });
  const recipientsOf = async (announcementId: string, kind?: string) =>
    (await notificationEvents(announcementId))
      .filter((event) => kind === undefined || (event.payload as NotificationRequest).kind === kind)
      .map((event) => (event.payload as { recipientId: string }).recipientId)
      .sort();
  const dispatchNotifications = async (announcementId: string) => {
    const events = await notificationEvents(announcementId);
    return dispatcher.dispatchPending(
      100,
      new Date(),
      [NOTIFICATION_REQUESTED_EVENT],
      events.map((event) => event.id),
    );
  };
  const emailEvents = async (announcementId: string) => {
    const notifications = await prisma.notification.findMany({
      where: { resourceId: announcementId, kind: 'announcement' },
      select: { id: true },
    });
    const ids = new Set(notifications.map((row) => row.id));
    const events = await prisma.outboxEvent.findMany({
      where: { type: NOTIFICATION_EMAIL_REQUESTED_EVENT },
    });
    return events.filter((event) =>
      ids.has((event.payload as { notificationId: string }).notificationId),
    );
  };
  const dispatchEmails = async (announcementId: string) => {
    const events = await emailEvents(announcementId);
    return dispatcher.dispatchPending(
      100,
      new Date(),
      [NOTIFICATION_EMAIL_REQUESTED_EVENT],
      events.map((event) => event.id),
    );
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), AnnouncementsModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer ann-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer ann-test:'.length),
                sessionId: randomUUID(),
              };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    dispatcher = app.get(OutboxDispatcher);
    emailAdapter = app.get(InMemoryEmailAdapter);

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: `Ann ${id}`,
          email: `ann-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-announcements-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      // Known display names drive mention resolution.
      await tx.user.update({ where: { id: s1 }, data: { displayName: 'Ana Perez' } });
      await tx.user.update({ where: { id: s2 }, data: { displayName: 'Ana Perez' } });
      await tx.user.update({ where: { id: s3 }, data: { displayName: 'Bruno Dias' } });
      // sB exists in another classroom only: mention resolution must not reach it.
      await tx.user.update({ where: { id: sB }, data: { displayName: 'Ana Perez' } });
      await tx.user.update({ where: { id: coTeacher }, data: { displayName: 'Co Profesor' } });
      for (const [index, id] of boundStudents.entries()) {
        await tx.user.update({
          where: { id },
          data: { displayName: `Estudiante ${String(index + 1).padStart(2, '0')}` },
        });
      }

      await tx.school.create({
        data: { id: schoolC, name: `Ann School ${schoolC}`, slug: `ann-school-${schoolC}` },
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: schoolC, userId: ownerUser, role: SchoolRole.OWNER },
          { schoolId: schoolC, userId: adminUser, role: SchoolRole.ADMIN },
          { schoolId: schoolC, userId: teacherC, role: SchoolRole.TEACHER },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: `Ann A ${classroomA}`, independentTeacherId: teacher },
          { id: classroomB, name: `Ann B ${classroomB}`, independentTeacherId: otherTeacher },
          { id: classroomC, name: `Ann C ${classroomC}`, schoolId: schoolC },
          { id: classroomD, name: `Ann D ${classroomD}`, independentTeacherId: otherTeacher },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: coTeacher, role: ClassroomRole.TEACHER },
          { classroomId: classroomA, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: s2, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: s3, role: ClassroomRole.STUDENT },
          { classroomId: classroomB, userId: sB, role: ClassroomRole.STUDENT },
          { classroomId: classroomC, userId: teacherC, role: ClassroomRole.TEACHER },
          ...boundStudents.map((id) => ({
            classroomId: classroomD,
            userId: id,
            role: ClassroomRole.STUDENT,
          })),
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: s1, classroomId: classroomA },
      });
    });
    fixtureReady = true;
  }, 30_000);

  afterAll(async () => {
    try {
      if (fixtureReady) {
        // UUID-owned cleanup only: sibling specs may share the disposable database.
        const classroomIds = [classroomA, classroomB, classroomC, classroomD];
        const announcements = await prisma.announcement.findMany({
          where: { classroomId: { in: classroomIds } },
          select: { id: true },
        });
        const notices = await prisma.notification.findMany({
          where: { classroomId: { in: classroomIds } },
          select: { id: true },
        });
        const sourceIds = new Set(announcements.map((row) => row.id));
        const noticeIds = new Set(notices.map((row) => row.id));
        const events = await prisma.outboxEvent.findMany({
          where: {
            type: { in: [NOTIFICATION_REQUESTED_EVENT, NOTIFICATION_EMAIL_REQUESTED_EVENT] },
          },
        });
        const ownedEvents = events
          .filter((event) => {
            const payload = event.payload as { resourceId?: string; notificationId?: string };
            return (
              sourceIds.has(payload.resourceId ?? '') || noticeIds.has(payload.notificationId ?? '')
            );
          })
          .map((event) => event.id);
        await prisma.$transaction(async (tx) => {
          await tx.notificationDelivery.deleteMany({
            where: { notificationId: { in: [...noticeIds] } },
          });
          await tx.notification.deleteMany({ where: { id: { in: [...noticeIds] } } });
          await tx.outboxEvent.deleteMany({ where: { id: { in: ownedEvents } } });
          await tx.mention.deleteMany({
            where: { sourceType: 'announcement', sourceId: { in: [...sourceIds] } },
          });
          await tx.announcement.deleteMany({ where: { id: { in: [...sourceIds] } } });
          await tx.classroomMembership.deleteMany({
            where: { classroomId: { in: [classroomA, classroomB, classroomC, classroomD] } },
          });
          await tx.parentLink.deleteMany({ where: { classroomId: classroomA } });
          await tx.schoolMember.deleteMany({ where: { schoolId: schoolC } });
          await tx.classroom.deleteMany({
            where: { id: { in: [classroomA, classroomB, classroomC, classroomD] } },
          });
          await tx.school.deleteMany({ where: { id: schoolC } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  it('publishes with roster-restricted mention resolution and post-commit notifications', async () => {
    const res = await publish(classroomA, 'Hola @Ana Perez y @Bruno Dias').expect(201);
    expect(res.body).toMatchObject({
      classroomId: classroomA,
      authorId: teacher,
      title: 'Aviso',
      content: 'Hola @Ana Perez y @Bruno Dias',
    });
    // Duplicate display names mention every member with that name; sB ('Ana Perez' in
    // classroom B only) is never reached.
    expect([...res.body.mentionedUserIds].sort()).toEqual([s1, s2, s3].sort());
    expect((await storedMentions(res.body.id)).map((m) => m.mentionedUserId)).toEqual(
      [s1, s2, s3].sort(),
    );

    // Exactly one announcement request per active student (author excluded) plus one
    // mention request per mentioned member, recorded before any delivery.
    expect(await recipientsOf(res.body.id, 'announcement')).toEqual([s1, s2, s3].sort());
    expect(await recipientsOf(res.body.id, 'mention')).toEqual([s1, s2, s3].sort());
    expect(await dispatchNotifications(res.body.id)).toEqual({
      delivered: 6,
      retried: 0,
      exhausted: 0,
    });
    const notices = await prisma.notification.findMany({ where: { resourceId: res.body.id } });
    expect(notices).toHaveLength(6);
    for (const student of [s1, s2, s3]) {
      expect(
        notices
          .filter((row) => row.recipientId === student)
          .map((row) => row.kind)
          .sort(),
      ).toEqual(['announcement', 'mention']);
    }

    const studentList = await api('get', '/notifications?pageSize=100', s1).expect(200);
    expect(
      studentList.body.items.filter((n: { resourceId: string }) => n.resourceId === res.body.id),
    ).toHaveLength(2);
  });

  it('delivers announcement emails idempotently: replays never duplicate a message', async () => {
    const res = await publish(classroomA, 'Contenido del aviso', teacher, 'Aviso con email').expect(
      201,
    );
    expect(await dispatchNotifications(res.body.id)).toMatchObject({ delivered: 3 });

    const before = emailAdapter.sent.length;
    expect(await dispatchEmails(res.body.id)).toMatchObject({ delivered: 3 });
    expect(emailAdapter.sent.length).toBe(before + 3);
    const deliveries = await prisma.notificationDelivery.findMany({
      where: { notification: { resourceId: res.body.id }, channel: 'email' },
    });
    expect(deliveries).toHaveLength(3);
    expect(deliveries.every((row) => row.deliveredAt !== null)).toBe(true);
    expect(emailAdapter.sent.slice(before)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: 'New announcement: Aviso con email' }),
      ]),
    );

    // Replay the same email events directly: the unique (notification, channel) claim row
    // makes every retry a no-op, so no message is duplicated.
    const [emailHandler] = app
      .get(OutboxHandlerRegistry)
      .handlersFor(NOTIFICATION_EMAIL_REQUESTED_EVENT);
    const [firstEvent] = await emailEvents(res.body.id);
    const envelope = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: firstEvent.id } });
    const service = app.get(NotificationEmailService);
    await Promise.all([service.deliver(envelope.id), service.deliver(envelope.id)]);
    await emailHandler(envelope);
    expect(
      await prisma.notificationDelivery.count({
        where: { notification: { resourceId: res.body.id }, channel: 'email' },
      }),
    ).toBe(3);
    expect(emailAdapter.sent.length).toBe(before + 3);
  });

  it.each([false, true])(
    'recovers email failure without duplicates (accepted=%s)',
    async (accepted) => {
      const res = await publish(classroomA, 'Retry notice').expect(201);
      await dispatchNotifications(res.body.id);
      const [event] = await emailEvents(res.body.id);
      const service = app.get(NotificationEmailService);
      const originalSend = emailAdapter.send.bind(emailAdapter);
      const before = emailAdapter.sent.length;
      const send = vi.spyOn(emailAdapter, 'send').mockImplementationOnce(async (message) => {
        if (accepted) await originalSend(message);
        throw new Error('synthetic provider failure');
      });
      try {
        const now = new Date();
        expect(
          await dispatcher.dispatchPending(
            1,
            now,
            [NOTIFICATION_EMAIL_REQUESTED_EVENT],
            [event.id],
          ),
        ).toEqual({ delivered: 0, retried: 1, exhausted: 0 });
        const pending = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
        expect(pending.attempts).toBe(1);
        expect(pending.lastError).toBe('Error: Email delivery failed');
        expect(
          await dispatcher.dispatchPending(
            1,
            now,
            [NOTIFICATION_EMAIL_REQUESTED_EVENT],
            [event.id],
          ),
        ).toEqual({ delivered: 0, retried: 0, exhausted: 0 });
        expect(
          await dispatcher.dispatchPending(
            1,
            new Date(now.getTime() + 5001),
            [NOTIFICATION_EMAIL_REQUESTED_EVENT],
            [event.id],
          ),
        ).toEqual({ delivered: 1, retried: 0, exhausted: 0 });
        await service.deliver(event.id);
        expect(emailAdapter.sent.length).toBe(before + 1);
      } finally {
        send.mockRestore();
      }
    },
  );

  it('skips notices and emails for recipients who lost access or removed announcements', async () => {
    const removed = await publish(classroomA, 'Aviso para quien se va').expect(201);
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: classroomA, userId: s2 } },
      data: { deletedAt: new Date() },
    });
    expect(await dispatchNotifications(removed.body.id)).toMatchObject({ delivered: 3 });
    const lostNotices = await prisma.notification.findMany({
      where: { resourceId: removed.body.id, recipientId: s2 },
    });
    expect(lostNotices).toHaveLength(0); // lost access: no notification, no email event

    // An announcement removed before its email dispatch: the email handler must claim
    // the delivery row, send nothing and record the outcome instead of failing forever.
    const gone = await publish(classroomA, 'Aviso eliminado antes del envío').expect(201);
    // s2 lost access, so the recorder resolved only s1 and s3 as active students.
    expect(await dispatchNotifications(gone.body.id)).toMatchObject({ delivered: 2 });
    await api('delete', `${base(classroomA)}/${gone.body.id}`, teacher).expect(204);
    const before = emailAdapter.sent.length;
    expect(await dispatchEmails(gone.body.id)).toMatchObject({ delivered: 2 });
    const claims = await prisma.notificationDelivery.findMany({
      where: { notification: { resourceId: gone.body.id }, channel: 'email' },
    });
    expect(claims).toHaveLength(2);
    expect(claims.every((row) => row.deliveredAt === null)).toBe(true);
    expect(emailAdapter.sent.length).toBe(before);

    // Restore s2 for later tests.
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: classroomA, userId: s2 } },
      data: { deletedAt: null },
    });
  });

  it('students and strangers cannot publish; foreign classrooms stay 404', async () => {
    await publish(classroomA, 'Intento de alumno', s1).expect(403);
    await publish(classroomA, 'Intento de aula ajena', sB).expect(404);
    await publish(classroomA, 'Intento de desconocido', stranger).expect(404);
    await publish(classroomA, 'Intento de otro docente', otherTeacher).expect(404);
  });

  it('lists chronologically for members and denies parents', async () => {
    await publish(classroomA, 'Primero').expect(201);
    await publish(classroomA, 'Segundo').expect(201);
    const rows = await prisma.announcement.findMany({
      where: { classroomId: classroomA, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    const res = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
    expect(res.body.items.map((a: { id: string }) => a.id)).toEqual(rows.map((r) => r.id));
    await api('get', base(classroomA), parent).expect(403);
    await api('get', base(classroomA), stranger).expect(404);
    await api('get', base(classroomA), sB).expect(404);
  });

  it('edits re-resolve mentions, notify only newly mentioned members and gate non-authors', async () => {
    const created = await publish(classroomA, 'Hola @Ana Perez y @Bruno Dias').expect(201);
    expect(await dispatchNotifications(created.body.id)).toMatchObject({ delivered: 6 });

    // Author edit removing every mention: rows are deleted, nobody new is notified.
    const withoutMentions = await api('patch', `${base(classroomA)}/${created.body.id}`, teacher)
      .send({ content: 'Actualizado sin menciones' })
      .expect(200);
    expect(withoutMentions.body.mentionedUserIds).toEqual([]);
    expect(await storedMentions(created.body.id)).toEqual([]);
    expect(await recipientsOf(created.body.id, 'mention')).toHaveLength(3); // no new events

    // Author edit adding a mention: only the newly mentioned member is notified.
    const reAdded = await api('patch', `${base(classroomA)}/${created.body.id}`, teacher)
      .send({ content: 'Otra vez @Bruno Dias' })
      .expect(200);
    expect(reAdded.body.mentionedUserIds).toEqual([s3]);
    expect(await storedMentions(created.body.id)).toEqual([{ mentionedUserId: s3 }]);
    // Three original mention events (s1, s2, s3) plus the new one for s3.
    expect(await recipientsOf(created.body.id, 'mention')).toEqual([s1, s2, s3, s3].sort());
    expect(await recipientsOf(created.body.id, 'announcement')).toEqual([s1, s2, s3].sort());

    // A classroom teacher who is not the author may not edit (Owner/Admin may).
    await api('patch', `${base(classroomA)}/${created.body.id}`, coTeacher)
      .send({ title: 'Hack' })
      .expect(403);

    // School Owner may edit any announcement of the school's classrooms.
    const owned = await publish(classroomC, 'Aviso del profesor', teacherC).expect(201);
    const ownerEdit = await api('patch', `${base(classroomC)}/${owned.body.id}`, ownerUser)
      .send({ title: 'Aviso editado por dirección' })
      .expect(200);
    expect(ownerEdit.body.title).toBe('Aviso editado por dirección');
    await api('patch', `${base(classroomC)}/${owned.body.id}`, teacherC)
      .send({ title: 'Mi propio aviso' })
      .expect(200);
  });

  it('removes logically: hidden from lists, rows and mentions preserved, non-authors denied', async () => {
    const created = await publish(classroomA, 'Aviso a remover con @Bruno Dias').expect(201);
    await api('delete', `${base(classroomA)}/${created.body.id}`, coTeacher).expect(403);

    await api('delete', `${base(classroomA)}/${created.body.id}`, teacher).expect(204);
    const list = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
    expect(list.body.items.some((a: { id: string }) => a.id === created.body.id)).toBe(false);
    const stored = await prisma.announcement.findUniqueOrThrow({
      where: { id: created.body.id },
    });
    expect(stored.deletedAt).not.toBeNull();
    // RN-18: logical removal keeps the record, mentions included.
    expect(await storedMentions(created.body.id)).toEqual([{ mentionedUserId: s3 }]);

    // School Owner may remove any announcement of the school's classrooms.
    const owned = await publish(classroomC, 'Aviso de escuela', teacherC).expect(201);
    await api('delete', `${base(classroomC)}/${owned.body.id}`, ownerUser).expect(204);
  });

  it('foreign announcement ids are 404 on edit and delete, direct or replayed', async () => {
    const own = await publish(classroomA, 'Mío').expect(201);
    const foreign = await publish(classroomB, 'Ajeno', otherTeacher).expect(201);
    const notFound = (response: { body: unknown }) => {
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(JSON.stringify(response.body)).not.toContain('Ajeno');
    };
    await assertResourceAuthorization({
      allowedResourceId: own.body.id,
      foreignResourceId: foreign.body.id,
      interaction: {},
      deniedStatus: 404,
      request: (id) => api('patch', `${base(classroomA)}/${id}`, teacher).send({ title: 'Edit' }),
      assertAllowed: (response) => expect(response.status).toBe(200),
      assertDenied: notFound,
    });
    await api('delete', `${base(classroomA)}/${foreign.body.id}`, teacher).expect(404);
    const untouched = await prisma.announcement.findUniqueOrThrow({
      where: { id: foreign.body.id },
    });
    expect(untouched.deletedAt).toBeNull();
  });

  it('rejects explicit null updates without changing the announcement or notification count', async () => {
    const created = await publish(classroomA, 'Unchanged').expect(201);
    const before = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
    const events = await notificationEvents(created.body.id);
    for (const field of ['title', 'content']) {
      await api('patch', `${base(classroomA)}/${created.body.id}`, teacher)
        .send({ [field]: null })
        .expect(400);
    }
    const after = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
    expect(after.body).toEqual(before.body);
    expect(await notificationEvents(created.body.id)).toEqual(events);
  });

  it('applies authentication and adult/student scope to every operation without rejected writes', async () => {
    const created = await publish(classroomA, 'Protected notice').expect(201);
    const operations = [
      ['get', base(classroomA), undefined],
      ['post', base(classroomA), { title: 'Rejected', content: 'Rejected' }],
      ['patch', `${base(classroomA)}/${created.body.id}`, { title: 'Rejected' }],
      ['delete', `${base(classroomA)}/${created.body.id}`, undefined],
    ] as const;
    const before = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
    const events = await notificationEvents(created.body.id);
    for (const [method, path, body] of operations) {
      await request(app.getHttpServer())[method](path).send(body).expect(401);
      await api(method, path, stranger).send(body).expect(404);
      if (method !== 'get') await api(method, path, s1).send(body).expect(403);
      await api(method, path, parent).send(body).expect(403);
    }
    await prisma.classroom.update({ where: { id: classroomA }, data: { adultMode: true } });
    try {
      for (const [method, path, body] of operations) {
        await api(method, path, parent).send(body).expect(404);
      }
      await api('get', base(classroomA), s1).expect(200);
    } finally {
      await prisma.classroom.update({ where: { id: classroomA }, data: { adultMode: false } });
    }
    expect((await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200)).body).toEqual(
      before.body,
    );
    expect(await notificationEvents(created.body.id)).toEqual(events);
  });

  it('allows Admin moderation and preserves content after the author leaves', async () => {
    const schoolNotice = await publish(classroomC, 'School notice', teacherC).expect(201);
    await api('patch', `${base(classroomC)}/${schoolNotice.body.id}`, adminUser)
      .send({ title: 'Admin edit' })
      .expect(200);
    await api('delete', `${base(classroomC)}/${schoolNotice.body.id}`, adminUser).expect(204);
    const retained = await publish(classroomA, 'Retained notice', coTeacher).expect(201);
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: classroomA, userId: coTeacher } },
      data: { deletedAt: new Date() },
    });
    try {
      const list = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
      expect(
        list.body.items.find((item: { id: string }) => item.id === retained.body.id),
      ).toMatchObject({ authorId: coTeacher, content: 'Retained notice' });
      await api('patch', `${base(classroomA)}/${retained.body.id}`, coTeacher)
        .send({ title: 'Rejected' })
        .expect(404);
    } finally {
      await prisma.classroomMembership.update({
        where: { classroomId_userId: { classroomId: classroomA, userId: coTeacher } },
        data: { deletedAt: null },
      });
    }
  });

  const classroomEventCount = (classroomId: string) =>
    prisma.outboxEvent.count({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['classroomId'], equals: classroomId },
      },
    });

  it('rejects invalid text including control characters after a newline', async () => {
    const before = await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200);
    const eventCount = await classroomEventCount(classroomA);
    for (const content of [' ', 'Line one\nLine two\u0001', 'x'.repeat(5001)]) {
      await publish(classroomA, content).expect(400);
    }
    expect((await api('get', `${base(classroomA)}?pageSize=100`, s1).expect(200)).body).toEqual(
      before.body,
    );
    expect(await classroomEventCount(classroomA)).toBe(eventCount);
  });

  it('bounds mentions per announcement to prevent notification flooding', async () => {
    const names = boundStudents
      .map((_, index) => `@Estudiante ${String(index + 1).padStart(2, '0')}`)
      .join(' ');
    await publish(classroomD, names, otherTeacher).expect(400);
    const before = await api('get', `${base(classroomD)}?pageSize=100`, boundStudents[0]).expect(
      200,
    );
    const eventCount = await classroomEventCount(classroomD);
    await publish(classroomD, names, otherTeacher).expect(400);
    const after = await api('get', `${base(classroomD)}?pageSize=100`, boundStudents[0]).expect(
      200,
    );
    expect(after.body).toEqual(before.body);
    expect(await classroomEventCount(classroomD)).toBe(eventCount);
    const withinBound = boundStudents
      .slice(0, 20)
      .map((_, index) => `@Estudiante ${String(index + 1).padStart(2, '0')}`)
      .join(' ');
    const res = await publish(classroomD, withinBound, otherTeacher).expect(201);
    expect(res.body.mentionedUserIds).toHaveLength(20);
  });
});
