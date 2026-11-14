import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, PrismaClient, RegistrationPath, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import { ActivitiesModule } from './activities.module';
import { futureInstant, withOffset } from '../testing/relative-dates';

const databaseUrl = loadIsolatedTestDatabaseUrl();
const SCHOOL_ZONE = 'America/Argentina/Cordoba';
const DEFAULT_ZONE = 'America/Argentina/Buenos_Aires';

const mcQuestions = (prefix: string, count = 2) =>
  Array.from({ length: count }, (_, q) => ({
    prompt: `${prefix} question ${q + 1}`,
    options: [
      { label: `${prefix} q${q + 1} wrong`, isCorrect: false },
      { label: `${prefix} q${q + 1} right`, isCorrect: true },
      { label: `${prefix} q${q + 1} other`, isCorrect: false },
    ],
  }));

describe('activities draft CRUD PostgreSQL HTTP — activities-and-grading, data and classrooms-and-roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtureReady = false;
  const [teacher, student, parent, stranger, otherTeacher, owner, admin, schoolTeacher] =
    Array.from({ length: 8 }, () => randomUUID());
  const users = [teacher, student, parent, stranger, otherTeacher, owner, admin, schoolTeacher];
  // A: independent teacher's classroom; B: school classroom; C: another teacher's classroom.
  const [classroomA, classroomB, classroomC, school] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  const classrooms = [classroomA, classroomB, classroomC];
  const dueAt = withOffset(futureInstant(30, 15), '-03:00');
  const dueAtUtc = futureInstant(30, 15).toISOString();
  const token = (actor: string) => `Bearer activities-test:${actor}`;
  const api = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    actor: string,
    classroom: string = classroomA,
  ) => {
    const http = request(app.getHttpServer());
    return http[method](`/classrooms/${classroom}/activities${path}`).set(
      'Authorization',
      token(actor),
    );
  };
  const tpBody = (overrides: object = {}) => ({
    type: 'TP',
    format: 'FILE',
    title: `Fixture ${randomUUID()}`,
    dueAt,
    maxScore: 10,
    ...overrides,
  });
  const mcBody = (overrides: object = {}) =>
    tpBody({ format: 'MULTIPLE_CHOICE', questions: mcQuestions('mc'), ...overrides });
  const createAs = async (actor: string, classroom: string, body: object) =>
    (await api('post', '', actor, classroom).send(body).expect(201)).body as {
      id: string;
      [key: string]: unknown;
    };
  const publish = (id: string) =>
    prisma.activity.update({
      where: { id },
      data: { state: 'PUBLISHED', publishedAt: new Date() },
    });
  /** Submissions are FILE-only today, so the lock rule is exercised by seeding the row directly. */
  const seedSubmission = (activityId: string, studentId: string = student) =>
    prisma.submission.create({
      data: {
        activityId,
        studentId,
        submittedAt: new Date(),
        idempotencyKey: `lock-${randomUUID()}`,
      },
    });
  const rowCounts = async () => ({
    activities: await prisma.activity.count({ where: { classroomId: { in: classrooms } } }),
    questions: await prisma.question.count({
      where: { activity: { classroomId: { in: classrooms } } },
    }),
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), ActivitiesModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer activities-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer activities-test:'.length),
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
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: `Activities ${id}`,
          email: `activities-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-activities-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.school.create({
        data: {
          id: school,
          name: `Activities ${school}`,
          slug: `activities-${school}`,
          timeZone: SCHOOL_ZONE,
        },
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: school, userId: owner, role: SchoolRole.OWNER },
          { schoolId: school, userId: admin, role: SchoolRole.ADMIN },
          { schoolId: school, userId: schoolTeacher, role: SchoolRole.TEACHER },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: `Activities A ${classroomA}`, independentTeacherId: teacher },
          { id: classroomB, name: `Activities B ${classroomB}`, schoolId: school },
          {
            id: classroomC,
            name: `Activities C ${classroomC}`,
            independentTeacherId: otherTeacher,
          },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: student, role: ClassroomRole.STUDENT },
          { classroomId: classroomB, userId: schoolTeacher, role: ClassroomRole.TEACHER },
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: student, classroomId: classroomA },
      });
    });
    fixtureReady = true;
  }, 30_000);

  afterAll(async () => {
    try {
      if (fixtureReady)
        await prisma.$transaction(async (tx) => {
          const where = { activity: { classroomId: { in: classrooms } } };
          await tx.submission.deleteMany({ where });
          await tx.option.deleteMany({ where: { question: where } });
          await tx.question.deleteMany({ where });
          await tx.activity.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.parentLink.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroomMembership.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroom.deleteMany({ where: { id: { in: classrooms } } });
          await tx.schoolMember.deleteMany({ where: { schoolId: school } });
          await tx.school.deleteMany({ where: { id: school } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
    } finally {
      await app?.close();
    }
  }, 30_000);

  it('teacher creates a DRAFT with defaults, UTC ISO instants and the default time zone', async () => {
    const res = await api('post', '', teacher).send(tpBody()).expect(201);
    expect(res.body).toMatchObject({
      classroomId: classroomA,
      createdById: teacher,
      type: 'TP',
      format: 'FILE',
      state: 'DRAFT',
      description: '',
      opensAt: null,
      dueAt: dueAtUtc,
      allowLate: false,
      maxScore: 10,
      weightMultiplier: 1,
      publishedAt: null,
      timeZone: DEFAULT_ZONE,
      questionCount: 0,
      questions: [],
    });
    expect(typeof res.body.weightMultiplier).toBe('number');
    expect(res.body.createdAt).toMatch(/Z$/);
    const stored = await prisma.activity.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.dueAt.toISOString()).toBe(dueAtUtc);
    expect(stored.deletedAt).toBeNull();
  });

  it('keeps explicit values: allowLate, a 2-decimal weightMultiplier and the description', async () => {
    const res = await api('post', '', teacher)
      .send(tpBody({ allowLate: true, weightMultiplier: 1.75, description: 'Read chapter 3' }))
      .expect(201);
    expect(res.body).toMatchObject({
      allowLate: true,
      weightMultiplier: 1.75,
      description: 'Read chapter 3',
    });
  });

  it('school Owner, Admin and the classroom teacher create in a school classroom with its time zone', async () => {
    for (const actor of [owner, admin, schoolTeacher]) {
      const res = await api('post', '', actor, classroomB).send(tpBody()).expect(201);
      expect(res.body).toMatchObject({
        classroomId: classroomB,
        createdById: actor,
        timeZone: SCHOOL_ZONE,
      });
    }
  });

  it('persists a multiple-choice activity with positions 1..n and exposes isCorrect to staff only', async () => {
    const created = await createAs(
      teacher,
      classroomA,
      mcBody({ questions: mcQuestions('persist', 3) }),
    );
    const view = (await api('get', `/${created.id}`, teacher).expect(200)).body;
    expect(view.questionCount).toBe(3);
    expect(view.questions.map((q: { position: number }) => q.position)).toEqual([1, 2, 3]);
    for (const q of view.questions) {
      expect(q.options.map((o: { position: number }) => o.position)).toEqual([1, 2, 3]);
      expect(q.options.map((o: { isCorrect: boolean }) => o.isCorrect)).toEqual([
        false,
        true,
        false,
      ]);
    }
  });

  it('role matrix: student and parent are 403 on mutations, stranger is 404, nothing is written', async () => {
    const target = await createAs(teacher, classroomA, tpBody());
    const before = await rowCounts();
    for (const actor of [student, parent]) {
      await api('post', '', actor).send(tpBody()).expect(403);
      await api('patch', `/${target.id}`, actor).send({ title: 'Hijack' }).expect(403);
      await api('delete', `/${target.id}`, actor).expect(403);
    }
    await api('post', '', stranger).send(tpBody()).expect(404);
    await api('patch', `/${target.id}`, stranger).send({ title: 'Hijack' }).expect(404);
    await api('delete', `/${target.id}`, stranger).expect(404);
    await api('get', `/${target.id}`, stranger).expect(404);
    await api('get', '', stranger).expect(404);
    expect(await rowCounts()).toEqual(before);
    const stored = await prisma.activity.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored.title).toBe(target.title);
    expect(stored.deletedAt).toBeNull();
  });

  it('a teacher of another classroom (even a school teacher) gets 404 on classroom A', async () => {
    await api('post', '', otherTeacher).send(tpBody()).expect(404);
    await api('post', '', schoolTeacher, classroomA).send(tpBody()).expect(404);
  });

  it('parents are outside the activity matrix: 403 on get and list', async () => {
    const target = await createAs(teacher, classroomA, tpBody());
    await publish(target.id);
    await api('get', `/${target.id}`, parent).expect(403);
    await api('get', '', parent).expect(403);
  });

  it('foreign activity id is 404 on get and update, direct or with tampered classroom context', async () => {
    const own = await createAs(teacher, classroomA, tpBody());
    const foreign = await createAs(otherTeacher, classroomC, tpBody());
    const notFound = (response: { body: unknown }) => {
      expect(response.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
      expect(JSON.stringify(response.body)).not.toContain(foreign.title as string);
    };
    await assertResourceAuthorization({
      allowedResourceId: own.id,
      foreignResourceId: foreign.id,
      interaction: { classroomId: classroomC },
      deniedStatus: 404,
      request: (id, interaction) => {
        const req = api('get', `/${id}`, teacher);
        return interaction === undefined ? req : req.query(interaction);
      },
      assertAllowed: (response) => expect(response.body).toMatchObject({ id: own.id }),
      assertDenied: notFound,
    });
    await assertResourceAuthorization({
      allowedResourceId: own.id,
      foreignResourceId: foreign.id,
      interaction: { classroomId: classroomC },
      deniedStatus: 404,
      request: (id, interaction) => {
        const req = api('patch', `/${id}`, teacher).send({ title: 'Edited' });
        return interaction === undefined ? req : req.query(interaction);
      },
      assertDenied: notFound,
    });
    await api('delete', `/${foreign.id}`, teacher).expect(404);
    const untouched = await prisma.activity.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.title).toBe(foreign.title);
    expect(untouched.deletedAt).toBeNull();
  });

  it('student view never contains isCorrect anywhere in the raw body and hides drafts', async () => {
    const draft = await createAs(teacher, classroomA, mcBody({ questions: mcQuestions('secret') }));
    await api('get', `/${draft.id}`, student).expect(404);

    await publish(draft.id);
    const studentRes = await api('get', `/${draft.id}`, student).expect(200);
    expect(studentRes.text).not.toMatch(/isCorrect/i);
    expect(studentRes.text).not.toContain('createdById');
    expect(studentRes.body.questions).toHaveLength(2);
    for (const q of studentRes.body.questions) {
      for (const option of q.options)
        expect(Object.keys(option).sort()).toEqual(['id', 'label', 'position']);
    }
    const teacherRes = await api('get', `/${draft.id}`, teacher).expect(200);
    expect(teacherRes.text).toContain('isCorrect');
    // The list never carries questions, so it cannot leak them either.
    const list = await api('get', '', student).expect(200);
    expect(list.text).not.toMatch(/isCorrect/i);
    expect(list.body.items[0]).not.toHaveProperty('questions');
  });

  it('list: students see PUBLISHED only (state filter ignored); staff can filter by state', async () => {
    const draft = await createAs(teacher, classroomA, tpBody());
    const published = await createAs(teacher, classroomA, tpBody());
    await publish(published.id);

    const ids = (res: { body: { items: { id: string }[] } }) => res.body.items.map((i) => i.id);
    const studentAll = ids(await api('get', '?pageSize=100', student).expect(200));
    expect(studentAll).toContain(published.id);
    expect(studentAll).not.toContain(draft.id);
    const studentDrafts = ids(await api('get', '?state=DRAFT&pageSize=100', student).expect(200));
    expect(studentDrafts).toContain(published.id);
    expect(studentDrafts).not.toContain(draft.id);

    const staffDrafts = await api('get', '?state=DRAFT&pageSize=100', teacher).expect(200);
    expect(ids(staffDrafts)).toContain(draft.id);
    expect(ids(staffDrafts)).not.toContain(published.id);
    for (const item of staffDrafts.body.items) expect(item.state).toBe('DRAFT');
    const staffPublished = ids(
      await api('get', '?state=PUBLISHED&pageSize=100', teacher).expect(200),
    );
    expect(staffPublished).toContain(published.id);
    expect(staffPublished).not.toContain(draft.id);
  });

  it('list: stable pagination, dueAt ordering with id tiebreaker, sort direction and total', async () => {
    // A dedicated classroom keeps counts and ordering independent of the other tests.
    const classroom = randomUUID();
    await prisma.classroom.create({
      data: { id: classroom, name: `Activities list ${classroom}`, independentTeacherId: teacher },
    });
    classrooms.push(classroom);
    const tie = withOffset(futureInstant(39, 13), '-03:00');
    const early = withOffset(futureInstant(34, 13), '-03:00');
    const late = withOffset(futureInstant(49, 13), '-03:00');
    const made = [
      await createAs(teacher, classroom, tpBody({ dueAt: tie })),
      await createAs(teacher, classroom, tpBody({ dueAt: tie })),
      await createAs(teacher, classroom, tpBody({ dueAt: tie })),
      await createAs(teacher, classroom, tpBody({ dueAt: late })),
      await createAs(teacher, classroom, tpBody({ dueAt: early })),
    ];
    const tied = made
      .slice(0, 3)
      .map((m) => m.id)
      .sort();
    const expected = [made[4].id, ...tied, made[3].id];

    const full = await api('get', '', teacher, classroom).expect(200);
    expect(full.body).toMatchObject({ page: 1, pageSize: 20, total: 5 });
    expect(full.body.items.map((i: { id: string }) => i.id)).toEqual(expected);

    const pages: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await api('get', `?pageSize=2&page=${page}`, teacher, classroom).expect(200);
      expect(res.body).toMatchObject({ page, pageSize: 2, total: 5 });
      pages.push(...res.body.items.map((i: { id: string }) => i.id));
    }
    expect(pages).toEqual(expected);

    // The id tiebreaker stays ascending whatever the direction of the primary field.
    const desc = await api('get', '?sort=-dueAt', teacher, classroom).expect(200);
    expect(desc.body.items.map((i: { id: string }) => i.id)).toEqual([
      made[3].id,
      ...tied,
      made[4].id,
    ]);
    const byCreated = await api('get', '?sort=createdAt', teacher, classroom).expect(200);
    expect(byCreated.body.items).toHaveLength(5);
    await api('get', '?sort=title', teacher, classroom).expect(400);
  });

  it('soft delete keeps the row and its questions but hides the activity everywhere', async () => {
    const created = await createAs(teacher, classroomA, mcBody({ questions: mcQuestions('del') }));
    await publish(created.id);
    await api('delete', `/${created.id}`, teacher).expect(204);

    const row = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(await prisma.question.count({ where: { activityId: created.id } })).toBe(2);
    await api('get', `/${created.id}`, teacher).expect(404);
    await api('get', `/${created.id}`, student).expect(404);
    const staffList = await api('get', '?pageSize=100', teacher).expect(200);
    const studentList = await api('get', '?pageSize=100', student).expect(200);
    for (const res of [staffList, studentList]) {
      expect(res.body.items.map((i: { id: string }) => i.id)).not.toContain(created.id);
    }
    await api('delete', `/${created.id}`, teacher).expect(404);
    await api('patch', `/${created.id}`, teacher).send({ title: 'Zombie' }).expect(404);
    const after = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.title).toBe(created.title);
  });

  it('cross-field rules: TP cannot set opensAt, EXAM needs opensAt strictly before dueAt', async () => {
    const before = await rowCounts();
    const tp = await api('post', '', teacher)
      .send(tpBody({ opensAt: withOffset(futureInstant(29, 13), '-03:00') }))
      .expect(400);
    expect(tp.body.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'opensAt', messages: expect.any(Array) }],
    });
    for (const opensAt of [dueAt, withOffset(futureInstant(31, 13), '-03:00')]) {
      const exam = await api('post', '', teacher)
        .send(tpBody({ type: 'EXAM', opensAt }))
        .expect(400);
      expect(exam.body.error.details).toEqual([{ field: 'opensAt', messages: expect.any(Array) }]);
    }
    expect(await rowCounts()).toEqual(before);
    const ok = await createAs(
      teacher,
      classroomA,
      tpBody({ type: 'EXAM', opensAt: withOffset(futureInstant(30, 11), '-03:00') }),
    );
    expect(ok).toMatchObject({
      type: 'EXAM',
      opensAt: futureInstant(30, 11).toISOString(),
      dueAt: dueAtUtc,
    });
  });

  it('PATCH changes only provided fields and validates the merged window', async () => {
    const exam = await createAs(
      teacher,
      classroomA,
      tpBody({
        type: 'EXAM',
        opensAt: withOffset(futureInstant(30, 11), '-03:00'),
        description: 'keep me',
      }),
    );
    const edited = (
      await api('patch', `/${exam.id}`, teacher)
        .send({ title: 'Renamed', maxScore: 80 })
        .expect(200)
    ).body;
    expect(edited).toMatchObject({
      title: 'Renamed',
      maxScore: 80,
      description: 'keep me',
      opensAt: futureInstant(30, 11).toISOString(),
      dueAt: dueAtUtc,
    });
    // New dueAt falls before the stored opensAt.
    await api('patch', `/${exam.id}`, teacher)
      .send({ dueAt: withOffset(futureInstant(30, 10), '-03:00') })
      .expect(400);
    // New opensAt is not before the stored dueAt.
    await api('patch', `/${exam.id}`, teacher).send({ opensAt: dueAt }).expect(400);
    const tp = await createAs(teacher, classroomA, tpBody());
    await api('patch', `/${tp.id}`, teacher)
      .send({ opensAt: withOffset(futureInstant(29, 13), '-03:00') })
      .expect(400);
    await api('patch', `/${tp.id}`, teacher).send({ type: 'EXAM' }).expect(400);
    const unchanged = await prisma.activity.findUniqueOrThrow({ where: { id: exam.id } });
    expect(unchanged.dueAt.toISOString()).toBe(dueAtUtc);
  });

  it('PATCH questions replaces every question and option atomically; other PATCHes keep them', async () => {
    const created = await createAs(
      teacher,
      classroomA,
      mcBody({ questions: mcQuestions('old', 2) }),
    );
    const oldQuestionIds = (
      await prisma.question.findMany({ where: { activityId: created.id } })
    ).map((q) => q.id);

    await api('patch', `/${created.id}`, teacher).send({ title: 'Title only' }).expect(200);
    expect(await prisma.question.count({ where: { activityId: created.id } })).toBe(2);

    const replaced = (
      await api('patch', `/${created.id}`, teacher)
        .send({ questions: mcQuestions('new', 1) })
        .expect(200)
    ).body;
    expect(replaced.questionCount).toBe(1);
    expect(replaced.questions[0]).toMatchObject({ position: 1, prompt: 'new question 1' });
    expect(replaced.questions[0].options.map((o: { label: string }) => o.label)).toEqual([
      'new q1 wrong',
      'new q1 right',
      'new q1 other',
    ]);
    expect(await prisma.question.count({ where: { activityId: created.id } })).toBe(1);
    expect(await prisma.question.count({ where: { id: { in: oldQuestionIds } } })).toBe(0);
    expect(await prisma.option.count({ where: { questionId: { in: oldQuestionIds } } })).toBe(0);
  });

  it('PATCH questions on a FILE activity is 400 and leaves it untouched', async () => {
    const file = await createAs(teacher, classroomA, tpBody());
    const res = await api('patch', `/${file.id}`, teacher)
      .send({ questions: mcQuestions('file', 1) })
      .expect(400);
    expect(res.body.error.details).toEqual([{ field: 'questions', messages: expect.any(Array) }]);
    expect(await prisma.question.count({ where: { activityId: file.id } })).toBe(0);
  });

  it('an invalid replacement is rejected before any delete: existing questions survive', async () => {
    const created = await createAs(
      teacher,
      classroomA,
      mcBody({ questions: mcQuestions('keep', 2) }),
    );
    // Invalid (two correct options) is rejected by validation before any write.
    const bad = mcQuestions('bad', 1);
    bad[0].options[0].isCorrect = true;
    await api('patch', `/${created.id}`, teacher).send({ questions: bad }).expect(400);
    expect(await prisma.question.count({ where: { activityId: created.id } })).toBe(2);
  });

  it('a PUBLISHED activity keeps title, description and date editing (questions stay editable until #30)', async () => {
    const created = await createAs(
      teacher,
      classroomA,
      mcBody({ questions: mcQuestions('pub', 1) }),
    );
    await publish(created.id);
    const res = await api('patch', `/${created.id}`, teacher)
      .send({
        title: 'Published edit',
        dueAt: withOffset(futureInstant(44, 15), '-03:00'),
        questions: mcQuestions('pub2', 1),
      })
      .expect(200);
    expect(res.body).toMatchObject({
      state: 'PUBLISHED',
      title: 'Published edit',
      dueAt: futureInstant(44, 15).toISOString(),
    });
    expect(res.body.questions[0].prompt).toBe('pub2 question 1');
  });

  describe('submissions freeze the questions and the deletion of an activity', () => {
    const questionsOf = async (activityId: string) =>
      (
        await prisma.question.findMany({
          where: { activityId },
          orderBy: { position: 'asc' },
          select: { prompt: true },
        })
      ).map((q) => q.prompt);

    it('PATCH questions after a submission exists is 409 with a reason and leaves the DB unchanged', async () => {
      const created = await createAs(
        teacher,
        classroomA,
        mcBody({ questions: mcQuestions('frozen', 2) }),
      );
      await seedSubmission(created.id);
      const before = await rowCounts();

      const res = await api('patch', `/${created.id}`, teacher)
        .send({ questions: mcQuestions('other', 3) })
        .expect(409);

      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'questions', messages: [expect.stringContaining('submitted')] }],
      });
      expect(await questionsOf(created.id)).toEqual(['frozen question 1', 'frozen question 2']);
      expect(await rowCounts()).toEqual(before);
    });

    it('PATCH title, description and dates stay editable after a submission exists', async () => {
      const created = await createAs(teacher, classroomA, mcBody());
      await seedSubmission(created.id);

      const res = await api('patch', `/${created.id}`, teacher)
        .send({
          title: 'Renamed',
          description: 'New text',
          dueAt: futureInstant(40, 15).toISOString(),
        })
        .expect(200);

      expect(res.body).toMatchObject({
        title: 'Renamed',
        description: 'New text',
        dueAt: futureInstant(40, 15).toISOString(),
      });
    });

    it('PATCH questions with no submission still replaces them (regression)', async () => {
      const created = await createAs(
        teacher,
        classroomA,
        mcBody({ questions: mcQuestions('old', 2) }),
      );
      // A submission on ANOTHER activity must not freeze this one.
      await seedSubmission((await createAs(teacher, classroomA, mcBody())).id);

      await api('patch', `/${created.id}`, teacher)
        .send({ questions: mcQuestions('fresh', 1) })
        .expect(200);

      expect(await questionsOf(created.id)).toEqual(['fresh question 1']);
    });

    it('DELETE with a submission is 409 and the activity stays active', async () => {
      const created = await createAs(teacher, classroomA, tpBody());
      await seedSubmission(created.id);

      const res = await api('delete', `/${created.id}`, teacher).expect(409);

      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        details: [{ field: 'state', messages: [expect.stringContaining('submission')] }],
      });
      const row = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.deletedAt).toBeNull();
    });

    it('DELETE without submissions still deactivates (204)', async () => {
      const created = await createAs(teacher, classroomA, tpBody());
      await api('delete', `/${created.id}`, teacher).expect(204);
      const row = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe(
    'concurrent writers are serialized by a row lock on the activity',
    { timeout: 20_000 },
    () => {
      /**
       * Deterministic ordering: a separate client holds `FOR UPDATE` on the row while the requests
       * are launched, so each one is provably queued behind it (pg_blocking_pids) before the lock
       * is released. No sleeps decide the outcome; polling only waits for the queue to form.
       */
      const holdRowLock = async (
        activityId: string,
        // `SHARE` plays a concurrent submit: it holds FOR SHARE and inserts its submission,
        // visible to others only once `release()` commits.
        opts: { mode?: 'UPDATE' | 'SHARE'; submitAs?: string } = {},
      ) => {
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
            if (opts.mode === 'SHARE') {
              await tx.$queryRaw`SELECT id FROM activities WHERE id = ${activityId}::uuid FOR SHARE`;
            } else {
              await tx.$queryRaw`SELECT id FROM activities WHERE id = ${activityId}::uuid FOR UPDATE`;
            }
            if (opts.submitAs) {
              await tx.submission.create({
                data: {
                  activityId,
                  studentId: opts.submitAs,
                  submittedAt: new Date(),
                  idempotencyKey: `lock-${randomUUID()}`,
                },
              });
            }
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
          /** Resolves once `count` backends are queued behind the held lock. */
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
      const fire = (req: request.Test) => req.then((res) => res);

      it('PATCH queued behind a DELETE never writes to the deactivated row (404)', async () => {
        const created = await createAs(teacher, classroomA, tpBody({ title: 'Before' }));
        const lock = await holdRowLock(created.id);
        try {
          const del = fire(api('delete', `/${created.id}`, teacher));
          await lock.waitForQueue(1);
          const patch = fire(api('patch', `/${created.id}`, teacher).send({ title: 'Zombie' }));
          await lock.waitForQueue(2);
          await lock.release();
          expect((await del).status).toBe(204);
          expect((await patch).status).toBe(404);
        } finally {
          await lock.release().catch(() => undefined);
        }
        const row = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
        expect(row.deletedAt).toBeInstanceOf(Date);
        expect(row.title).toBe('Before');
      });

      it('DELETE queued behind a PATCH waits for it: the edit is applied, then the row is deactivated', async () => {
        const created = await createAs(teacher, classroomA, tpBody({ title: 'Before' }));
        const lock = await holdRowLock(created.id);
        try {
          const patch = fire(api('patch', `/${created.id}`, teacher).send({ title: 'Edited' }));
          await lock.waitForQueue(1);
          const del = fire(api('delete', `/${created.id}`, teacher));
          await lock.waitForQueue(2);
          await lock.release();
          expect((await patch).status).toBe(200);
          expect((await del).status).toBe(204);
        } finally {
          await lock.release().catch(() => undefined);
        }
        const row = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
        expect(row.deletedAt).toBeInstanceOf(Date);
        expect(row.title).toBe('Edited');
      });

      it('DELETE queued behind a submit that holds FOR SHARE waits, then sees the submission and gets 409', async () => {
        const created = await createAs(teacher, classroomA, mcBody());
        const lock = await holdRowLock(created.id, { mode: 'SHARE', submitAs: student });
        try {
          const del = fire(api('delete', `/${created.id}`, teacher));
          await lock.waitForQueue(1);
          await lock.release();
          const res = await del;
          expect(res.status).toBe(409);
          expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: [{ field: 'state' }] });
        } finally {
          await lock.release().catch(() => undefined);
        }
        const row = await prisma.activity.findUniqueOrThrow({ where: { id: created.id } });
        expect(row.deletedAt).toBeNull();
        expect(await prisma.submission.count({ where: { activityId: created.id } })).toBe(1);
      });

      it('PATCH of questions queued behind a submit that holds FOR SHARE waits, then gets 409 and keeps the questions', async () => {
        const created = await createAs(
          teacher,
          classroomA,
          mcBody({ questions: mcQuestions('keep', 2) }),
        );
        const lock = await holdRowLock(created.id, { mode: 'SHARE', submitAs: student });
        try {
          const patch = fire(
            api('patch', `/${created.id}`, teacher).send({ questions: mcQuestions('new', 1) }),
          );
          await lock.waitForQueue(1);
          await lock.release();
          expect((await patch).status).toBe(409);
        } finally {
          await lock.release().catch(() => undefined);
        }
        const prompts = await prisma.question.findMany({
          where: { activityId: created.id },
          orderBy: { position: 'asc' },
          select: { prompt: true },
        });
        expect(prompts.map((q) => q.prompt)).toEqual(['keep question 1', 'keep question 2']);
      });

      it('two PATCHes that are each valid alone but not together: one 200, one 400, never 500', async () => {
        const exam = await createAs(
          teacher,
          classroomA,
          tpBody({ type: 'EXAM', opensAt: withOffset(futureInstant(30, 11), '-03:00') }),
        );
        const lock = await holdRowLock(exam.id);
        let results: { status: number; body: { error?: unknown } }[];
        try {
          // Stored window: opens 11:00Z, due 15:00Z. Each change alone keeps opensAt < dueAt.
          const moveOpens = fire(
            api('patch', `/${exam.id}`, teacher).send({
              opensAt: futureInstant(30, 14).toISOString(),
            }),
          );
          await lock.waitForQueue(1);
          const moveDue = fire(
            api('patch', `/${exam.id}`, teacher).send({
              dueAt: futureInstant(30, 13).toISOString(),
            }),
          );
          await lock.waitForQueue(2);
          await lock.release();
          results = await Promise.all([moveOpens, moveDue]);
        } finally {
          await lock.release().catch(() => undefined);
        }
        expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
        const rejected = results.find((r) => r.status === 400);
        expect(rejected?.body.error).toMatchObject({
          code: 'VALIDATION_FAILED',
          details: [{ field: 'opensAt', messages: expect.any(Array) }],
        });
        const row = await prisma.activity.findUniqueOrThrow({ where: { id: exam.id } });
        expect(row.opensAt!.getTime()).toBeLessThan(row.dueAt.getTime());
      });

      it('two concurrent question replacements are serialized: never 500, never a mix', async () => {
        const created = await createAs(
          teacher,
          classroomA,
          mcBody({ questions: mcQuestions('orig', 2) }),
        );
        const payloads = [mcQuestions('x', 3), mcQuestions('y', 2)];
        const lock = await holdRowLock(created.id);
        let results: { status: number }[];
        try {
          const first = fire(
            api('patch', `/${created.id}`, teacher).send({ questions: payloads[0] }),
          );
          await lock.waitForQueue(1);
          const second = fire(
            api('patch', `/${created.id}`, teacher).send({ questions: payloads[1] }),
          );
          await lock.waitForQueue(2);
          await lock.release();
          results = await Promise.all([first, second]);
        } finally {
          await lock.release().catch(() => undefined);
        }
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        const stored = await prisma.question.findMany({
          where: { activityId: created.id },
          orderBy: { position: 'asc' },
          include: { options: { orderBy: { position: 'asc' } } },
        });
        const shape = stored.map((q) => ({
          prompt: q.prompt,
          options: q.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect })),
        }));
        expect(payloads).toContainEqual(shape);
      });
    },
  );
});
