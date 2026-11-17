import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  ClassroomRole,
  MembershipState,
  PointEntryKind,
  Prisma,
  RegistrationPath,
  ShopItemKind,
} from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { NOTIFICATION_REQUESTED_EVENT } from '../notifications/notification-recorder.service';
import { RequestValidationException } from '../http/validation';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopPurchaseRateLimiter } from '../shop/shop-purchase-rate-limiter.service';
import { ShopModule } from '../shop/shop.module';
import { ShopService } from '../shop/shop.service';
import { futureInstant } from '../testing/relative-dates';
import { GradesModule } from './grades.module';
import { GradesService } from './grades.service';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    teacher: randomUUID(),
    secondTeacher: randomUUID(),
    student: randomUUID(),
    parent: randomUUID(),
    classroom: randomUUID(),
    tpActivity: randomUUID(),
    examActivity: randomUUID(),
    mcActivity: randomUUID(),
    tpSubmission: randomUUID(),
    examSubmission: randomUUID(),
    mcSubmission: randomUUID(),
    shopItem: randomUUID(),
  };
}

describe('GradesService (real PostgreSQL & concurrency)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let grades: GradesService;
  let ledger: PointsLedgerService;
  let shop: ShopService;
  let rateLimiter: ShopPurchaseRateLimiter;
  let dispatcher: OutboxDispatcher;
  let ids: ReturnType<typeof makeIds>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({
          ...authTestConfig({ gradeWeightTp: 1, gradeWeightExam: 1.5 }),
          databaseUrl,
        }),
        GradesModule,
        ShopModule,
      ],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    grades = module.get(GradesService);
    ledger = module.get(PointsLedgerService);
    shop = module.get(ShopService);
    rateLimiter = module.get(ShopPurchaseRateLimiter);
    dispatcher = module.get(OutboxDispatcher);
  }, 20_000);

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    rateLimiter.clear();
    ids = makeIds();

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [ids.teacher, ids.secondTeacher, ids.student, ids.parent].map((id) => ({
          id,
          email: `grades-int-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: `Synthetic ${id.slice(0, 6)}`,
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.create({
        data: {
          id: ids.classroom,
          independentTeacherId: ids.teacher,
          name: 'Grades Classroom',
        },
      });
      await tx.classroomMembership.createMany({
        data: [
          {
            classroomId: ids.classroom,
            userId: ids.secondTeacher,
            role: ClassroomRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
          {
            classroomId: ids.classroom,
            userId: ids.student,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
        ],
      });
      await tx.parentLink.create({
        data: {
          classroomId: ids.classroom,
          parentId: ids.parent,
          childId: ids.student,
          state: MembershipState.ACTIVE,
        },
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
            publishedAt: new Date('2026-11-10T10:00:00.000Z'),
            title: 'TP Weighted',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.20'),
          },
          {
            id: ids.examActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.EXAM,
            format: ActivityFormat.FILE,
            state: ActivityState.PUBLISHED,
            publishedAt: new Date('2026-11-10T10:00:00.000Z'),
            title: 'Exam Weighted',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
          {
            id: ids.mcActivity,
            classroomId: ids.classroom,
            createdById: ids.teacher,
            type: ActivityType.TP,
            format: ActivityFormat.MULTIPLE_CHOICE,
            state: ActivityState.PUBLISHED,
            publishedAt: new Date('2026-11-10T10:00:00.000Z'),
            title: 'Quiz Auto',
            dueAt: futureInstant(7, 12),
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
        ],
      });
      await tx.submission.createMany({
        data: [
          {
            id: ids.tpSubmission,
            activityId: ids.tpActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T10:00:00.000Z'),
            isLate: false,
            idempotencyKey: `sub-tp-${ids.tpSubmission}`,
          },
          {
            id: ids.examSubmission,
            activityId: ids.examActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T11:00:00.000Z'),
            isLate: false,
            idempotencyKey: `sub-exam-${ids.examSubmission}`,
          },
          {
            id: ids.mcSubmission,
            activityId: ids.mcActivity,
            studentId: ids.student,
            submittedAt: new Date('2026-11-11T12:00:00.000Z'),
            isLate: false,
            idempotencyKey: `sub-mc-${ids.mcSubmission}`,
          },
        ],
      });
      await tx.shopItem.create({
        data: {
          id: ids.shopItem,
          code: `item_${ids.shopItem}`,
          name: 'Grades Test Cap',
          description: 'Synthetic shop item',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 80,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'cap' },
        },
      });
    });
  });

  it('prevents duplicate grading under concurrent Promise.all POST requests', async () => {
    const outcomes = await Promise.allSettled([
      grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 80,
        feedback: 'Graded first',
      }),
      grades.gradeSubmission(ids.secondTeacher, ids.tpSubmission, {
        score: 90,
        feedback: 'Graded second',
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const storedGrades = await prisma.grade.findMany({
      where: { submissionId: ids.tpSubmission },
      include: { revisions: true },
    });
    expect(storedGrades).toHaveLength(1);
    expect(storedGrades[0].revisions).toHaveLength(1);
    expect(storedGrades[0].version).toBe(1);

    const ledgerEntries = await prisma.pointTransaction.findMany({
      where: { classroomId: ids.classroom, studentId: ids.student },
    });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].entryKind).toBe(PointEntryKind.EARNING);
    expect(ledgerEntries[0].amount).toBe(storedGrades[0].pointsAwarded);

    const events = await prisma.outboxEvent.findMany({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['resourceId'], equals: storedGrades[0].id },
      },
    });
    expect(events).toHaveLength(1);
  });

  it('serializes concurrent Promise.all PATCH regrades with the same version cleanly', async () => {
    const initial = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
      score: 60,
      feedback: 'Initial exam grade',
    });
    // Exam weight 1.5 * activity 1.0 * 60 = 90
    expect(initial.pointsAwarded).toBe(90);

    const outcomes = await Promise.allSettled([
      grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80,
        feedback: 'Regraded to 80',
        version: 1,
      }),
      grades.regradeSubmission(ids.secondTeacher, ids.examSubmission, {
        score: 70,
        feedback: 'Regraded to 70',
        version: 1,
      }),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const stored = await prisma.grade.findUniqueOrThrow({
      where: { id: initial.id },
      include: { revisions: { orderBy: { version: 'asc' } } },
    });
    expect(stored.version).toBe(2);
    expect(stored.revisions).toHaveLength(2);
    expect([120, 105]).toContain(stored.pointsAwarded);

    const compensations = await prisma.pointTransaction.findMany({
      where: {
        classroomId: ids.classroom,
        studentId: ids.student,
        entryKind: PointEntryKind.COMPENSATION,
      },
    });
    expect(compensations).toHaveLength(1);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(stored.pointsAwarded);
  });

  it('never leaves a negative balance when a capped downward regrade races ShopService.purchase', async () => {
    const initial = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80, // 80 * 1.5 = 120 points
      feedback: 'Initial points 120',
    });

    // Purchase costs 80; the regrade to 20 (30 pts) wants -90 but is capped at the balance.
    const outcomes = await Promise.allSettled([
      grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 20,
        feedback: 'Downward adjustment',
        version: 1,
      }),
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.shopItem }, 'race-buy-1'),
    ]);

    // A regrade always succeeds regardless of the balance.
    expect(outcomes[0].status).toBe('fulfilled');
    if (outcomes[1].status === 'rejected') {
      expect(outcomes[1].reason).toBeInstanceOf(ConflictException);
    }
    const purchased = outcomes[1].status === 'fulfilled' ? 80 : 0;

    const revision = await prisma.gradeRevision.findUniqueOrThrow({
      where: { gradeId_version: { gradeId: initial.id, version: 2 } },
    });
    const grade = await prisma.grade.findUniqueOrThrow({ where: { id: initial.id } });
    const finalBalance = await ledger.getBalance(ids.classroom, ids.student);

    expect(finalBalance).toBeGreaterThanOrEqual(0);
    expect([0, 30]).toContain(finalBalance);
    expect(finalBalance).toBe(120 - purchased + revision.pointsDelta);
    expect(revision.pointsDelta - revision.pointsUnrecovered).toBe(-90);
    expect(grade.pointsAwarded).toBe(120 + revision.pointsDelta);
  });

  it('rolls back ledger and outbox writes atomically when grade creation fails inside transaction', async () => {
    const originalTx = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (fn: unknown) => {
      return originalTx(async (tx: Prisma.TransactionClient) => {
        const failingGrade = new Proxy(tx.grade, {
          get(target, prop, receiver) {
            if (prop === 'create') {
              return async () => {
                throw new Error('Simulated post-credit grade write failure');
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        const failingTx = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === 'grade') {
              return failingGrade;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        return (fn as (client: Prisma.TransactionClient) => Promise<unknown>)(failingTx);
      });
    });

    await expect(
      grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 85,
        feedback: 'Will roll back',
      }),
    ).rejects.toThrow('Simulated post-credit grade write failure');

    expect(await prisma.grade.count({ where: { submissionId: ids.tpSubmission } })).toBe(0);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(0);
    expect(
      await prisma.pointTransaction.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('regrades from the stored weight snapshot after the activity weight changes', async () => {
    const v1 = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80,
      feedback: 'Initial',
    });
    expect(v1.pointsAwarded).toBe(120);

    await prisma.activity.update({
      where: { id: ids.examActivity },
      data: { weightMultiplier: new Prisma.Decimal('2.00') },
    });

    const noScoreChange = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80,
      feedback: 'Feedback only',
      version: 1,
    });
    expect(noScoreChange.pointsAwarded).toBe(120);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(120);
    expect(
      await prisma.pointTransaction.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(1);
    const revision = await prisma.gradeRevision.findUniqueOrThrow({
      where: { gradeId_version: { gradeId: v1.id, version: 2 } },
    });
    expect(revision.pointsDelta).toBe(0);
    expect(revision.pointTransactionId).toBeNull();

    // A score change after the weight change still uses the stored multiplier (1.00).
    const scoreChange = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 60,
      feedback: 'Lower score',
      version: 2,
    });
    expect(scoreChange.pointsAwarded).toBe(90);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(90);
  });

  it('regrades from the stored type weight after the configured type weight changes', async () => {
    await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80,
      feedback: 'Initial',
    });

    const holder = grades as unknown as { config: Record<string, unknown> };
    const originalConfig = holder.config;
    holder.config = { ...originalConfig, gradeWeightTp: 1, gradeWeightExam: 3 };
    try {
      const sameScore = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80,
        feedback: 'Feedback only',
        version: 1,
      });
      expect(sameScore.pointsAwarded).toBe(120);
      expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(120);

      const changed = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 60,
        feedback: 'Lower score',
        version: 2,
      });
      expect(changed.pointsAwarded).toBe(90);
      expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(90);
    } finally {
      holder.config = originalConfig;
    }
  });

  it('supports 0-to-positive regrade, delta=0 skip, a capped downward regrade, and recovery', async () => {
    // 1. Initial grade with 0 score -> no PointTransaction, pointTransactionId = null
    const v1 = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
      score: 0,
      feedback: 'Blank upload',
    });
    expect(v1.pointsAwarded).toBe(0);
    expect(v1.pointTransactionId).toBeNull();
    expect(
      await prisma.pointTransaction.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);

    // 2. Regrade 0 -> 80 (120 pts): uses EARNING credit and links Grade.pointTransactionId
    const v2 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80,
      feedback: 'Corrected upload',
      version: 1,
    });
    expect(v2.version).toBe(2);
    expect(v2.pointsAwarded).toBe(120);
    expect(v2.pointTransactionId).toEqual(expect.any(String));
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(120);

    // 3. Feedback-only regrade (delta = 0): writes GradeRevision without any PointTransaction
    const v3 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80,
      feedback: 'Added rubric note',
      version: 2,
    });
    expect(v3.version).toBe(3);
    expect(v3.pointTransactionId).toBe(v2.pointTransactionId);
    expect(
      await prisma.pointTransaction.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(1);

    // 4. Spend 80 in shop -> balance 40; regrade to 0 (-120) succeeds, capped at the 40 available
    await shop.purchase(ids.student, ids.classroom, { shopItemId: ids.shopItem }, 'spend-80');
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(40);

    const v4 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 0,
      feedback: 'Zeroed after spending',
      version: 3,
    });
    expect(v4.version).toBe(4);
    expect(v4.pointsAwarded).toBe(80); // net actually credited: 120 - 40
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(0);

    // 5. Regrade back up to 60 (90 pts): delta = 90 - 80 = +10 credited
    const v5 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 60,
      feedback: 'Adjusted to 60',
      version: 4,
    });
    expect(v5.version).toBe(5);
    expect(v5.pointsAwarded).toBe(90);
    expect(v5.pointTransactionId).toBe(v2.pointTransactionId);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(10);

    const revisions = await prisma.gradeRevision.findMany({
      where: { gradeId: v1.id },
      orderBy: { version: 'asc' },
    });
    expect(
      revisions.map((r) => [
        r.version,
        r.pointsDelta,
        r.pointsUnrecovered,
        r.pointTransactionId !== null,
      ]),
    ).toEqual([
      [1, 0, 0, false],
      [2, 120, 0, true],
      [3, 0, 0, false],
      [4, -40, 80, true],
      [5, 10, 0, true],
    ]);
  });

  describe('balance-capped downward regrade', () => {
    async function gradeExam80() {
      return grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80, // 120 points
        feedback: 'Initial points 120',
      });
    }

    it('caps at the available balance, records the unrecovered part, and recovers on a later upward regrade', async () => {
      const v1 = await gradeExam80();
      await shop.purchase(ids.student, ids.classroom, { shopItemId: ids.shopItem }, 'cap-spend');
      expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(40);

      // 20 * 1.5 = 30 pts -> delta -90, only 40 recoverable
      const v2 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 20,
        feedback: 'Down',
        version: 1,
      });
      expect(v2.pointsAwarded).toBe(80);
      expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(0);
      const rev2 = await prisma.gradeRevision.findUniqueOrThrow({
        where: { gradeId_version: { gradeId: v1.id, version: 2 } },
      });
      expect(rev2.pointsDelta).toBe(-40);
      expect(rev2.pointsUnrecovered).toBe(50);
      expect(rev2.pointTransactionId).not.toBeNull();

      // back to 80 -> 120 pts: delta = 120 - 80 = +40
      const v3 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80,
        feedback: 'Up',
        version: 2,
      });
      expect(v3.pointsAwarded).toBe(120);
      expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(40);
    });

    it('writes no ledger entry when the balance is zero and records the full delta as unrecovered', async () => {
      const v1 = await gradeExam80();
      await ledger.debit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 120,
        sourceType: 'shop_purchase',
        sourceId: randomUUID(),
        reason: 'Spend everything',
      });
      const entriesBefore = await prisma.pointTransaction.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      });

      const v2 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 20,
        feedback: 'Down at zero balance',
        version: 1,
      });

      expect(v2.pointsAwarded).toBe(120);
      expect(
        await prisma.pointTransaction.count({
          where: { classroomId: ids.classroom, studentId: ids.student },
        }),
      ).toBe(entriesBefore);
      const rev2 = await prisma.gradeRevision.findUniqueOrThrow({
        where: { gradeId_version: { gradeId: v1.id, version: 2 } },
      });
      expect(rev2.pointsDelta).toBe(0);
      expect(rev2.pointsUnrecovered).toBe(90);
      expect(rev2.pointTransactionId).toBeNull();
    });

    describe('after a waiver (never recover waived points)', () => {
      // 120 pts, spend 80 -> balance 40; regrade to score 40 (60 pts): applied -40, unrecovered 20, awarded 80.
      async function waived() {
        const v1 = await gradeExam80();
        await shop.purchase(ids.student, ids.classroom, { shopItemId: ids.shopItem }, 'waive');
        const v2 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 40,
          feedback: 'Waived',
          version: 1,
        });
        expect(v2.pointsAwarded).toBe(80);
        expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(0);
        return v1;
      }

      async function entryCount() {
        return prisma.pointTransaction.count({
          where: { classroomId: ids.classroom, studentId: ids.student },
        });
      }

      async function lastRevision(gradeId: string, version: number) {
        return prisma.gradeRevision.findUniqueOrThrow({
          where: { gradeId_version: { gradeId, version } },
        });
      }

      it('a same-score feedback-only regrade moves no points even after new earnings', async () => {
        const v1 = await waived();
        await ledger.credit({
          classroomId: ids.classroom,
          studentId: ids.student,
          amount: 50,
          sourceType: 'activity_bonus',
          sourceId: randomUUID(),
          reason: 'Newly earned',
        });
        const before = await entryCount();

        const v3 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 40,
          feedback: 'Only feedback',
          version: 2,
        });

        expect(v3.pointsAwarded).toBe(80);
        expect(await entryCount()).toBe(before);
        expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(50);
        const rev = await lastRevision(v1.id, 3);
        expect([rev.pointsDelta, rev.pointsUnrecovered, rev.pointTransactionId]).toEqual([
          0,
          0,
          null,
        ]);
      });

      it('an upward regrade first absorbs what was already credited', async () => {
        const v1 = await waived();

        // 52 * 1.5 = 78 pts: prev (60) <= 78 < awarded (80) -> no ledger write
        const v3 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 52,
          feedback: 'Partly back up',
          version: 2,
        });
        expect(v3.pointsAwarded).toBe(80);
        expect(await entryCount()).toBe(3);
        expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(0);
        const rev3 = await lastRevision(v1.id, 3);
        expect([rev3.pointsDelta, rev3.pointsUnrecovered, rev3.pointTransactionId]).toEqual([
          0,
          0,
          null,
        ]);

        // back to 120 pts: only target - awarded = +40 is credited
        const v4 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 80,
          feedback: 'Fully back',
          version: 3,
        });
        expect(v4.pointsAwarded).toBe(120);
        expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(40);
        expect((await lastRevision(v1.id, 4)).pointsDelta).toBe(40);
      });

      it('a second downward regrade below the previous score applies only target - prev, capped', async () => {
        const v1 = await waived();
        await ledger.credit({
          classroomId: ids.classroom,
          studentId: ids.student,
          amount: 10,
          sourceType: 'activity_bonus',
          sourceId: randomUUID(),
          reason: 'Small balance',
        });

        // score 20 = 30 pts; prev = 60 -> requested -30, only 10 available
        const v3 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 20,
          feedback: 'Lower still',
          version: 2,
        });

        expect(v3.pointsAwarded).toBe(70);
        expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(0);
        const rev = await lastRevision(v1.id, 3);
        expect(rev.pointsDelta).toBe(-10);
        expect(rev.pointsUnrecovered).toBe(20);
      });
    });

    it('compensates in full when the balance covers the delta', async () => {
      const v1 = await gradeExam80();

      const v2 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 20,
        feedback: 'Down with funds',
        version: 1,
      });

      expect(v2.pointsAwarded).toBe(30);
      expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(30);
      const rev2 = await prisma.gradeRevision.findUniqueOrThrow({
        where: { gradeId_version: { gradeId: v1.id, version: 2 } },
      });
      expect(rev2.pointsDelta).toBe(-90);
      expect(rev2.pointsUnrecovered).toBe(0);
      expect(rev2.pointTransactionId).not.toBeNull();
    });
  });

  it('materializes student-only grade_posted in-app notification without parent or email notifications', async () => {
    const grade = await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
      score: 90,
      feedback: 'Great analysis',
    });

    const pending = await prisma.outboxEvent.findMany({
      where: {
        type: NOTIFICATION_REQUESTED_EVENT,
        payload: { path: ['resourceId'], equals: grade.id },
      },
    });
    expect(pending).toHaveLength(1);

    await dispatcher.dispatchPending(
      100,
      new Date(),
      [NOTIFICATION_REQUESTED_EVENT],
      pending.map((e) => e.id),
    );

    const notices = await prisma.notification.findMany({
      where: { resourceId: grade.id },
      include: { deliveries: true },
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      kind: 'grade_posted',
      classroomId: ids.classroom,
      recipientId: ids.student,
      studentId: ids.student,
      resourceId: grade.id,
    });
    expect(notices[0].deliveries.map((d) => d.channel)).toEqual(['in_app']);
  });

  it('rejects non-FILE submissions (409) and enforces CHECK constraints and ON DELETE RESTRICT', async () => {
    await expect(
      grades.gradeSubmission(ids.teacher, ids.mcSubmission, {
        score: 100,
        feedback: 'Should reject MC',
      }),
    ).rejects.toThrow(ConflictException);

    // CHECK constraints on grades
    for (const badGrade of [
      { score: -1, feedback: 'ok', pointsAwarded: 0, version: 1 },
      { score: 101, feedback: 'ok', pointsAwarded: 0, version: 1 },
      { score: 50, feedback: '   ', pointsAwarded: 0, version: 1 },
      { score: 50, feedback: 'x'.repeat(5001), pointsAwarded: 0, version: 1 },
      { score: 50, feedback: 'ok', pointsAwarded: -1, version: 1 },
      { score: 50, feedback: 'ok', pointsAwarded: 0, version: 0 },
      { score: 50, feedback: 'ok', pointsAwarded: 0, version: 1, typeWeight: 0.05 },
      { score: 50, feedback: 'ok', pointsAwarded: 0, version: 1, typeWeight: 10.01 },
      { score: 50, feedback: 'ok', pointsAwarded: 0, version: 1, weightMultiplier: 0.4 },
      { score: 50, feedback: 'ok', pointsAwarded: 0, version: 1, weightMultiplier: 3.1 },
    ]) {
      await expect(
        prisma.grade.create({
          data: {
            submissionId: ids.tpSubmission,
            graderId: ids.teacher,
            gradedAt: new Date(),
            typeWeight: 1,
            weightMultiplier: 1,
            ...badGrade,
          },
        }),
      ).rejects.toThrow();
    }

    // Valid grade created via service cannot have its submission or grade deleted (ON DELETE RESTRICT)
    const created = await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
      score: 75,
      feedback: 'Good work',
    });
    await expect(prisma.submission.delete({ where: { id: ids.tpSubmission } })).rejects.toThrow();
    await expect(prisma.grade.delete({ where: { id: created.id } })).rejects.toThrow();
  });

  describe('activity maxScore', () => {
    const setMaxScore = (maxScore: number) =>
      prisma.activity.update({ where: { id: ids.examActivity }, data: { maxScore } });

    async function countWrites() {
      const [grades_, revisions, ledgerRows, outbox] = await Promise.all([
        prisma.grade.count({ where: { submissionId: ids.examSubmission } }),
        prisma.gradeRevision.count({ where: { grade: { submissionId: ids.examSubmission } } }),
        prisma.pointTransaction.count({ where: { classroomId: ids.classroom } }),
        prisma.outboxEvent.count({
          where: {
            type: NOTIFICATION_REQUESTED_EVENT,
            payload: { path: ['classroomId'], equals: ids.classroom },
          },
        }),
      ]);
      return { grades: grades_, revisions, ledgerRows, outbox };
    }

    it('rejects an initial score above maxScore on field score and writes nothing, and accepts the maximum', async () => {
      await setMaxScore(20);
      const before = await countWrites();

      const error = await grades
        .gradeSubmission(ids.teacher, ids.examSubmission, { score: 21, feedback: 'Too high' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RequestValidationException);
      expect((error as RequestValidationException).details).toEqual([
        { field: 'score', messages: ['score must not exceed the activity maxScore (20)'] },
      ]);
      expect(await countWrites()).toEqual(before);

      const ok = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 20,
        feedback: 'At the maximum',
      });
      expect(ok.score).toBe(20);
    });

    it('rejects a regrade that raises the score above maxScore and writes nothing', async () => {
      await setMaxScore(20);
      const v1 = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 10,
        feedback: 'Initial',
      });
      const before = await countWrites();

      await expect(
        grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 21,
          feedback: 'Too high',
          version: v1.version,
        }),
      ).rejects.toThrow(RequestValidationException);
      expect(await countWrites()).toEqual(before);
    });

    it('keeps a feedback-only regrade working after maxScore drops below the stored score, but rejects a score change above the new maxScore', async () => {
      const v1 = await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80,
        feedback: 'Initial',
      });
      await setMaxScore(50);

      const v2 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80,
        feedback: 'Feedback only',
        version: v1.version,
      });
      expect(v2.score).toBe(80);
      expect(v2.version).toBe(2);
      expect(v2.feedback).toBe('Feedback only');
      const before = await countWrites();

      await expect(
        grades.regradeSubmission(ids.teacher, ids.examSubmission, {
          score: 60,
          feedback: 'Still above the new maximum',
          version: v2.version,
        }),
      ).rejects.toThrow(RequestValidationException);
      expect(await countWrites()).toEqual(before);

      const v3 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 50,
        feedback: 'At the new maximum',
        version: v2.version,
      });
      expect(v3.score).toBe(50);
    });
  });

  describe('departed students', () => {
    async function removeStudent() {
      await prisma.classroomMembership.updateMany({
        where: { classroomId: ids.classroom, userId: ids.student },
        data: { state: MembershipState.INACTIVE, deletedAt: new Date() },
      });
    }

    async function countWrites(submissionId: string) {
      const [grade, ledgerRows, revisions, outbox] = await Promise.all([
        prisma.grade.findUnique({ where: { submissionId }, select: { id: true } }),
        prisma.pointTransaction.count({ where: { classroomId: ids.classroom } }),
        prisma.gradeRevision.count({ where: { grade: { submissionId } } }),
        prisma.outboxEvent.count({
          where: {
            type: NOTIFICATION_REQUESTED_EVENT,
            payload: { path: ['classroomId'], equals: ids.classroom },
          },
        }),
      ]);
      return { hasGrade: grade !== null, ledgerRows, revisions, outbox };
    }

    it.each([
      ['a points-awarding score', 80],
      ['a zero score', 0],
    ])('rejects initial grading with 409 for %s and writes nothing', async (_label, score) => {
      await removeStudent();
      const before = await countWrites(ids.examSubmission);

      await expect(
        grades.gradeSubmission(ids.teacher, ids.examSubmission, {
          score,
          feedback: 'After leaving',
        }),
      ).rejects.toThrow(ConflictException);

      expect(await countWrites(ids.examSubmission)).toEqual(before);
    });

    it('rejects a feedback-only regrade with 409 and writes no ledger, revision or notification', async () => {
      const existing = await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 70,
        feedback: 'Graded before leaving',
      });
      await removeStudent();
      const before = await countWrites(ids.tpSubmission);

      await expect(
        grades.regradeSubmission(ids.teacher, ids.tpSubmission, {
          score: 70,
          feedback: 'Feedback only after leaving',
          version: existing.version,
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        grades.regradeSubmission(ids.teacher, ids.tpSubmission, {
          score: 90,
          feedback: 'Points change after leaving',
          version: existing.version,
        }),
      ).rejects.toThrow(ConflictException);

      expect(await countWrites(ids.tpSubmission)).toEqual(before);
    });

    it('hides the departed student from the grading queue and keeps totals consistent', async () => {
      await removeStudent();

      const queue = await grades.listGradingQueue(ids.teacher, ids.classroom, {
        page: 1,
        pageSize: 20,
      } as never);

      expect(queue.items).toEqual([]);
      expect(queue.total).toBe(0);
    });

    it('keeps existing grades readable by staff after the student leaves', async () => {
      const existing = await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 70,
        feedback: 'Graded before leaving',
      });
      await removeStudent();

      const read = await grades.getGrade(ids.teacher, ids.tpSubmission);
      expect(read.id).toBe(existing.id);
    });
  });

  describe('grading queue sorted by gradedAt', () => {
    async function gradeExamThenTp(): Promise<void> {
      await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 60,
        feedback: 'Graded first',
      });
      await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 70,
        feedback: 'Graded last',
      });
    }

    const queue = async (sort: string, page: number, pageSize: number) =>
      (
        await grades.listGradingQueue(ids.teacher, ids.classroom, {
          page,
          pageSize,
          sort,
        } as never)
      ).items.map((item) => item.id);

    it('puts the most recently graded first and ungraded submissions last on -gradedAt', async () => {
      await gradeExamThenTp();

      expect(await queue('-gradedAt', 1, 2)).toEqual([ids.tpSubmission, ids.examSubmission]);
      expect(await queue('-gradedAt', 2, 2)).toEqual([ids.mcSubmission]);
      expect(await queue('-gradedAt', 1, 1)).toEqual([ids.tpSubmission]);
      expect(await queue('-gradedAt', 3, 1)).toEqual([ids.mcSubmission]);
    });

    it('also leaves ungraded submissions last on ascending gradedAt', async () => {
      await gradeExamThenTp();

      expect(await queue('gradedAt', 1, 3)).toEqual([
        ids.examSubmission,
        ids.tpSubmission,
        ids.mcSubmission,
      ]);
      expect(await queue('gradedAt', 2, 2)).toEqual([ids.mcSubmission]);
    });
  });
});
