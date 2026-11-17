import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  BadgeConditionType,
  ClassroomRole,
  MembershipState,
  Prisma,
  RegistrationPath,
  StreakQualifyingSource,
} from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { NOTIFICATION_REQUESTED_EVENT } from '../notifications/notification-recorder.service';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { PrismaService } from '../prisma/prisma.service';
import { futureInstant } from '../testing/relative-dates';
import { GradesModule } from '../grades/grades.module';
import { GradesService } from '../grades/grades.service';
import { BadgesService } from './badges.service';
import { GamificationModule } from './gamification.module';
import { isExamPassed, StreakService } from './streak.service';
import { DEFAULT_LOCAL_DAY_TIME_ZONE, toLocalDay } from './local-day';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

/**
 * Instants are built from the school's local calendar day: Buenos Aires is
 * UTC-3 year-round, so `03:00Z` of a date is that date's local midnight and
 * `00:00Z..02:59Z` of a date still belong to the previous local day.
 */
function instantForLocalDay(offset: number, hourUtc = 3): Date {
  const today = toLocalDay(new Date(), DEFAULT_LOCAL_DAY_TIME_ZONE);
  const base = Date.parse(`${today}T00:00:00.000Z`);
  return new Date(base + offset * 86_400_000 + hourUtc * 3_600_000);
}

function makeIds() {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    classroom: randomUUID(),
    examActivity: randomUUID(),
    tpActivity: randomUUID(),
    examSubmission: randomUUID(),
    tpSubmission: randomUUID(),
  };
}

describe('Gamification streak engine and badges (real PostgreSQL & concurrency)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let streaks: StreakService;
  let badges: BadgesService;
  let grades: GradesService;
  let dispatcher: OutboxDispatcher;
  let ids: ReturnType<typeof makeIds>;

  const record = (
    studentId: string,
    at: Date,
    source: StreakQualifyingSource = StreakQualifyingSource.ON_TIME_SUBMISSION,
  ) => prisma.$transaction((tx) => streaks.recordQualifying(tx, { studentId, source, at }));

  const badgeEventCount = async (studentId: string) =>
    prisma.outboxEvent.count({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        AND: [
          { payload: { path: ['kind'], equals: 'badge_awarded' } },
          { payload: { path: ['recipientId'], equals: studentId } },
        ],
      },
    });

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }),
        GamificationModule,
        GradesModule,
      ],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    streaks = module.get(StreakService);
    badges = module.get(BadgesService);
    grades = module.get(GradesService);
    dispatcher = module.get(OutboxDispatcher);
  }, 20_000);

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    ids = makeIds();
    // The database is append-only across tests: stale catalog entries from
    // earlier tests (or runs) must not be evaluated against new students.
    await prisma.badgeDefinition.updateMany({ data: { isActive: false } });
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [ids.teacher, ids.student].map((id) => ({
          id,
          email: `gam-int-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: `Synthetic ${id.slice(0, 6)}`,
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.create({
        data: {
          id: ids.classroom,
          independentTeacherId: ids.teacher,
          name: 'Gamification Classroom',
        },
      });
      await tx.classroomMembership.create({
        data: {
          classroomId: ids.classroom,
          userId: ids.student,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
      });
      await tx.activity.createMany({
        data: [
          {
            id: ids.examActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.EXAM,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: new Date('2026-11-10T10:00:00.000Z'),
            title: 'Exam',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
          {
            id: ids.tpActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: new Date('2026-11-10T10:00:00.000Z'),
            title: 'TP',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
        ],
      });
      await tx.submission.createMany({
        data: [
          {
            id: ids.examSubmission,
            activityId: ids.examActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T10:00:00.000Z'),
            isLate: false,
            idempotencyKey: `sub-exam-${ids.examSubmission}`,
          },
          {
            id: ids.tpSubmission,
            activityId: ids.tpActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T11:00:00.000Z'),
            isLate: false,
            idempotencyKey: `sub-tp-${ids.tpSubmission}`,
          },
        ],
      });
    });
  });

  it('keeps an empty summary for a student without activity', async () => {
    expect(await streaks.getStudentSummary(ids.student)).toEqual({
      streak: { currentStreak: 0, bestStreak: 0, lastQualifyingDay: null },
      badges: [],
    });
    expect(await prisma.streak.count({ where: { studentId: ids.student } })).toBe(0);
  });

  it('counts concurrent same-day qualifying events exactly once', async () => {
    await Promise.all([
      record(ids.student, instantForLocalDay(0, 3), StreakQualifyingSource.ON_TIME_SUBMISSION),
      record(ids.student, instantForLocalDay(0, 12), StreakQualifyingSource.EXAM_PASSED),
      record(ids.student, instantForLocalDay(0, 20), StreakQualifyingSource.ON_TIME_SUBMISSION),
    ]);

    expect(await prisma.streakQualifyingDay.count({ where: { studentId: ids.student } })).toBe(1);
    const stored = await prisma.streak.findUniqueOrThrow({ where: { studentId: ids.student } });
    expect(stored.currentChainLength).toBe(1);
    expect(stored.bestChainLength).toBe(1);
  });

  it('extends the chain only on consecutive local days and resets it after a gap', async () => {
    await record(ids.student, instantForLocalDay(-4));
    await record(ids.student, instantForLocalDay(-3));
    // The stored chain is 2, but the read is already broken: the last
    // qualifying day is older than yesterday, so only the best is preserved.
    const stored = await prisma.streak.findUniqueOrThrow({ where: { studentId: ids.student } });
    expect(stored).toMatchObject({ currentChainLength: 2, bestChainLength: 2 });
    expect(await streaks.getStudentSummary(ids.student)).toMatchObject({
      streak: {
        currentStreak: 0,
        bestStreak: 2,
        lastQualifyingDay: toLocalDay(instantForLocalDay(-3)),
      },
    });

    // Two skipped local days (no qualifying event) restart the chain at 1.
    await record(ids.student, instantForLocalDay(-1));
    expect(
      await prisma.streak.findUniqueOrThrow({ where: { studentId: ids.student } }),
    ).toMatchObject({ currentChainLength: 1, bestChainLength: 2 });

    // A consecutive local day extends the alive chain to 2 again.
    await record(ids.student, instantForLocalDay(0));
    expect(await streaks.getStudentSummary(ids.student)).toMatchObject({
      streak: {
        currentStreak: 2,
        bestStreak: 2,
        lastQualifyingDay: toLocalDay(instantForLocalDay(0)),
      },
    });
  });

  it('reports a broken chain as current 0 while preserving the best chain', async () => {
    await record(ids.student, instantForLocalDay(-4));
    const stored = await prisma.streak.findUniqueOrThrow({ where: { studentId: ids.student } });
    expect(stored.currentChainLength).toBe(1);
    expect(await streaks.getStudentSummary(ids.student)).toMatchObject({
      streak: {
        currentStreak: 0,
        bestStreak: 1,
        lastQualifyingDay: toLocalDay(instantForLocalDay(-4)),
      },
    });
  });

  it('keeps instants before 03:00Z inside the previous local day', async () => {
    // TT00:00Z and TT02:59Z are both the previous local day; TT03:00Z starts today.
    await record(ids.student, instantForLocalDay(0, 0));
    await record(ids.student, instantForLocalDay(0, 2 + 59 / 60));
    expect(await prisma.streakQualifyingDay.count({ where: { studentId: ids.student } })).toBe(1);
    expect(
      await prisma.streak.findUniqueOrThrow({ where: { studentId: ids.student } }),
    ).toMatchObject({ currentChainLength: 1 });

    await record(ids.student, instantForLocalDay(0, 3));
    expect(await prisma.streakQualifyingDay.count({ where: { studentId: ids.student } })).toBe(2);
    expect(await streaks.getStudentSummary(ids.student)).toMatchObject({
      streak: { currentStreak: 2, bestStreak: 2 },
    });
  });

  it('awards catalog badges exactly once with one classroom-free notification each', async () => {
    const suffix = ids.student.slice(0, 8);
    const created = await prisma.badgeDefinition.createManyAndReturn({
      data: [
        {
          code: `active_days_2_${suffix}`,
          name: 'Two active days',
          description: 'Qualify on two different local days.',
          conditionType: BadgeConditionType.QUALIFYING_DAYS_REACHED,
          threshold: 2,
        },
        {
          code: `streak_3_${suffix}`,
          name: 'Three-day chain',
          description: 'Reach a chain of three consecutive local days.',
          conditionType: BadgeConditionType.STREAK_REACHED,
          threshold: 3,
        },
      ],
    });
    const byCode = new Map(created.map((d) => [d.code, d]));

    // Day one: nothing met. Day two: qualifying-days badge. Day three: chain badge.
    await record(ids.student, instantForLocalDay(-2));
    expect(await prisma.studentBadge.count({ where: { studentId: ids.student } })).toBe(0);
    await record(ids.student, instantForLocalDay(-1));
    expect(
      (await prisma.studentBadge.findMany({ where: { studentId: ids.student } })).map(
        (row) => row.badgeDefinitionId,
      ),
    ).toEqual([byCode.get(`active_days_2_${suffix}`)!.id]);
    await record(ids.student, instantForLocalDay(0));
    expect(await badgeEventCount(ids.student)).toBe(2);

    // Replay of an already-counted day is a no-op for badges and notifications.
    await record(ids.student, instantForLocalDay(0, 15), StreakQualifyingSource.EXAM_PASSED);
    expect(await prisma.studentBadge.count({ where: { studentId: ids.student } })).toBe(2);
    expect(await badgeEventCount(ids.student)).toBe(2);

    // The materialized notices are self-scoped: no classroom context, own recipient.
    const events = await prisma.outboxEvent.findMany({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        AND: [
          { payload: { path: ['kind'], equals: 'badge_awarded' } },
          { payload: { path: ['recipientId'], equals: ids.student } },
        ],
      },
    });
    const badgeEvents = events;
    expect(badgeEvents).toHaveLength(2);
    await dispatcher.dispatchPending(
      100,
      new Date(),
      [NOTIFICATION_REQUESTED_EVENT],
      badgeEvents.map((event) => event.id),
    );
    const notices = await prisma.notification.findMany({
      where: { recipientId: ids.student, kind: 'badge_awarded' },
    });
    expect(notices).toHaveLength(2);
    for (const notice of notices) {
      expect(notice.classroomId).toBeNull();
      expect(notice.studentId).toBe(ids.student);
    }
    expect(await prisma.notification.count({ where: { recipientId: ids.teacher } })).toBe(0);
  });

  it('never duplicates a badge or its notification under concurrent evaluation', async () => {
    await prisma.badgeDefinition.create({
      data: {
        code: `first_day_${ids.student.slice(0, 8)}`,
        name: 'First day',
        description: 'Qualify once.',
        conditionType: BadgeConditionType.STREAK_REACHED,
        threshold: 1,
      },
    });

    await Promise.all([
      record(ids.student, instantForLocalDay(0)),
      record(ids.student, instantForLocalDay(0, 10), StreakQualifyingSource.EXAM_PASSED),
    ]);

    expect(await prisma.studentBadge.count({ where: { studentId: ids.student } })).toBe(1);
    expect(await badgeEventCount(ids.student)).toBe(1);
    expect(await streaks.getStudentSummary(ids.student)).toMatchObject({
      streak: { currentStreak: 1, bestStreak: 1 },
      badges: [{ code: expect.stringContaining('first_day_') }],
    });
  });

  it('awards the badge exactly once when both racing transactions see the condition met', async () => {
    await prisma.badgeDefinition.create({
      data: {
        code: `race_day_${ids.student.slice(0, 8)}`,
        name: 'Race day',
        description: 'Qualify once under a race.',
        conditionType: BadgeConditionType.STREAK_REACHED,
        threshold: 1,
      },
    });

    // Two independent days recorded concurrently: both evaluations run after
    // distinct chain updates, so both may observe the met condition.
    await Promise.all([
      record(ids.student, instantForLocalDay(-1)),
      record(ids.student, instantForLocalDay(0)),
    ]);

    expect(await prisma.studentBadge.count({ where: { studentId: ids.student } })).toBe(1);
    expect(await badgeEventCount(ids.student)).toBe(1);
  });

  it('evaluates badges through the exported service against live state', async () => {
    await prisma.badgeDefinition.create({
      data: {
        code: `direct_${ids.student.slice(0, 8)}`,
        name: 'Direct',
        description: 'One qualifying day.',
        conditionType: BadgeConditionType.STREAK_REACHED,
        threshold: 1,
      },
    });
    await record(ids.student, instantForLocalDay(0));
    // Repeated direct evaluation (replay path) must not duplicate anything.
    await prisma.$transaction((tx) =>
      badges.evaluateAndAward(tx, {
        studentId: ids.student,
        currentChainLength: 1,
        bestChainLength: 1,
        qualifyingDayCount: 1,
      }),
    );
    expect(await prisma.studentBadge.count({ where: { studentId: ids.student } })).toBe(1);
    expect(await badgeEventCount(ids.student)).toBe(1);
  });

  describe('exam-passed trigger through GradesService', () => {
    it('records EXAM_PASSED only when the score meets the threshold, from grade and regrade', async () => {
      // 30/100 does not pass (threshold 60): no qualifying day, grade still stored.
      await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 30,
        feedback: 'Failed attempt',
      });
      expect(await prisma.streakQualifyingDay.count({ where: { studentId: ids.student } })).toBe(0);

      const stored = await prisma.streak.findUnique({ where: { studentId: ids.student } });
      expect(stored).toBeNull();

      // Regrading to 60/100 passes and creates exactly one EXAM_PASSED day.
      const examGrade = await prisma.grade.findUniqueOrThrow({
        where: { submissionId: ids.examSubmission },
      });
      await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 60,
        feedback: 'Passed after review',
        version: examGrade.version,
      });
      const days = await prisma.streakQualifyingDay.findMany({
        where: { studentId: ids.student },
      });
      expect(days).toHaveLength(1);
      expect(days[0].source).toBe(StreakQualifyingSource.EXAM_PASSED);
      expect(
        await prisma.streak.findUniqueOrThrow({ where: { studentId: ids.student } }),
      ).toMatchObject({ currentChainLength: 1, bestChainLength: 1 });

      // A graded TP the same local day must not add a day (not an exam trigger).
      await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 100,
        feedback: 'Perfect TP',
      });
      expect(await prisma.streakQualifyingDay.count({ where: { studentId: ids.student } })).toBe(1);
    });
  });

  describe('exam threshold predicate', () => {
    it('passes at or above the ceiling of the ratio and fails below it', () => {
      expect(isExamPassed(60, 100)).toBe(true);
      expect(isExamPassed(59, 100)).toBe(false);
      expect(isExamPassed(100, 100)).toBe(true);
      expect(isExamPassed(47, 80)).toBe(false);
      expect(isExamPassed(48, 80)).toBe(true);
      expect(isExamPassed(0, 100)).toBe(false);
    });
  });
});
