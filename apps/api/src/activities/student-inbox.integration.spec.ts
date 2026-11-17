import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesModule } from './activities.module';

const NOW = new Date('2035-06-01T12:00:00.000Z');
const instant = (delta: number) => new Date(NOW.getTime() + delta);
const statuses = ['pending', 'submitted', 'graded', 'overdue'] as const;

// Real PostgreSQL queries behind the public HTTP adapter. Only authentication is synthetic.
describe('student inbox PostgreSQL HTTP — card #29 S2-S5', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const [teacher, student, classmate, parent, stranger, classroom, foreignClassroom] = Array.from(
    { length: 7 },
    () => randomUUID(),
  );
  const users: string[] = [teacher, student, classmate, parent, stranger];
  const ids: Record<string, string> = {};
  const base = `/classrooms/${classroom}/activities`;
  const get = (query = '', actor = student) =>
    request(app.getHttpServer()).get(`${base}${query}`).set('Authorization', actor);
  const windows = [
    ['before due', 1, false, null, 'FILE', 'pending', true],
    ['at due', 0, false, null, 'FILE', 'pending', true],
    ['after due', -1, false, null, 'FILE', 'overdue', false],
    ['late allowed', -1, true, null, 'FILE', 'overdue', true],
    ['before opening', 1000, false, 1, 'FILE', 'pending', false],
    ['at opening', 1000, false, 0, 'FILE', 'pending', true],
    ['after opening', 1000, false, -1, 'FILE', 'pending', true],
    ['unsupported MC', 1000, true, null, 'MULTIPLE_CHOICE', 'pending', false],
  ] as const;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({
          ...authTestConfig(),
          databaseUrl: loadIsolatedTestDatabaseUrl(),
        }),
        ActivitiesModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header || !users.includes(header)) throw new UnauthorizedException();
              return { userId: header, sessionId: randomUUID() };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.createMany({
      data: users.map((id) => ({
        id,
        displayName: 'Synthetic inbox user',
        email: `${id}@example.invalid`,
        passwordHash: 'synthetic-unused',
        registrationPath: 'INDEPENDENT_TEACHER',
      })),
    });
    await prisma.classroom.createMany({
      data: [classroom, foreignClassroom].map((id) => ({
        id,
        name: 'Synthetic inbox classroom',
        independentTeacherId: teacher,
      })),
    });
    await prisma.classroomMembership.createMany({
      data: [student, classmate].map((userId) => ({
        classroomId: classroom,
        userId,
        role: 'STUDENT',
      })),
    });
    await prisma.parentLink.create({
      data: { parentId: parent, childId: student, classroomId: classroom },
    });
    for (const [title, due, allowLate, opens, format] of windows) {
      const row = await prisma.activity.create({
        data: {
          classroomId: classroom,
          createdById: teacher,
          title,
          type: opens === null ? 'TP' : 'EXAM',
          format,
          state: 'PUBLISHED',
          publishedAt: NOW,
          dueAt: instant(due),
          opensAt: opens === null ? null : instant(opens),
          allowLate,
          maxScore: 100,
          weightMultiplier: 1.5,
          ...(format === 'MULTIPLE_CHOICE'
            ? {
                questions: {
                  create: {
                    position: 1,
                    prompt: 'Private prompt',
                    options: {
                      create: [
                        { position: 1, label: 'Private correct', isCorrect: true },
                        { position: 2, label: 'Private wrong', isCorrect: false },
                      ],
                    },
                  },
                },
              }
            : {}),
        },
      });
      ids[title] = row.id;
    }
    for (const title of [
      'submitted',
      'graded',
      'other student graded',
      'draft',
      'deleted',
      'foreign',
    ]) {
      const row = await prisma.activity.create({
        data: {
          classroomId: title === 'foreign' ? foreignClassroom : classroom,
          createdById: teacher,
          title,
          type: 'TP',
          format: 'FILE',
          state: title === 'draft' ? 'DRAFT' : 'PUBLISHED',
          publishedAt: title === 'draft' ? null : NOW,
          dueAt: instant(-1),
          maxScore: 100,
          allowLate: title === 'submitted' || title === 'graded',
          deletedAt: title === 'deleted' ? NOW : null,
        },
      });
      ids[title] = row.id;
      if (['submitted', 'graded', 'other student graded'].includes(title)) {
        await prisma.submission.create({
          data: {
            activityId: row.id,
            studentId: title === 'other student graded' ? classmate : student,
            submittedAt: instant(-2),
            idempotencyKey: randomUUID(),
            ...(title === 'submitted'
              ? {}
              : {
                  grade: {
                    create: {
                      graderId: teacher,
                      score: 0,
                      feedback: 'Private feedback',
                      pointsAwarded: 0,
                      typeWeight: 1,
                      weightMultiplier: 1,
                      gradedAt: NOW,
                    },
                  },
                }),
          },
        });
      }
    }
  }, 30_000);

  afterAll(async () => {
    try {
      if (prisma)
        await prisma.$transaction(async (tx) => {
          const scope = { classroomId: { in: [classroom, foreignClassroom] } };
          await tx.grade.deleteMany({ where: { submission: { activity: scope } } });
          await tx.submission.deleteMany({ where: { activity: scope } });
          await tx.option.deleteMany({ where: { question: { activity: scope } } });
          await tx.question.deleteMany({ where: { activity: scope } });
          await tx.activity.deleteMany({ where: scope });
          await tx.parentLink.deleteMany({ where: scope });
          await tx.classroomMembership.deleteMany({ where: scope });
          await tx.classroom.deleteMany({ where: { id: { in: [classroom, foreignClassroom] } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
    } finally {
      await app?.close();
      vi.useRealTimers();
    }
  }, 30_000);

  it.each(windows)(
    '%s derives status and supported submission eligibility at one server instant',
    async (title, _due, _late, _opens, _format, status, canSubmit) => {
      const { body } = await get().expect(200);
      expect(body.items.find((item: { id: string }) => item.id === ids[title])).toMatchObject({
        state: 'PUBLISHED',
        status,
        canSubmit,
        weightMultiplier: 1.5,
      });
    },
  );

  it('prioritizes a zero-score grade over submission, and submission over overdue', async () => {
    const { body } = await get().expect(200);
    for (const status of ['submitted', 'graded']) {
      expect(body.items.find((item: { id: string }) => item.id === ids[status])).toMatchObject({
        status,
        canSubmit: false,
      });
    }
    expect(
      body.items.find((item: { id: string }) => item.id === ids['other student graded']),
    ).toMatchObject({ status: 'overdue', canSubmit: false });
  });

  it.each(statuses)(
    'filters %s before pagination and count, with stable dueAt/id ordering',
    async (status) => {
      const all = (await get().expect(200)).body.items as {
        id: string;
        status: string;
        dueAt: string;
      }[];
      const expectedIds = [
        ...windows.filter((entry) => entry[5] === status).map((entry) => ids[entry[0]]),
        ...(status === 'overdue' ? [ids['other student graded']] : []),
        ...(['submitted', 'graded'].includes(status) ? [ids[status]] : []),
      ];
      const expected = all.filter((item) => expectedIds.includes(item.id));
      expect(expected).toHaveLength(expectedIds.length);
      for (let page = 1; page <= expected.length + 1; page++) {
        const { body } = await get(`?status=${status}&pageSize=1&page=${page}`).expect(200);
        expect(body.total).toBe(expected.length);
        expect(body.items.map((item: { id: string }) => item.id)).toEqual(
          expected.slice(page - 1, page).map((item) => item.id),
        );
      }
      expect(all.map((item) => item.id)).toEqual(
        [...all]
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id))
          .map((item) => item.id),
      );
    },
  );

  it('uses only the requesting student records for filters and status', async () => {
    const { body } = await get('?status=graded', classmate).expect(200);
    expect(body.total).toBe(1);
    expect(body.items.map((item: { id: string }) => item.id)).toEqual([
      ids['other student graded'],
    ]);
    expect((await get('?status=submitted', classmate).expect(200)).body.total).toBe(0);
  });

  it('hides drafts, deleted/foreign activities, questions and all submission/grade records', async () => {
    const { body } = await get('?state=DRAFT').expect(200);
    expect(body.total).toBe(11);
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'id',
          'classroomId',
          'type',
          'format',
          'state',
          'title',
          'description',
          'opensAt',
          'dueAt',
          'allowLate',
          'maxScore',
          'weightMultiplier',
          'publishedAt',
          'timeZone',
          'questionCount',
          'createdAt',
          'updatedAt',
          'status',
          'canSubmit',
        ].sort(),
      );
      expect([ids.draft, ids.deleted, ids.foreign]).not.toContain(item.id);
    }
    expect(JSON.stringify(body)).not.toMatch(/Private|isCorrect|studentId|idempotencyKey/);
    const detail = (await get(`/${ids['unsupported MC']}`).expect(200)).body;
    expect(detail).not.toHaveProperty('status');
    expect(detail).not.toHaveProperty('canSubmit');
    expect(detail.questions).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain('isCorrect');
  });

  it('combines student status with published-only scope and supports descending sorting', async () => {
    const { body } = await get('?status=overdue&state=DRAFT&sort=-dueAt&pageSize=100').expect(200);
    const descending = (await get('?sort=-dueAt&pageSize=100').expect(200)).body.items as {
      id: string;
      dueAt: string;
    }[];
    expect(descending.map((item) => item.id)).toEqual(
      [...descending]
        .sort((a, b) => b.dueAt.localeCompare(a.dueAt) || a.id.localeCompare(b.id))
        .map((item) => item.id),
    );
    expect(body.total).toBe(3);
    expect(body.items.map((item: { id: string }) => item.id).sort()).toEqual(
      [ids['after due'], ids['late allowed'], ids['other student graded']].sort(),
    );
    expect(
      body.items.every(
        (item: { state: string; status: string }) =>
          item.state === 'PUBLISHED' && item.status === 'overdue',
      ),
    ).toBe(true);
  });

  it('preserves authentication and classroom access boundaries', async () => {
    await request(app.getHttpServer()).get(base).expect(401);
    await get('', stranger).expect(404);
    await get('', parent).expect(403);
    await request(app.getHttpServer())
      .get(`/classrooms/${foreignClassroom}/activities`)
      .set('Authorization', student)
      .expect(404);
  });

  it.each(['pending', 'submitted', 'graded', 'overdue', 'INVALID', ''])(
    'preserves exact staff whitelist rejection for status=%s',
    async (status) => {
      const { body } = await get(`?status=${status}`, teacher).expect(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details).toEqual([
        { field: 'status', messages: ['property status should not exist'] },
      ]);
    },
  );

  it.each(['PENDING', 'unknown', '', 'pending&status=graded'])(
    'rejects invalid student status=%s',
    async (status) => {
      const { body } = await get(`?status=${status}`).expect(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details[0].field).toBe('status');
    },
  );

  it('preserves staff payload, state filtering and detail view without inbox fields', async () => {
    const { body } = await get('?state=DRAFT', teacher).expect(200);
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: ids.draft, state: 'DRAFT' });
    expect(body.items[0]).not.toHaveProperty('status');
    expect(body.items[0]).not.toHaveProperty('canSubmit');
    const detail = (await get(`/${ids['unsupported MC']}`, teacher).expect(200)).body;
    expect(detail.questions[0].options[0].isCorrect).toBe(true);
    expect(detail).not.toHaveProperty('status');
    expect(detail).not.toHaveProperty('canSubmit');
  });
});
