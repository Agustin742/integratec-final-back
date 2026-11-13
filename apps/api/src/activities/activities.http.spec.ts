import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClassroomRole, Prisma, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesModule } from './activities.module';

const classroomId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const schoolId = '33333333-3333-4333-8333-333333333333';
const activityId = '66666666-6666-4666-8666-666666666666';
const base = `/classrooms/${classroomId}/activities`;
const body = {
  type: 'TP',
  format: 'FILE',
  title: 'Essay',
  dueAt: '2026-12-01T15:00:00.000Z',
  maxScore: 10,
};
const row = {
  id: activityId,
  classroomId,
  createdById: actorId,
  type: 'TP',
  format: 'FILE',
  state: 'DRAFT',
  title: 'Essay',
  description: '',
  opensAt: null,
  dueAt: new Date('2026-12-01T15:00:00.000Z'),
  allowLate: false,
  maxScore: 10,
  weightMultiplier: new Prisma.Decimal('1.5'),
  publishedAt: null,
  createdAt: new Date('2026-11-13T10:00:00.000Z'),
  updatedAt: new Date('2026-11-13T10:00:00.000Z'),
  classroom: { school: { timeZone: 'America/Argentina/Cordoba' } },
  _count: { questions: 0 },
  questions: [],
};
type Method = 'get' | 'post' | 'patch' | 'delete';
type Actor = 'owner' | 'teacher' | 'student' | 'parent' | 'stranger';

// All persistence is replaced: no Prisma client or database connection is created.
const prisma = {
  classroom: { findFirst: vi.fn() },
  school: { findFirst: vi.fn() },
  schoolMember: { findFirst: vi.fn() },
  classroomMembership: { findFirst: vi.fn(), findMany: vi.fn() },
  parentLink: { findMany: vi.fn() },
  activity: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  question: { deleteMany: vi.fn() },
  option: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
};
const recorder = { record: vi.fn() };

function actAs(actor: Actor) {
  prisma.schoolMember.findFirst.mockResolvedValue(
    actor === 'owner' ? { role: SchoolRole.OWNER } : null,
  );
  prisma.classroomMembership.findFirst.mockResolvedValue(
    actor === 'teacher'
      ? { role: ClassroomRole.TEACHER }
      : actor === 'student'
        ? { role: ClassroomRole.STUDENT }
        : null,
  );
  prisma.parentLink.findMany.mockResolvedValue(
    actor === 'parent' ? [{ childId: '44444444-4444-4444-8444-444444444444' }] : [],
  );
  if (actor === 'teacher') prisma.schoolMember.findFirst.mockResolvedValue({ role: 'TEACHER' });
}

describe('activities draft CRUD HTTP — activities-and-grading, classrooms-and-roles, API contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(
          authTestConfig({ databaseUrl: 'postgresql://synthetic:synthetic@localhost:1/unused' }),
        ),
        PrismaModule,
        AuthModule,
        ActivitiesModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(NotificationRecorder)
      .useValue(recorder)
      // The polling dispatcher must not touch the mocked client.
      .overrideProvider(OutboxDispatcher)
      .useValue({})
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (header !== 'Bearer synthetic') throw new UnauthorizedException();
          return { userId: actorId, sessionId: 's' };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    prisma.classroom.findFirst.mockResolvedValue({
      id: classroomId,
      schoolId,
      independentTeacherId: null,
      name: 'Synthetic classroom',
      adultMode: false,
    });
    prisma.school.findFirst.mockResolvedValue({ id: schoolId });
    prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([{ id: activityId }]);
    prisma.activity.create.mockResolvedValue(row);
    prisma.activity.findFirst.mockResolvedValue(row);
    prisma.activity.findMany.mockResolvedValue([row]);
    prisma.activity.count.mockResolvedValue(1);
    prisma.activity.update.mockResolvedValue(row);
    prisma.activity.updateMany.mockResolvedValue({ count: 1 });
    prisma.classroomMembership.findMany.mockResolvedValue([]);
    recorder.record.mockResolvedValue('44444444-4444-4444-8444-4444444444aa');
    actAs('teacher');
  });

  const call = (method: Method, url: string, actor: Actor | null = 'teacher') => {
    const req = request(app.getHttpServer())[method](url);
    return actor === null ? req : req.set('Authorization', 'Bearer synthetic');
  };
  const routes: [string, Method, string, object?][] = [
    ['create', 'post', base, body],
    ['list', 'get', base],
    ['get', 'get', `${base}/${activityId}`],
    ['update', 'patch', `${base}/${activityId}`, { title: 'New' }],
    ['publish', 'post', `${base}/${activityId}/publish`],
    ['deactivate', 'delete', `${base}/${activityId}`],
  ];

  it.each(routes)('%s requires authentication', async (_n, m, url, b) => {
    await call(m, url, null).send(b).expect(401);
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  describe('create', () => {
    it.each<Actor>(['teacher', 'owner'])(
      '%s creates a DRAFT with defaults (201)',
      async (actor) => {
        actAs(actor);
        const res = await call('post', base).send(body).expect(201);
        const data = prisma.activity.create.mock.calls[0][0].data;
        expect(data).toMatchObject({
          classroomId,
          createdById: actorId,
          type: 'TP',
          format: 'FILE',
          title: 'Essay',
          description: '',
          allowLate: false,
          weightMultiplier: 1,
          maxScore: 10,
        });
        expect(data.dueAt).toEqual(new Date('2026-12-01T15:00:00.000Z'));
        expect(res.body).toMatchObject({
          id: activityId,
          state: 'DRAFT',
          weightMultiplier: 1.5,
          dueAt: '2026-12-01T15:00:00.000Z',
          opensAt: null,
          timeZone: 'America/Argentina/Cordoba',
          questions: [],
        });
      },
    );
    it('persists questions and options with positions 1..n from array order', async () => {
      await call('post', base)
        .send({
          ...body,
          format: 'MULTIPLE_CHOICE',
          questions: [
            {
              prompt: 'Q1',
              options: [
                { label: 'a', isCorrect: false },
                { label: 'b', isCorrect: true },
              ],
            },
            {
              prompt: 'Q2',
              options: [
                { label: 'c', isCorrect: true },
                { label: 'd', isCorrect: false },
              ],
            },
          ],
        })
        .expect(201);
      const { questions } = prisma.activity.create.mock.calls[0][0].data;
      expect(questions.create).toEqual([
        {
          position: 1,
          prompt: 'Q1',
          options: {
            create: [
              { position: 1, label: 'a', isCorrect: false },
              { position: 2, label: 'b', isCorrect: true },
            ],
          },
        },
        {
          position: 2,
          prompt: 'Q2',
          options: {
            create: [
              { position: 1, label: 'c', isCorrect: true },
              { position: 2, label: 'd', isCorrect: false },
            ],
          },
        },
      ]);
    });
    it.each<Actor>(['student', 'parent'])('%s receives 403 without writes', async (actor) => {
      actAs(actor);
      await call('post', base).send(body).expect(403);
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });
    it('stranger receives 404 without writes', async () => {
      actAs('stranger');
      await call('post', base).send(body).expect(404);
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });
    it('rejects TP with opensAt as VALIDATION_FAILED details on opensAt', async () => {
      const res = await call('post', base)
        .send({ ...body, opensAt: '2026-11-30T15:00:00.000Z' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([{ field: 'opensAt', messages: expect.any(Array) }]);
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });
    it.each(['2026-12-01T15:00:00.000Z', '2026-12-02T15:00:00.000Z'])(
      'rejects an EXAM whose opensAt (%s) is not before dueAt',
      async (opensAt) => {
        const res = await call('post', base)
          .send({ ...body, type: 'EXAM', opensAt })
          .expect(400);
        expect(res.body.error.details).toEqual([{ field: 'opensAt', messages: expect.any(Array) }]);
        expect(prisma.activity.create).not.toHaveBeenCalled();
      },
    );
    it('accepts an EXAM with opensAt before dueAt', async () => {
      await call('post', base)
        .send({ ...body, type: 'EXAM', opensAt: '2026-12-01T11:00:00-03:00' })
        .expect(201);
      expect(prisma.activity.create.mock.calls[0][0].data.opensAt).toEqual(
        new Date('2026-12-01T14:00:00.000Z'),
      );
    });
    it('rejects an invalid create body before reaching the service', async () => {
      const res = await call('post', base)
        .send({ ...body, maxScore: 101, secret: 'x' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(prisma.activity.create).not.toHaveBeenCalled();
    });
  });

  describe('get one', () => {
    it.each<Actor>(['teacher', 'owner'])('%s receives the teacher view', async (actor) => {
      actAs(actor);
      prisma.activity.findFirst.mockResolvedValue({
        ...row,
        _count: { questions: 1 },
        questions: [
          {
            id: 'q1',
            position: 1,
            prompt: 'Q',
            options: [{ id: 'o1', position: 1, label: 'a', isCorrect: true }],
          },
        ],
      });
      const res = await call('get', `${base}/${activityId}`).expect(200);
      expect(res.body.createdById).toBe(actorId);
      expect(res.body.questionCount).toBe(1);
      expect(res.body.questions[0].options[0].isCorrect).toBe(true);
      expect(prisma.activity.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: activityId, classroomId, deletedAt: null } }),
      );
    });
    it('student view is scoped to PUBLISHED and never selects isCorrect', async () => {
      actAs('student');
      prisma.activity.findFirst.mockResolvedValue({
        ...row,
        state: 'PUBLISHED',
        _count: { questions: 1 },
        questions: [
          { id: 'q1', position: 1, prompt: 'Q', options: [{ id: 'o1', position: 1, label: 'a' }] },
        ],
      });
      const res = await call('get', `${base}/${activityId}`).expect(200);
      const args = prisma.activity.findFirst.mock.calls[0][0];
      expect(args.where).toEqual({
        id: activityId,
        classroomId,
        deletedAt: null,
        state: 'PUBLISHED',
      });
      expect(JSON.stringify(args.select)).not.toContain('isCorrect');
      expect(JSON.stringify(args.select)).not.toContain('createdById');
      expect(JSON.stringify(res.body)).not.toContain('isCorrect');
      expect(res.body.createdById).toBeUndefined();
    });
    it('answers 404 when no activity matches classroom + id (draft for student, foreign, deleted)', async () => {
      actAs('student');
      prisma.activity.findFirst.mockResolvedValue(null);
      await call('get', `${base}/${activityId}`).expect(404);
    });
    it('answers 404 for a malformed activity id without querying', async () => {
      await call('get', `${base}/not-a-uuid`).expect(404);
      expect(prisma.activity.findFirst).not.toHaveBeenCalled();
    });
    it('denies linked parents with 403 (activities are not in the parent matrix row)', async () => {
      actAs('parent');
      await call('get', `${base}/${activityId}`).expect(403);
      expect(prisma.activity.findFirst).not.toHaveBeenCalled();
    });
    it('stranger receives 404', async () => {
      actAs('stranger');
      await call('get', `${base}/${activityId}`).expect(404);
    });
  });

  describe('list', () => {
    it('staff list with state filter, default sort dueAt asc and id tiebreaker', async () => {
      const res = await call('get', `${base}?state=DRAFT&page=2&pageSize=5`).expect(200);
      expect(res.body).toMatchObject({ page: 2, pageSize: 5, total: 1 });
      expect(res.body.items[0]).not.toHaveProperty('questions');
      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classroomId, deletedAt: null, state: 'DRAFT' },
          orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
          skip: 5,
          take: 5,
        }),
      );
      expect(prisma.activity.count).toHaveBeenCalledWith({
        where: { classroomId, deletedAt: null, state: 'DRAFT' },
      });
    });
    it('honors sort=-createdAt', async () => {
      await call('get', `${base}?sort=-createdAt`).expect(200);
      expect(prisma.activity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
      );
    });
    it.each(['DRAFT', 'PUBLISHED'])(
      'students only get PUBLISHED; state=%s is ignored for them',
      async (state) => {
        actAs('student');
        await call('get', `${base}?state=${state}`).expect(200);
        const where = { classroomId, deletedAt: null, state: 'PUBLISHED' };
        expect(prisma.activity.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
        expect(prisma.activity.count).toHaveBeenCalledWith({ where });
      },
    );
    it('denies linked parents with 403 and strangers with 404', async () => {
      actAs('parent');
      await call('get', base).expect(403);
      actAs('stranger');
      await call('get', base).expect(404);
      expect(prisma.activity.findMany).not.toHaveBeenCalled();
    });
    it('rejects unknown list query parameters and sort fields', async () => {
      await call('get', `${base}?secret=x`).expect(400);
      const res = await call('get', `${base}?sort=password`).expect(400);
      expect(res.body.error.details).toEqual([{ field: 'sort', messages: expect.any(Array) }]);
    });
  });

  describe('update', () => {
    it('updates only the provided fields (200)', async () => {
      const res = await call('patch', `${base}/${activityId}`).send({ title: 'New' }).expect(200);
      expect(prisma.activity.update).toHaveBeenCalledTimes(1);
      const data = prisma.activity.update.mock.calls[0][0].data;
      expect(data).toEqual({ title: 'New' });
      expect(prisma.question.deleteMany).not.toHaveBeenCalled();
      expect(res.body.title).toBe(row.title);
    });
    it('replaces questions atomically for MULTIPLE_CHOICE (options, then questions, then recreate)', async () => {
      prisma.activity.findFirst.mockResolvedValue({ ...row, format: 'MULTIPLE_CHOICE' });
      const order: string[] = [];
      prisma.option.deleteMany.mockImplementation(async () => order.push('options'));
      prisma.question.deleteMany.mockImplementation(async () => order.push('questions'));
      prisma.activity.update.mockImplementation(async () => {
        order.push('update');
        return row;
      });
      await call('patch', `${base}/${activityId}`)
        .send({
          questions: [
            {
              prompt: 'New Q',
              options: [
                { label: 'a', isCorrect: true },
                { label: 'b', isCorrect: false },
              ],
            },
          ],
        })
        .expect(200);
      expect(order).toEqual(['options', 'questions', 'update']);
      expect(prisma.activity.update.mock.calls[0][0].data.questions.create[0]).toMatchObject({
        position: 1,
        prompt: 'New Q',
      });
    });
    it('rejects questions on a FILE activity with 400 and no writes', async () => {
      const res = await call('patch', `${base}/${activityId}`)
        .send({
          questions: [
            {
              prompt: 'Q',
              options: [
                { label: 'a', isCorrect: true },
                { label: 'b', isCorrect: false },
              ],
            },
          ],
        })
        .expect(400);
      expect(res.body.error.details).toEqual([{ field: 'questions', messages: expect.any(Array) }]);
      expect(prisma.activity.update).not.toHaveBeenCalled();
      expect(prisma.option.deleteMany).not.toHaveBeenCalled();
      expect(prisma.question.deleteMany).not.toHaveBeenCalled();
    });
    it('re-validates the merged window: new dueAt not after the stored opensAt is 400', async () => {
      prisma.activity.findFirst.mockResolvedValue({
        ...row,
        type: 'EXAM',
        opensAt: new Date('2026-12-01T12:00:00.000Z'),
      });
      await call('patch', `${base}/${activityId}`)
        .send({ dueAt: '2026-12-01T11:00:00.000Z' })
        .expect(400);
      expect(prisma.activity.update).not.toHaveBeenCalled();
    });
    it('rejects opensAt on a TP through PATCH', async () => {
      await call('patch', `${base}/${activityId}`)
        .send({ opensAt: '2026-11-30T10:00:00.000Z' })
        .expect(400);
      expect(prisma.activity.update).not.toHaveBeenCalled();
    });
    it('rejects type and format changes and explicit nulls', async () => {
      await call('patch', `${base}/${activityId}`).send({ type: 'EXAM' }).expect(400);
      await call('patch', `${base}/${activityId}`).send({ title: null }).expect(400);
    });
    it.each<Actor>(['student', 'parent'])('%s receives 403', async (actor) => {
      actAs(actor);
      await call('patch', `${base}/${activityId}`).send({ title: 'x' }).expect(403);
      expect(prisma.activity.update).not.toHaveBeenCalled();
    });
    it('stranger gets 404; unknown or deleted activity gets 404', async () => {
      actAs('stranger');
      await call('patch', `${base}/${activityId}`).send({ title: 'x' }).expect(404);
      actAs('teacher');
      // The row lock matches nothing (unknown, deactivated or foreign activity): no read, no write.
      prisma.$queryRaw.mockResolvedValue([]);
      await call('patch', `${base}/${activityId}`).send({ title: 'x' }).expect(404);
      expect(prisma.activity.findFirst).not.toHaveBeenCalled();
      expect(prisma.activity.update).not.toHaveBeenCalled();
      expect(prisma.question.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    const url = `${base}/${activityId}/publish`;
    const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
    const draft = (overrides: object = {}) => ({ ...row, dueAt: future(), ...overrides });
    const validQuestion = { options: [{ isCorrect: true }, { isCorrect: false }] };
    const students = [
      '55555555-5555-4555-8555-555555555551',
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555553',
    ];
    beforeEach(() => {
      prisma.activity.findFirst.mockResolvedValue(draft());
      prisma.activity.update.mockResolvedValue(
        draft({ state: 'PUBLISHED', publishedAt: new Date() }),
      );
      prisma.classroomMembership.findMany.mockResolvedValue(students.map((userId) => ({ userId })));
    });

    it('teacher publishes: locks the row, flips state with a server timestamp, answers 200', async () => {
      const res = await call('post', url).expect(200);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const arg = prisma.activity.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: activityId, classroomId, deletedAt: null });
      expect(arg.data).toEqual({ state: 'PUBLISHED', publishedAt: expect.any(Date) });
      expect(res.body).toMatchObject({ id: activityId, state: 'PUBLISHED', questions: [] });
    });

    it('records one activity_published notification per active student, inside the transaction', async () => {
      await call('post', url).expect(200);
      expect(recorder.record).toHaveBeenCalledTimes(students.length);
      for (const [tx, request] of recorder.record.mock.calls) {
        expect(tx).toBe(prisma);
        expect(request).toEqual({
          kind: 'activity_published',
          classroomId,
          resourceId: activityId,
          recipientId: expect.any(String),
        });
      }
      expect(recorder.record.mock.calls.map(([, r]) => r.recipientId)).toEqual(students);
    });

    it('selects only active, non-deleted students other than the actor', async () => {
      await call('post', url).expect(200);
      expect(prisma.classroomMembership.findMany.mock.calls[0][0].where).toEqual({
        classroomId,
        role: ClassroomRole.STUDENT,
        state: 'ACTIVE',
        deletedAt: null,
        userId: { not: actorId },
      });
    });

    it('a classroom without students publishes with no notifications', async () => {
      prisma.classroomMembership.findMany.mockResolvedValue([]);
      await call('post', url).expect(200);
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('answers 500 when recording a notification fails (the transaction callback rejects)', async () => {
      recorder.record.mockRejectedValueOnce(new Error('Invalid notification request'));
      const res = await call('post', url).expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('answers 409 CONFLICT when already published, with no write and no notification', async () => {
      prisma.activity.findFirst.mockResolvedValue(draft({ state: 'PUBLISHED' }));
      const res = await call('post', url).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(prisma.activity.update).not.toHaveBeenCalled();
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('rejects a dueAt already in the past with 400 on dueAt', async () => {
      prisma.activity.findFirst.mockResolvedValue(draft({ dueAt: new Date(Date.now() - 60_000) }));
      const res = await call('post', url).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([{ field: 'dueAt', messages: expect.any(Array) }]);
      expect(prisma.activity.update).not.toHaveBeenCalled();
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('rejects a MULTIPLE_CHOICE activity without questions with 400 on questions', async () => {
      prisma.activity.findFirst.mockResolvedValue(
        draft({ format: 'MULTIPLE_CHOICE', questions: [] }),
      );
      const res = await call('post', url).expect(400);
      expect(res.body.error.details).toEqual([{ field: 'questions', messages: expect.any(Array) }]);
      expect(prisma.activity.update).not.toHaveBeenCalled();
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('rejects a question whose options are not 2+ with exactly one correct', async () => {
      prisma.activity.findFirst.mockResolvedValue(
        draft({ format: 'MULTIPLE_CHOICE', questions: [{ options: [{ isCorrect: true }] }] }),
      );
      await call('post', url).expect(400);
      prisma.activity.findFirst.mockResolvedValue(
        draft({
          format: 'MULTIPLE_CHOICE',
          questions: [{ options: [{ isCorrect: false }, { isCorrect: false }] }],
        }),
      );
      await call('post', url).expect(400);
      expect(prisma.activity.update).not.toHaveBeenCalled();
    });

    it('publishes a valid MULTIPLE_CHOICE activity', async () => {
      prisma.activity.findFirst.mockResolvedValue(
        draft({ format: 'MULTIPLE_CHOICE', questions: [validQuestion] }),
      );
      await call('post', url).expect(200);
      expect(prisma.activity.update).toHaveBeenCalledTimes(1);
    });

    it.each<Actor>(['student', 'parent'])(
      '%s receives 403 without lock, write or notification',
      async (actor) => {
        actAs(actor);
        await call('post', url).expect(403);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(recorder.record).not.toHaveBeenCalled();
      },
    );

    it('stranger gets 404', async () => {
      actAs('stranger');
      await call('post', url).expect(404);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('unknown, deactivated or foreign activity gets 404 (the lock matches nothing)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await call('post', url).expect(404);
      expect(prisma.activity.update).not.toHaveBeenCalled();
      expect(recorder.record).not.toHaveBeenCalled();
    });

    it('a non-UUID activity id gets 404 without opening a transaction', async () => {
      await call('post', `${base}/not-a-uuid/publish`).expect(404);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('sets deletedAt scoped by classroom + id and answers 204', async () => {
      await call('delete', `${base}/${activityId}`).expect(204);
      expect(prisma.activity.updateMany).toHaveBeenCalledWith({
        where: { id: activityId, classroomId, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });
    it('answers 404 when nothing matches (already deleted or foreign)', async () => {
      prisma.activity.updateMany.mockResolvedValue({ count: 0 });
      await call('delete', `${base}/${activityId}`).expect(404);
    });
    it.each<Actor>(['student', 'parent'])('%s receives 403 without writes', async (actor) => {
      actAs(actor);
      await call('delete', `${base}/${activityId}`).expect(403);
      expect(prisma.activity.updateMany).not.toHaveBeenCalled();
    });
    it('stranger receives 404 without writes', async () => {
      actAs('stranger');
      await call('delete', `${base}/${activityId}`).expect(404);
      expect(prisma.activity.updateMany).not.toHaveBeenCalled();
    });
  });

  it('OpenAPI: student option has no isCorrect, teacher option does; GET one is oneOf', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const schemas = doc.components?.schemas as Record<string, { properties?: object }>;
    expect(Object.keys(schemas.StudentOptionDto?.properties ?? {})).toEqual([
      'id',
      'position',
      'label',
    ]);
    expect(Object.keys(schemas.TeacherOptionDto?.properties ?? {})).toContain('isCorrect');
    const get = doc.paths[`/classrooms/{id}/activities/{activityId}`]?.get;
    const ok = get?.responses['200'] as {
      content: Record<string, { schema: { oneOf: unknown[] } }>;
    };
    expect(ok.content['application/json']?.schema.oneOf).toHaveLength(2);
  });
});
