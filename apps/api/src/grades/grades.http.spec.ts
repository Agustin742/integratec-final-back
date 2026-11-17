import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  ClassroomRole,
  MembershipState,
  Prisma,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { STORAGE_PORT } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { InMemoryStorage } from '../testing/in-memory-storage';
import { futureInstant } from '../testing/relative-dates';
import { assertResourceAuthorization } from '../testing/resource-authorization';

// Real PostgreSQL and root AppModule; only session token verification and storage are stubbed.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    owner: randomUUID(),
    admin: randomUUID(),
    teacher: randomUUID(),
    unassignedSchoolTeacher: randomUUID(),
    independentTeacher: randomUUID(),
    student: randomUUID(),
    classmate: randomUUID(),
    parent: randomUUID(),
    classmateParent: randomUUID(),
    stranger: randomUUID(),
    school: randomUUID(),
    otherSchool: randomUUID(),
    classroom: randomUUID(),
    foreignClassroom: randomUUID(),
    independentClassroom: randomUUID(),
    tpActivity: randomUUID(),
    examActivity: randomUUID(),
    deletedActivity: randomUUID(),
    foreignActivity: randomUUID(),
    independentActivity: randomUUID(),
    sub1: randomUUID(),
    sub2: randomUUID(),
    sub3: randomUUID(),
    subDeletedActivity: randomUUID(),
    subForeign: randomUUID(),
    subIndependent: randomUUID(),
  };
}

describe('Grades & Grading Queue HTTP contract (real PostgreSQL, #26 isolation)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const storage = new InMemoryStorage();
  let ids: ReturnType<typeof makeIds>;

  const postGrade = (
    submissionId: string,
    actor: string,
    body: Record<string, unknown>,
    query?: Record<string, string>,
  ) => {
    const req = request(app.getHttpServer())
      .post(`/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${actor}`);
    if (query) req.query(query);
    return req.send(body);
  };

  const patchGrade = (
    submissionId: string,
    actor: string,
    body: Record<string, unknown>,
    query?: Record<string, string>,
  ) => {
    const req = request(app.getHttpServer())
      .patch(`/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${actor}`);
    if (query) req.query(query);
    return req.send(body);
  };

  const getGrade = (submissionId: string, actor: string, query?: Record<string, string>) => {
    const req = request(app.getHttpServer())
      .get(`/submissions/${submissionId}/grade`)
      .set('Authorization', `Bearer ${actor}`);
    if (query) req.query(query);
    return req;
  };

  const getQueue = (classroomId: string, actor: string, query = '') =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/submissions${query}`)
      .set('Authorization', `Bearer ${actor}`);

  const assertEnvelope = (body: unknown, code: string) => {
    expect(body).toMatchObject({
      error: { code, message: expect.any(String), correlationId: expect.any(String) },
    });
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        AppModule.forRoot({
          ...authTestConfig({ gradeWeightTp: 1, gradeWeightExam: 1.5 }),
          databaseUrl,
        }),
      ],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          const actor = header?.replace('Bearer ', '');
          if (!actor || actor === 'invalid') throw new UnauthorizedException();
          return { userId: actor, sessionId: randomUUID() };
        },
      })
      .overrideProvider(STORAGE_PORT)
      .useValue(storage)
      .compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    ids = makeIds();
    const t0 = new Date('2026-11-10T10:00:00.000Z');

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          { id: ids.owner, displayName: 'Owner Marta', registrationPath: RegistrationPath.SCHOOL },
          { id: ids.admin, displayName: 'Admin Sofia', registrationPath: RegistrationPath.SCHOOL },
          {
            id: ids.teacher,
            displayName: 'Teacher Carlos',
            registrationPath: RegistrationPath.SCHOOL,
          },
          {
            id: ids.unassignedSchoolTeacher,
            displayName: 'Teacher Other',
            registrationPath: RegistrationPath.SCHOOL,
          },
          {
            id: ids.independentTeacher,
            displayName: 'Indie Profe',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: ids.student,
            displayName: 'Lucas Student',
            registrationPath: RegistrationPath.SCHOOL,
          },
          {
            id: ids.classmate,
            displayName: 'Ana Classmate',
            registrationPath: RegistrationPath.SCHOOL,
          },
          {
            id: ids.parent,
            displayName: 'Roberto Parent',
            registrationPath: RegistrationPath.SCHOOL,
          },
          {
            id: ids.classmateParent,
            displayName: 'Clara ClassmateParent',
            registrationPath: RegistrationPath.SCHOOL,
          },
          {
            id: ids.stranger,
            displayName: 'Stranger User',
            registrationPath: RegistrationPath.SCHOOL,
          },
        ].map((u) => ({
          ...u,
          email: `grades-http-${u.id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
        })),
      });
      await tx.school.createMany({
        data: [
          { id: ids.school, name: 'Main School', slug: ids.school },
          { id: ids.otherSchool, name: 'Other School', slug: ids.otherSchool },
        ],
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: ids.school, userId: ids.owner, role: SchoolRole.OWNER },
          { schoolId: ids.school, userId: ids.admin, role: SchoolRole.ADMIN },
          { schoolId: ids.school, userId: ids.teacher, role: SchoolRole.TEACHER },
          { schoolId: ids.school, userId: ids.unassignedSchoolTeacher, role: SchoolRole.TEACHER },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: ids.classroom, schoolId: ids.school, name: 'Main Classroom', adultMode: false },
          {
            id: ids.foreignClassroom,
            schoolId: ids.otherSchool,
            name: 'Foreign Classroom',
            adultMode: false,
          },
          {
            id: ids.independentClassroom,
            independentTeacherId: ids.independentTeacher,
            name: 'Independent Classroom',
            adultMode: false,
          },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: ids.classroom, userId: ids.teacher, role: ClassroomRole.TEACHER },
          { classroomId: ids.classroom, userId: ids.student, role: ClassroomRole.STUDENT },
          { classroomId: ids.classroom, userId: ids.classmate, role: ClassroomRole.STUDENT },
          { classroomId: ids.foreignClassroom, userId: ids.stranger, role: ClassroomRole.STUDENT },
          {
            classroomId: ids.independentClassroom,
            userId: ids.student,
            role: ClassroomRole.STUDENT,
          },
        ],
      });
      await tx.parentLink.createMany({
        data: [
          { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
          { classroomId: ids.classroom, parentId: ids.classmateParent, childId: ids.classmate },
        ],
      });
      await tx.activity.createMany({
        data: [
          {
            id: ids.tpActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: t0,
            title: 'TP Algebra',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
          {
            id: ids.examActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.EXAM,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: t0,
            title: 'Exam Geometry',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.50'),
          },
          {
            id: ids.deletedActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: t0,
            deletedAt: new Date('2026-11-12T00:00:00.000Z'),
            title: 'Deleted Activity',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
          {
            id: ids.foreignActivity,
            classroomId: ids.foreignClassroom,
            createdById: ids.stranger,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: t0,
            title: 'Foreign Activity',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
          {
            id: ids.independentActivity,
            classroomId: ids.independentClassroom,
            createdById: ids.independentTeacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: t0,
            title: 'Independent Activity',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
        ],
      });
      await tx.submission.createMany({
        data: [
          {
            id: ids.sub1,
            activityId: ids.tpActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T10:00:00.000Z'),
            isLate: false,
            idempotencyKey: `k-${ids.sub1}`,
          },
          {
            id: ids.sub2,
            activityId: ids.examActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T10:00:00.000Z'),
            isLate: true,
            idempotencyKey: `k-${ids.sub2}`,
          },
          {
            id: ids.sub3,
            activityId: ids.tpActivity,
            studentId: ids.classmate,
            submittedAt: new Date('2026-11-11T12:00:00.000Z'),
            isLate: false,
            idempotencyKey: `k-${ids.sub3}`,
          },
          {
            id: ids.subDeletedActivity,
            activityId: ids.deletedActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T13:00:00.000Z'),
            isLate: false,
            idempotencyKey: `k-${ids.subDeletedActivity}`,
          },
          {
            id: ids.subForeign,
            activityId: ids.foreignActivity,
            studentId: ids.stranger,
            submittedAt: new Date('2026-11-11T14:00:00.000Z'),
            isLate: false,
            idempotencyKey: `k-${ids.subForeign}`,
          },
          {
            id: ids.subIndependent,
            activityId: ids.independentActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T15:00:00.000Z'),
            isLate: false,
            idempotencyKey: `k-${ids.subIndependent}`,
          },
        ],
      });
      await tx.submissionFile.create({
        data: {
          submissionId: ids.sub1,
          storageKey: `submissions/${ids.classroom}/${ids.tpActivity}/${ids.student}/secret-file`,
          originalName: 'homework.pdf',
          contentType: 'application/pdf',
          sizeBytes: 512,
          position: 0,
        },
      });
    });

    await storage.put(
      `submissions/${ids.classroom}/${ids.tpActivity}/${ids.student}/secret-file`,
      Buffer.from('%PDF-1.4\n'),
      { contentType: 'application/pdf' },
    );
  });

  it('requires authentication (401) across all four endpoints', async () => {
    for (const makeReq of [
      () =>
        request(app.getHttpServer())
          .post(`/submissions/${ids.sub1}/grade`)
          .send({ score: 80, feedback: 'ok' }),
      () =>
        request(app.getHttpServer())
          .patch(`/submissions/${ids.sub1}/grade`)
          .send({ score: 80, feedback: 'ok', version: 1 }),
      () => request(app.getHttpServer()).get(`/submissions/${ids.sub1}/grade`),
      () => request(app.getHttpServer()).get(`/classrooms/${ids.classroom}/submissions`),
      () =>
        request(app.getHttpServer())
          .get(`/submissions/${ids.sub1}/grade`)
          .set('Authorization', 'Bearer invalid'),
    ]) {
      assertEnvelope((await makeReq().expect(401)).body, 'UNAUTHENTICATED');
    }
  });

  it('enforces #26 authorization matrix, adult mode, deleted activity, and assertResourceAuthorization across all endpoints', async () => {
    // 1. Before grading: authorized readers get 404 on GET /grade, classmate gets 403, unassigned school teacher gets 404
    for (const reader of [ids.teacher, ids.owner, ids.admin, ids.student, ids.parent]) {
      assertEnvelope((await getGrade(ids.sub1, reader).expect(404)).body, 'NOT_FOUND');
    }
    assertEnvelope((await getGrade(ids.sub1, ids.classmate).expect(403)).body, 'FORBIDDEN');
    assertEnvelope(
      (await getGrade(ids.sub1, ids.unassignedSchoolTeacher).expect(404)).body,
      'NOT_FOUND',
    );
    assertEnvelope((await getGrade(ids.sub1, ids.classmateParent).expect(404)).body, 'NOT_FOUND');
    assertEnvelope((await getGrade(ids.sub1, ids.stranger).expect(404)).body, 'NOT_FOUND');

    // 2. Non-staff write attempts: student/linked parent -> 403; unlinked parent/unassigned school teacher/stranger -> 404
    for (const actor of [ids.student, ids.classmate, ids.parent]) {
      assertEnvelope(
        (await postGrade(ids.sub1, actor, { score: 80, feedback: 'nope' }).expect(403)).body,
        'FORBIDDEN',
      );
      assertEnvelope(
        (await patchGrade(ids.sub1, actor, { score: 80, feedback: 'nope', version: 1 }).expect(403))
          .body,
        'FORBIDDEN',
      );
      assertEnvelope((await getQueue(ids.classroom, actor).expect(403)).body, 'FORBIDDEN');
    }
    for (const actor of [ids.unassignedSchoolTeacher, ids.classmateParent, ids.stranger]) {
      assertEnvelope(
        (await postGrade(ids.sub1, actor, { score: 80, feedback: 'nope' }).expect(404)).body,
        'NOT_FOUND',
      );
      assertEnvelope(
        (await patchGrade(ids.sub1, actor, { score: 80, feedback: 'nope', version: 1 }).expect(404))
          .body,
        'NOT_FOUND',
      );
    }
    for (const actor of [ids.unassignedSchoolTeacher, ids.stranger]) {
      assertEnvelope((await getQueue(ids.classroom, actor).expect(404)).body, 'NOT_FOUND');
    }

    // 3. Deleted activity -> 404 even for classroom teacher
    assertEnvelope(
      (
        await postGrade(ids.subDeletedActivity, ids.teacher, { score: 80, feedback: 'del' }).expect(
          404,
        )
      ).body,
      'NOT_FOUND',
    );
    assertEnvelope(
      (await getGrade(ids.subDeletedActivity, ids.teacher).expect(404)).body,
      'NOT_FOUND',
    );

    // 4. Allowed staff roles (`OWNER` / `ADMIN` / assigned `TEACHER` / independent `TEACHER`) + #26 assertResourceAuthorization
    await assertResourceAuthorization({
      allowedResourceId: ids.sub1,
      foreignResourceId: ids.subForeign,
      interaction: {
        classroomId: ids.classroom,
        activityId: ids.tpActivity,
        studentId: ids.student,
      },
      allowedStatus: 201,
      deniedStatus: 404,
      request: (submissionId, interaction) =>
        postGrade(
          submissionId,
          ids.owner,
          { score: 0, feedback: 'Owner isolation probe' },
          interaction,
        ),
      assertAllowed: async () => {
        // Reset the 0-point probe grade between direct and object-interaction POST cases.
        await prisma.gradeRevision.deleteMany({ where: { grade: { submissionId: ids.sub1 } } });
        await prisma.grade.deleteMany({ where: { submissionId: ids.sub1 } });
      },
      assertDenied: (res) => {
        assertEnvelope(res.body, 'NOT_FOUND');
      },
    });

    await postGrade(ids.sub1, ids.owner, { score: 85, feedback: 'Owner graded' }).expect(201);

    let nextPatchVersion = 1;
    await assertResourceAuthorization({
      allowedResourceId: ids.sub1,
      foreignResourceId: ids.subForeign,
      interaction: {
        classroomId: ids.classroom,
        activityId: ids.tpActivity,
        studentId: ids.student,
      },
      allowedStatus: 200,
      deniedStatus: 404,
      request: (submissionId, interaction) =>
        patchGrade(
          submissionId,
          ids.admin,
          {
            score: 90,
            feedback: 'Admin regraded',
            version: nextPatchVersion,
          },
          interaction,
        ),
      assertAllowed: () => {
        // The helper sends the same payload twice; the repeat is an identical no-op regrade that
        // returns the current grade, so only the first request bumps the version (1 -> 2).
        nextPatchVersion = 2;
      },
      assertDenied: (res) => {
        assertEnvelope(res.body, 'NOT_FOUND');
      },
    });

    await assertResourceAuthorization({
      allowedResourceId: ids.sub1,
      foreignResourceId: ids.subForeign,
      interaction: {
        classroomId: ids.classroom,
        activityId: ids.tpActivity,
        studentId: ids.student,
      },
      allowedStatus: 200,
      deniedStatus: 404,
      request: (submissionId, interaction) => getGrade(submissionId, ids.teacher, interaction),
      assertDenied: (res) => {
        assertEnvelope(res.body, 'NOT_FOUND');
      },
    });

    await assertResourceAuthorization({
      allowedResourceId: ids.classroom,
      foreignResourceId: ids.foreignClassroom,
      interaction: { activityId: ids.tpActivity },
      allowedStatus: 200,
      deniedStatus: 404,
      request: (classroomId, interaction) =>
        getQueue(
          classroomId,
          ids.teacher,
          interaction ? `?activityId=${interaction.activityId}` : '',
        ),
      assertDenied: (res) => {
        assertEnvelope(res.body, 'NOT_FOUND');
      },
    });

    // Independent teacher grades own classroom submission
    const indieRes = await postGrade(ids.subIndependent, ids.independentTeacher, {
      score: 70,
      feedback: 'Good job',
    }).expect(201);
    expect(indieRes.body.pointsAwarded).toBe(70);

    // 5. After grading: owning student, active linked parent, and staff can read GET /grade (no storage leaks)
    for (const reader of [ids.teacher, ids.owner, ids.admin, ids.student, ids.parent]) {
      const readRes = await getGrade(ids.sub1, reader).expect(200);
      expect(readRes.body).toMatchObject({
        submissionId: ids.sub1,
        score: 90,
        feedback: 'Admin regraded',
        version: 2,
      });
      const raw = JSON.stringify(readRes.body);
      expect(raw).not.toContain('storageKey');
      expect(raw).not.toContain('downloadUrl');
      expect(raw).not.toContain('secret-file');
    }

    // Classmate still 403, unlinked parent still 404
    assertEnvelope((await getGrade(ids.sub1, ids.classmate).expect(403)).body, 'FORBIDDEN');
    assertEnvelope((await getGrade(ids.sub1, ids.classmateParent).expect(404)).body, 'NOT_FOUND');

    // 6. Adult mode hides classroom and grades from linked parent (404 across all endpoints)
    await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: true } });
    assertEnvelope((await getGrade(ids.sub1, ids.parent).expect(404)).body, 'NOT_FOUND');
    assertEnvelope(
      (await postGrade(ids.sub2, ids.parent, { score: 50, feedback: 'x' }).expect(404)).body,
      'NOT_FOUND',
    );
    assertEnvelope((await getQueue(ids.classroom, ids.parent).expect(404)).body, 'NOT_FOUND');

    // 7. Deactivated student: staff keeps read access on grade and queue; removed student and
    // linked parent (even with adultMode=false) lose access (404)
    await prisma.classroom.update({ where: { id: ids.classroom }, data: { adultMode: false } });
    await prisma.classroomMembership.updateMany({
      where: { classroomId: ids.classroom, userId: ids.student },
      data: { state: MembershipState.INACTIVE, deletedAt: new Date() },
    });
    await getGrade(ids.sub1, ids.teacher).expect(200);
    await getGrade(ids.sub1, ids.owner).expect(200);
    // Queue hides the departed student's submissions (sub1, sub2); only the classmate's sub3 stays.
    expect((await getQueue(ids.classroom, ids.teacher).expect(200)).body.total).toBe(1);
    assertEnvelope((await getGrade(ids.sub1, ids.student).expect(404)).body, 'NOT_FOUND');
    assertEnvelope((await getGrade(ids.sub1, ids.parent).expect(404)).body, 'NOT_FOUND');
    assertEnvelope(
      (await postGrade(ids.sub2, ids.parent, { score: 50, feedback: 'x' }).expect(404)).body,
      'NOT_FOUND',
    );
  });

  it('transitions SubmissionResponseDto.status from submitted to graded on submission read endpoints', async () => {
    const beforeMe = await request(app.getHttpServer())
      .get(`/activities/${ids.tpActivity}/submissions/me`)
      .set('Authorization', `Bearer ${ids.student}`)
      .expect(200);
    expect(beforeMe.body.status).toBe('submitted');

    const beforeById = await request(app.getHttpServer())
      .get(`/submissions/${ids.sub1}`)
      .set('Authorization', `Bearer ${ids.teacher}`)
      .expect(200);
    expect(beforeById.body.status).toBe('submitted');

    await postGrade(ids.sub1, ids.teacher, { score: 92, feedback: 'Excellent' }).expect(201);

    const afterMe = await request(app.getHttpServer())
      .get(`/activities/${ids.tpActivity}/submissions/me`)
      .set('Authorization', `Bearer ${ids.student}`)
      .expect(200);
    expect(afterMe.body.status).toBe('graded');

    const afterById = await request(app.getHttpServer())
      .get(`/submissions/${ids.sub1}`)
      .set('Authorization', `Bearer ${ids.teacher}`)
      .expect(200);
    expect(afterById.body.status).toBe('graded');
  });

  it('paginates, filters by activityId/state, sorts deterministically with +id tiebreaker, and protects privacy on GET /classrooms/:id/submissions', async () => {
    // Grade sub2 (exam: 80 * 1.5 * 1.5 = 180 points)
    await postGrade(ids.sub2, ids.teacher, { score: 80, feedback: 'Exam graded' }).expect(201);

    // Default queue excludes deletedActivity and foreign classroom (sub1, sub2, sub3)
    const all = await getQueue(ids.classroom, ids.teacher).expect(200);
    expect(all.body.total).toBe(3);
    // sub1 and sub2 share submittedAt = 2026-11-11T10:00:00.000Z -> deterministic +id tiebreaker
    const tiedExpected = [ids.sub1, ids.sub2].sort();
    expect(all.body.items.slice(0, 2).map((i: { id: string }) => i.id)).toEqual(tiedExpected);
    expect(all.body.items[2].id).toBe(ids.sub3);

    // Privacy check: no storage internals or user emails
    const serialized = JSON.stringify(all.body);
    expect(serialized).not.toContain('storageKey');
    expect(serialized).not.toContain('downloadUrl');
    expect(serialized).not.toContain('idempotencyKey');
    expect(serialized).not.toContain('example.invalid');

    // Filter by state=graded & state=submitted
    const gradedOnly = await getQueue(ids.classroom, ids.teacher, '?state=graded').expect(200);
    expect(gradedOnly.body.total).toBe(1);
    expect(gradedOnly.body.items[0]).toMatchObject({
      id: ids.sub2,
      status: 'graded',
      isLate: true,
      grade: { score: 80, pointsAwarded: 180, version: 1 },
    });

    const submittedOnly = await getQueue(
      ids.classroom,
      ids.teacher,
      `?state=submitted&activityId=${ids.tpActivity}&sort=-submittedAt`,
    ).expect(200);
    expect(submittedOnly.body.total).toBe(2);
    expect(submittedOnly.body.items.map((i: { id: string }) => i.id)).toEqual([ids.sub3, ids.sub1]);
    expect(submittedOnly.body.items[0].grade).toBeNull();
    expect(submittedOnly.body.items[1].fileCount).toBe(1);

    // Pagination
    const page2 = await getQueue(ids.classroom, ids.teacher, '?page=2&pageSize=2').expect(200);
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.items[0].id).toBe(ids.sub3);

    // Sort by gradedAt / -gradedAt works cleanly
    await getQueue(ids.classroom, ids.teacher, '?sort=gradedAt').expect(200);
    await getQueue(ids.classroom, ids.teacher, '?sort=-gradedAt').expect(200);

    // 404 when activityId belongs to another classroom, is deleted, or does not exist
    for (const badActivityId of [ids.foreignActivity, ids.deletedActivity, randomUUID()]) {
      assertEnvelope(
        (await getQueue(ids.classroom, ids.teacher, `?activityId=${badActivityId}`).expect(404))
          .body,
        'NOT_FOUND',
      );
    }

    // 400 VALIDATION_FAILED on malformed query/body inputs (bounds, control chars, version, extra fields)
    assertEnvelope(
      (await getQueue(ids.classroom, ids.teacher, '?sort=score').expect(400)).body,
      'VALIDATION_FAILED',
    );
    for (const badGradeBody of [
      { score: -1, feedback: 'ok' },
      { score: 101, feedback: 'ok' },
      { score: 85.5, feedback: 'ok' },
      { score: 85, feedback: '\u200B' },
      { score: 85, feedback: 'ok\u0000' },
      { score: 85, feedback: 'ok', pointsAwarded: 999 },
    ]) {
      assertEnvelope(
        (await postGrade(ids.sub1, ids.teacher, badGradeBody).expect(400)).body,
        'VALIDATION_FAILED',
      );
    }
    assertEnvelope(
      (
        await patchGrade(ids.sub1, ids.teacher, {
          score: 85,
          feedback: 'ok',
          version: 0,
        }).expect(400)
      ).body,
      'VALIDATION_FAILED',
    );
  });

  it('rejects a score above the activity maxScore with 400 VALIDATION_FAILED details on score and persists nothing', async () => {
    await prisma.activity.update({ where: { id: ids.tpActivity }, data: { maxScore: 20 } });

    const res = await postGrade(ids.sub1, ids.teacher, { score: 21, feedback: 'Too high' }).expect(
      400,
    );
    assertEnvelope(res.body, 'VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([
      { field: 'score', messages: ['score must not exceed the activity maxScore (20)'] },
    ]);
    expect(await prisma.grade.count({ where: { submissionId: ids.sub1 } })).toBe(0);

    await postGrade(ids.sub1, ids.teacher, { score: 20, feedback: 'At the maximum' }).expect(201);
  });
});
