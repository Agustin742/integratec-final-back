import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsModule } from './metrics.module';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe('Classroom metrics HTTP — HU-ACT-005, classrooms-and-roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const [teacherA, s1, s2, sB, parent, teacherB, schoolOwner, schoolAdmin, sC, sLeaving] =
    Array.from({ length: 10 }, () => randomUUID());
  const [classroomA, classroomB, schoolId, classroomC] = Array.from({ length: 4 }, () =>
    randomUUID(),
  );
  const token = (actor: string) => `Bearer metrics-test:${actor}`;

  const get = (path: string, actor: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', token(actor));

  const gradedSubmission = async (
    activityId: string,
    studentId: string,
    grade: { score: number; feedback: string; pointsAwarded: number; gradedAt: Date },
  ) => {
    const submission = await prisma.submission.create({
      data: {
        activityId,
        studentId,
        submittedAt: grade.gradedAt,
        isLate: false,
        idempotencyKey: randomUUID(),
      },
    });
    const activity = await prisma.activity.findUniqueOrThrow({
      where: { id: activityId },
      select: { title: true, maxScore: true },
    });
    await prisma.grade.create({
      data: {
        submissionId: submission.id,
        graderId: teacherA,
        score: grade.score,
        feedback: grade.feedback,
        // Snapshot columns, as the real grading flow writes them.
        activityTitle: activity.title,
        maxScore: activity.maxScore,
        pointsAwarded: grade.pointsAwarded,
        typeWeight: 1,
        weightMultiplier: 1,
        version: 1,
        gradedAt: grade.gradedAt,
      },
    });
  };

  const metric = (
    userId: string,
    classroomId: string,
    day: Date,
    connectedSeconds: number,
    submissionCount: number,
  ) =>
    prisma.activityMetric.create({
      data: { classroomId, userId, day, connectedSeconds, submissionCount },
    });

  const publishedActivity = async (classroomId: string, title: string) =>
    (
      await prisma.activity.create({
        data: {
          classroomId,
          createdById: teacherA,
          type: 'TP',
          format: 'FILE',
          state: 'PUBLISHED',
          publishedAt: new Date(Date.now() - HOUR_MS),
          title,
          dueAt: new Date(Date.now() + DAY_MS),
          maxScore: 100,
        },
      })
    ).id;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), MetricsModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer metrics-test:')) throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer metrics-test:'.length),
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

    const now = Date.now();
    const day1 = new Date(now - 2 * DAY_MS);
    const day2 = new Date(now - DAY_MS);

    await prisma.$transaction(async (tx) => {
      const users = [
        teacherA,
        s1,
        s2,
        sB,
        parent,
        teacherB,
        schoolOwner,
        schoolAdmin,
        sC,
        sLeaving,
      ];
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          // Distinct initial letters keep any reasonable collation in agreement on the summary order.
          displayName:
            id === s1 ? 'Alpha Student' : id === s2 ? 'Beta Student' : `Metrics ${id.slice(0, 6)}`,
          email: `metrics-http-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-metrics-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.school.create({
        data: { id: schoolId, name: 'Metrics School', slug: `metrics-${schoolId}` },
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId, userId: schoolOwner, role: SchoolRole.OWNER },
          { schoolId, userId: schoolAdmin, role: SchoolRole.ADMIN },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: 'Metrics A', independentTeacherId: teacherA },
          { id: classroomB, name: 'Metrics B', independentTeacherId: teacherB },
          { id: classroomC, name: 'Metrics C', schoolId },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: teacherA, role: ClassroomRole.TEACHER },
          { classroomId: classroomA, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: s2, role: ClassroomRole.STUDENT },
          {
            classroomId: classroomA,
            userId: sLeaving,
            role: ClassroomRole.STUDENT,
            state: MembershipState.INACTIVE,
          },
          { classroomId: classroomB, userId: teacherB, role: ClassroomRole.TEACHER },
          { classroomId: classroomB, userId: sB, role: ClassroomRole.STUDENT },
          { classroomId: classroomC, userId: sC, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: s1, classroomId: classroomA },
      });
    });

    const a1 = await publishedActivity(classroomA, `Report card one ${randomUUID()}`);
    const a2 = await publishedActivity(classroomA, `Report card two ${randomUUID()}`);
    const a3 = await publishedActivity(classroomA, `Other student ${randomUUID()}`);
    await gradedSubmission(a1, s1, {
      score: 80,
      feedback: 'Good work',
      pointsAwarded: 40,
      gradedAt: new Date(now - HOUR_MS),
    });
    // s1 also has an ungraded submission: the report card lists graded activities only.
    await prisma.submission.create({
      data: {
        activityId: a2,
        studentId: s1,
        submittedAt: new Date(now - HOUR_MS),
        isLate: false,
        idempotencyKey: randomUUID(),
      },
    });
    await gradedSubmission(a3, s2, {
      score: 60,
      feedback: 'Ok',
      pointsAwarded: 30,
      gradedAt: new Date(now - 2 * HOUR_MS),
    });

    // Two days of raw signals for s1, one for s2 (no rows), one in the school classroom.
    await metric(s1, classroomA, day1, 100, 2);
    await metric(s1, classroomA, day2, 50, 1);
    await metric(s2, classroomA, day1, 10, 0);
    await metric(sC, classroomC, day1, 25, 1);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('GET /classrooms/:id/me/report-card', () => {
    it('lists own graded activities with score, feedback and points, ordered by gradedAt desc', async () => {
      const res = await get(`/classrooms/${classroomA}/me/report-card`, s1).expect(200);
      expect(res.body.items).toHaveLength(1);
      const item = res.body.items[0];
      expect(item).toMatchObject({
        score: 80,
        maxScore: 100,
        feedback: 'Good work',
        pointsAwarded: 40,
        isLate: false,
        activityType: 'TP',
      });
      expect(item.activityId).toBeDefined();
      expect(item.gradedAt).toBeDefined();
      expect(item.submittedAt).toBeDefined();
    });

    it('answers 404 to a student of another classroom and to a stranger', async () => {
      await get(`/classrooms/${classroomA}/me/report-card`, sB).expect(404);
      await get(`/classrooms/${randomUUID()}/me/report-card`, s1).expect(404);
      await get(`/classrooms/not-a-uuid/me/report-card`, s1).expect(404);
    });

    it('answers 403 to staff and parents: the card is the student resource', async () => {
      await get(`/classrooms/${classroomA}/me/report-card`, teacherA).expect(403);
      await get(`/classrooms/${classroomA}/me/report-card`, parent).expect(403);
    });
  });

  describe('GET /classrooms/:id/me/activity-metrics', () => {
    it('lists only the caller raw daily rows, latest day first', async () => {
      const res = await get(`/classrooms/${classroomA}/me/activity-metrics`, s1).expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(2);
      // Days come back as calendar dates, never shifted by a timezone.
      expect(typeof res.body.items[0].day).toBe('string');
      expect(res.body.items[0].day.length).toBe(10);
      expect(res.body.items[0].connectedSeconds).toBe(50);
      expect(res.body.items[0].submissionCount).toBe(1);
      expect(res.body.items[0].messageCount).toBe(0);
      expect(res.body.items[1].connectedSeconds).toBe(100);
      expect(res.body.items[1].submissionCount).toBe(2);
    });

    it('paginates and keeps a stable ordering', async () => {
      const res = await get(
        `/classrooms/${classroomA}/me/activity-metrics?pageSize=1&page=2`,
        s1,
      ).expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].connectedSeconds).toBe(100);
    });

    it('answers 404 to a student of another classroom and 403 to staff and parents', async () => {
      await get(`/classrooms/${classroomA}/me/activity-metrics`, sB).expect(404);
      await get(`/classrooms/${classroomA}/me/activity-metrics`, teacherA).expect(403);
      await get(`/classrooms/${classroomA}/me/activity-metrics`, parent).expect(403);
    });
  });

  describe('GET /classrooms/:id/activity-metrics (teacher summary)', () => {
    it('shows raw totals for every active enrolled student, display name ascending', async () => {
      const res = await get(`/classrooms/${classroomA}/activity-metrics`, teacherA).expect(200);
      // sLeaving is inactive: the summary covers active enrollments only.
      expect(res.body.total).toBe(2);
      const byStudent = new Map(
        res.body.items.map(
          (item: {
            studentId: string;
            displayName: string;
            connectedSeconds: number;
            submissionCount: number;
            messageCount: number;
            gradedCount: number;
            ungradedCount: number;
          }) => [item.studentId, item],
        ),
      );
      expect(byStudent.get(s1)).toMatchObject({
        connectedSeconds: 150,
        submissionCount: 3,
        messageCount: 0,
        gradedCount: 1,
        ungradedCount: 1,
      });
      expect(byStudent.get(s2)).toMatchObject({
        connectedSeconds: 10,
        submissionCount: 0,
        gradedCount: 1,
        ungradedCount: 0,
      });
      const names = res.body.items.map((item: { displayName: string }) => item.displayName);
      expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
    });

    it('answers 404 to the teacher of another classroom and to strangers', async () => {
      await get(`/classrooms/${classroomA}/activity-metrics`, teacherB).expect(404);
      await get(`/classrooms/${classroomA}/activity-metrics`, randomUUID()).expect(404);
    });

    it('answers 403 to students and parents: only staff read the summary', async () => {
      await get(`/classrooms/${classroomA}/activity-metrics`, s1).expect(403);
      await get(`/classrooms/${classroomA}/activity-metrics`, parent).expect(403);
    });

    it('lets the school owner and admin read any classroom of their school without membership', async () => {
      const owner = await get(`/classrooms/${classroomC}/activity-metrics`, schoolOwner).expect(
        200,
      );
      expect(owner.body.total).toBe(1);
      expect(owner.body.items[0]).toMatchObject({
        studentId: sC,
        connectedSeconds: 25,
        submissionCount: 1,
        gradedCount: 0,
        ungradedCount: 0,
      });
      await get(`/classrooms/${classroomC}/activity-metrics`, schoolAdmin).expect(200);
    });
  });

  it('answers 401 without a session', async () => {
    await request(app.getHttpServer()).get(`/classrooms/${classroomA}/me/report-card`).expect(401);
  });

  // Fixture-mutating cases live after every test above: they add graded rows, so earlier
  // assertions keep reading only the fixtures created in `beforeAll`.
  describe('report-card activity metadata snapshot', () => {
    it('keeps the activity title and maxScore frozen at grading time', async () => {
      const frozen = await publishedActivity(classroomA, `Frozen card ${randomUUID()}`);
      await gradedSubmission(frozen, s1, {
        score: 8,
        feedback: 'Snapshot test',
        pointsAwarded: 4,
        gradedAt: new Date(Date.now() - 3 * HOUR_MS),
      });
      // Title and maxScore stay editable once submissions exist (D16 freezes questions and
      // deletion only): the card must keep the values the student was graded against.
      await prisma.activity.update({
        where: { id: frozen },
        data: { title: `Renamed ${randomUUID()}`, maxScore: 50 },
      });

      const res = await get(`/classrooms/${classroomA}/me/report-card`, s1).expect(200);
      const item = res.body.items.find(
        (candidate: { activityId: string }) => candidate.activityId === frozen,
      );
      expect(item).toMatchObject({
        activityTitle: expect.stringContaining('Frozen card'),
        maxScore: 100,
        score: 8,
      });
    });
  });

  describe('report-card ordering and exclusions', () => {
    it('orders graded activities by gradedAt desc', async () => {
      const older = await publishedActivity(classroomA, `Card older ${randomUUID()}`);
      const newer = await publishedActivity(classroomA, `Card newer ${randomUUID()}`);
      await gradedSubmission(older, s1, {
        score: 70,
        feedback: 'older',
        pointsAwarded: 10,
        gradedAt: new Date(Date.now() - 5 * HOUR_MS),
      });
      await gradedSubmission(newer, s1, {
        score: 90,
        feedback: 'newer',
        pointsAwarded: 20,
        gradedAt: new Date(Date.now() - 4 * HOUR_MS),
      });

      const res = await get(`/classrooms/${classroomA}/me/report-card`, s1).expect(200);
      const ordered = res.body.items
        .filter((item: { feedback: string }) => ['older', 'newer'].includes(item.feedback))
        .map((item: { activityId: string }) => item.activityId);
      expect(ordered).toEqual([newer, older]);
    });

    it('breaks gradedAt ties by submission id ascending', async () => {
      const tieFirst = await publishedActivity(classroomA, `Card tie first ${randomUUID()}`);
      const tieSecond = await publishedActivity(classroomA, `Card tie second ${randomUUID()}`);
      const sameInstant = new Date(Date.now() - 6 * HOUR_MS);
      const gradeAt = async (activityId: string) => {
        const submission = await prisma.submission.create({
          data: {
            activityId,
            studentId: s1,
            submittedAt: sameInstant,
            isLate: false,
            idempotencyKey: randomUUID(),
          },
        });
        await prisma.grade.create({
          data: {
            submissionId: submission.id,
            graderId: teacherA,
            score: 60,
            feedback: 'tie',
            activityTitle: `Tie ${randomUUID()}`,
            maxScore: 100,
            pointsAwarded: 10,
            typeWeight: 1,
            weightMultiplier: 1,
            version: 1,
            gradedAt: sameInstant,
          },
        });
        return submission.id;
      };
      const firstSubmission = await gradeAt(tieFirst);
      const secondSubmission = await gradeAt(tieSecond);

      const res = await get(`/classrooms/${classroomA}/me/report-card`, s1).expect(200);
      const tiedActivities = res.body.items
        .filter((item: { feedback: string; activityId: string }) => item.feedback === 'tie')
        .map((item: { activityId: string }) => item.activityId);
      expect(tiedActivities).toHaveLength(2);
      // Same grading instant: the older submission id wins the earlier position.
      const firstIsOlder = firstSubmission < secondSubmission;
      expect(tiedActivities).toEqual(firstIsOlder ? [tieFirst, tieSecond] : [tieSecond, tieFirst]);
    });

    it('paginates the teacher summary with page and pageSize', async () => {
      const res = await get(
        `/classrooms/${classroomA}/activity-metrics?pageSize=1&page=2`,
        teacherA,
      ).expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items).toHaveLength(1);
      // Second student in the displayName ascending order.
      expect(res.body.items[0].displayName).toBe('Beta Student');
    });

    it('excludes deleted activities from the report card and the summary counts', async () => {
      const before = await get(`/classrooms/${classroomA}/activity-metrics`, teacherA).expect(200);
      const beforeCount = before.body.items.find(
        (item: { studentId: string }) => item.studentId === s1,
      ).gradedCount;

      const doomed = await publishedActivity(classroomA, `Doomed card ${randomUUID()}`);
      await gradedSubmission(doomed, s1, {
        score: 55,
        feedback: 'doomed',
        pointsAwarded: 5,
        gradedAt: new Date(Date.now() - 2 * HOUR_MS),
      });
      // Deleting an activity with submissions is refused by the service, so the guard is
      // exercised the way historical data would look: the row is marked deleted directly.
      await prisma.activity.update({ where: { id: doomed }, data: { deletedAt: new Date() } });

      const card = await get(`/classrooms/${classroomA}/me/report-card`, s1).expect(200);
      expect(
        card.body.items.some((item: { activityId: string }) => item.activityId === doomed),
      ).toBe(false);
      const after = await get(`/classrooms/${classroomA}/activity-metrics`, teacherA).expect(200);
      const afterCount = after.body.items.find(
        (item: { studentId: string }) => item.studentId === s1,
      ).gradedCount;
      expect(afterCount).toBe(beforeCount);
    });
  });
});
