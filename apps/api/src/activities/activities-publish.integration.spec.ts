import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  ClassroomRole,
  MembershipState,
  PrismaClient,
  RegistrationPath,
  type Prisma,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import {
  NOTIFICATION_REQUESTED_EVENT,
  NotificationRecorder,
} from '../notifications/notification-recorder.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesModule } from './activities.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

describe('activity publishing PostgreSQL HTTP — activities-and-grading, communication-and-notifications', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let recorder: NotificationRecorder;
  let notifications: NotificationsService;
  let fixtureReady = false;
  const [teacher, coTeacher, s1, s2, sInactive, sRemoved, sElsewhere, parent, stranger, other] =
    Array.from({ length: 10 }, () => randomUUID());
  const users = [
    teacher,
    coTeacher,
    s1,
    s2,
    sInactive,
    sRemoved,
    sElsewhere,
    parent,
    stranger,
    other,
  ];
  const activeStudents = [s1, s2].sort();
  const [classroomA, classroomB] = [randomUUID(), randomUUID()];
  const token = (actor: string) => `Bearer publish-test:${actor}`;
  const publish = (id: string, actor = teacher, classroom = classroomA) =>
    request(app.getHttpServer())
      .post(`/classrooms/${classroom}/activities/${id}/publish`)
      .set('Authorization', token(actor));
  const draft = async (overrides: Partial<Prisma.ActivityUncheckedCreateInput> = {}) =>
    (
      await prisma.activity.create({
        data: {
          classroomId: classroomA,
          createdById: teacher,
          type: 'TP',
          format: 'FILE',
          title: `Publish ${randomUUID()}`,
          dueAt: inDays(7),
          maxScore: 10,
          ...overrides,
        },
      })
    ).id;
  const requests = (activityId: string) =>
    prisma.outboxEvent.findMany({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['resourceId'], equals: activityId },
      },
    });
  const recipientsOf = async (activityId: string) =>
    (await requests(activityId))
      .map((e) => (e.payload as { recipientId: string }).recipientId)
      .sort();
  const stored = (id: string) => prisma.activity.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), ActivitiesModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer publish-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer publish-test:'.length),
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
    recorder = app.get(NotificationRecorder);
    notifications = app.get(NotificationsService);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: `Publish ${id}`,
          email: `publish-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-publish-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: `Publish A ${classroomA}`, independentTeacherId: teacher },
          { id: classroomB, name: `Publish B ${classroomB}`, independentTeacherId: other },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: coTeacher, role: ClassroomRole.TEACHER },
          { classroomId: classroomA, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: s2, role: ClassroomRole.STUDENT },
          {
            classroomId: classroomA,
            userId: sInactive,
            role: ClassroomRole.STUDENT,
            state: MembershipState.INACTIVE,
          },
          {
            classroomId: classroomA,
            userId: sRemoved,
            role: ClassroomRole.STUDENT,
            deletedAt: new Date(),
          },
          { classroomId: classroomB, userId: sElsewhere, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: s1, classroomId: classroomA },
      });
    });
    fixtureReady = true;
  }, 30_000);

  /**
   * Outbox rows are shared by every spec file running on this database and the notification
   * specs count what their own dispatch delivers, so this file never leaves its events behind.
   */
  const dropOwnNotificationEvents = async () => {
    const ids = (
      await prisma.activity.findMany({
        where: { classroomId: { in: [classroomA, classroomB] } },
        select: { id: true },
      })
    ).map((a) => a.id);
    const events = await prisma.outboxEvent.findMany({
      where: { type: NOTIFICATION_REQUESTED_EVENT },
      select: { id: true, payload: true },
    });
    const mine = events
      .filter((e) => ids.includes((e.payload as { resourceId?: string }).resourceId ?? ''))
      .map((e) => e.id);
    await prisma.$transaction(async (tx) => {
      await tx.notificationDelivery.deleteMany({
        where: { notification: { sourceEventId: { in: mine } } },
      });
      await tx.notification.deleteMany({ where: { sourceEventId: { in: mine } } });
      await tx.outboxEvent.deleteMany({ where: { id: { in: mine } } });
    });
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    await dropOwnNotificationEvents();
  });

  afterAll(async () => {
    try {
      if (fixtureReady) {
        const classrooms = [classroomA, classroomB];
        await dropOwnNotificationEvents();
        await prisma.$transaction(async (tx) => {
          const where = { activity: { classroomId: { in: classrooms } } };
          await tx.option.deleteMany({ where: { question: where } });
          await tx.question.deleteMany({ where });
          await tx.activity.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.parentLink.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroomMembership.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroom.deleteMany({ where: { id: { in: classrooms } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  it('publishes a draft: PUBLISHED, UTC publishedAt, one notification request per active student', async () => {
    const id = await draft();
    const before = Date.now();
    const res = await publish(id).expect(200);
    expect(res.body).toMatchObject({ id, state: 'PUBLISHED', classroomId: classroomA });
    expect(res.body.publishedAt).toMatch(/Z$/);
    const row = await stored(id);
    expect(row.state).toBe('PUBLISHED');
    expect(row.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.publishedAt!.getTime()).toBeLessThanOrEqual(Date.now());

    // Exactly the active students: not the teacher, co-teacher, inactive, removed, parent or outsiders.
    expect(await recipientsOf(id)).toEqual(activeStudents);
    const events = await requests(id);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.payload).toMatchObject({
        kind: 'activity_published',
        classroomId: classroomA,
        resourceId: id,
      });
    }
  });

  it('once materialized, each active student sees one activity_published notification', async () => {
    const id = await draft();
    await publish(id).expect(200);
    // Materialize only this test's events: the shared dispatcher would also claim the pending
    // events of other spec files running against the same database.
    for (const event of await requests(id)) await notifications.materializeCommittedEvent(event.id);
    const rows = await prisma.notification.findMany({ where: { resourceId: id } });
    expect(rows.map((n) => n.recipientId).sort()).toEqual(activeStudents);
    expect(rows.every((n) => n.kind === 'activity_published' && n.classroomId === classroomA)).toBe(
      true,
    );
    for (const student of activeStudents) {
      const list = await request(app.getHttpServer())
        .get('/notifications?pageSize=100')
        .set('Authorization', token(student))
        .expect(200);
      expect(
        list.body.items.filter((n: { resourceId: string }) => n.resourceId === id),
      ).toHaveLength(1);
    }
    for (const nobody of [teacher, coTeacher, sInactive, sRemoved, parent]) {
      const list = await request(app.getHttpServer())
        .get('/notifications?pageSize=100')
        .set('Authorization', token(nobody))
        .expect(200);
      expect(
        list.body.items.filter((n: { resourceId: string }) => n.resourceId === id),
      ).toHaveLength(0);
    }
  });

  it('a second publish answers 409 and creates no new notification', async () => {
    const id = await draft();
    await publish(id).expect(200);
    const publishedAt = (await stored(id)).publishedAt;
    const res = await publish(id).expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await requests(id)).toHaveLength(2);
    expect((await stored(id)).publishedAt).toEqual(publishedAt);
  });

  it('notifies only the students of its own classroom', async () => {
    const id = await draft({ classroomId: classroomB, createdById: other });
    await publish(id, other, classroomB).expect(200);
    expect(await recipientsOf(id)).toEqual([sElsewhere]);
  });

  it.each([
    ['student', () => s1],
    ['parent', () => parent],
  ])('%s receives 403 and nothing is persisted', async (_n, actor) => {
    const id = await draft();
    await publish(id, actor()).expect(403);
    expect((await stored(id)).state).toBe('DRAFT');
    expect(await requests(id)).toHaveLength(0);
  });

  it('stranger gets 404; activity of another classroom, deleted or malformed id get 404', async () => {
    const id = await draft();
    await publish(id, stranger).expect(404);
    const foreign = await draft({ classroomId: classroomB, createdById: other });
    await publish(foreign, teacher, classroomA).expect(404);
    const deleted = await draft({ deletedAt: new Date() });
    await publish(deleted).expect(404);
    await publish(randomUUID()).expect(404);
    await publish('not-a-uuid').expect(404);
    for (const untouched of [id, foreign, deleted]) {
      expect(await requests(untouched)).toHaveLength(0);
    }
    expect((await stored(id)).state).toBe('DRAFT');
    expect((await stored(foreign)).state).toBe('DRAFT');
    expect((await stored(deleted)).state).toBe('DRAFT');
  });

  it('rejects a dueAt that already passed with 400 on dueAt and persists nothing', async () => {
    const id = await draft({ dueAt: new Date(Date.now() - 60_000) });
    const res = await publish(id).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([{ field: 'dueAt', messages: expect.any(Array) }]);
    const row = await stored(id);
    expect(row.state).toBe('DRAFT');
    expect(row.publishedAt).toBeNull();
    expect(await requests(id)).toHaveLength(0);
  });

  it('rejects a MULTIPLE_CHOICE draft without questions with 400 on questions', async () => {
    const id = await draft({ format: 'MULTIPLE_CHOICE' });
    const res = await publish(id).expect(400);
    expect(res.body.error.details).toEqual([{ field: 'questions', messages: expect.any(Array) }]);
    expect((await stored(id)).state).toBe('DRAFT');
    expect(await requests(id)).toHaveLength(0);
  });

  it('publishes a valid MULTIPLE_CHOICE activity created through the API', async () => {
    const created = await request(app.getHttpServer())
      .post(`/classrooms/${classroomA}/activities`)
      .set('Authorization', token(teacher))
      .send({
        type: 'TP',
        format: 'MULTIPLE_CHOICE',
        title: `MC ${randomUUID()}`,
        dueAt: inDays(3).toISOString(),
        maxScore: 10,
        questions: [
          {
            prompt: 'Q1',
            options: [
              { label: 'a', isCorrect: true },
              { label: 'b', isCorrect: false },
            ],
          },
        ],
      })
      .expect(201);
    const res = await publish(created.body.id).expect(200);
    expect(res.body.state).toBe('PUBLISHED');
    expect(res.body.questions).toHaveLength(1);
    expect(await recipientsOf(created.body.id)).toEqual(activeStudents);
  });

  it('is atomic: a failure after the state change rolls back the publish and every recorded notification', async () => {
    const id = await draft();
    const original = recorder.record.bind(recorder);
    let calls = 0;
    vi.spyOn(recorder, 'record').mockImplementation(async (tx, request) => {
      calls += 1;
      if (calls === 2) throw new Error('simulated recorder failure');
      return original(tx, request);
    });
    await publish(id).expect(500);
    expect(calls).toBe(2);
    const row = await stored(id);
    expect(row.state).toBe('DRAFT');
    expect(row.publishedAt).toBeNull();
    expect(await requests(id)).toHaveLength(0);
  });

  describe('concurrent publishes are serialized by the row lock', { timeout: 20_000 }, () => {
    /** Same deterministic technique as the draft-CRUD specs: a held lock plus pg_blocking_pids. */
    const holdRowLock = async (activityId: string) => {
      const blocker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: (pid: number) => void;
      const locked = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const done = blocker.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM activities WHERE id = ${activityId}::uuid FOR UPDATE`;
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          ready(pid);
          await released;
        },
        { timeout: 60_000 },
      );
      const pid = await locked;
      const queued = async () => {
        const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
          WITH RECURSIVE waiting(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid))
          )
          SELECT count(*)::int AS n FROM waiting`;
        return n;
      };
      let closed = false;
      return {
        async waitForQueue(count: number) {
          for (let i = 0; i < 200; i++) {
            if ((await queued()) >= count) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error(`expected ${count} queued writers`);
        },
        async release() {
          if (closed) return;
          closed = true;
          release();
          await done;
          await blocker.$disconnect();
        },
      };
    };

    it('two simultaneous publishes: one 200, one 409, notifications created once per student', async () => {
      const id = await draft();
      const lock = await holdRowLock(id);
      let results: { status: number }[];
      try {
        const first = publish(id).then((res) => res);
        await lock.waitForQueue(1);
        const second = publish(id).then((res) => res);
        await lock.waitForQueue(2);
        await lock.release();
        results = await Promise.all([first, second]);
      } finally {
        await lock.release().catch(() => undefined);
      }
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await recipientsOf(id)).toEqual(activeStudents);
      expect((await stored(id)).state).toBe('PUBLISHED');
    });
  });
});
