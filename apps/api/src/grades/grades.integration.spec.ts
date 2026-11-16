import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
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

  it('prevents negative balance under concurrent Promise.all downward regrade vs ShopService.purchase', async () => {
    await grades.gradeSubmission(ids.teacher, ids.examSubmission, {
      score: 80, // 80 * 1.5 = 120 points
      feedback: 'Initial points 120',
    });

    // Purchase costs 80 (needs 80), regrade to 20 subtracts 90 (needs 90) -> only one can fit in 120.
    const outcomes = await Promise.allSettled([
      grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 20, // 20 * 1.5 = 30 -> delta -90
        feedback: 'Downward adjustment',
        version: 1,
      }),
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.shopItem }, 'race-buy-1'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const finalBalance = await ledger.getBalance(ids.classroom, ids.student);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
    expect([30, 40]).toContain(finalBalance);
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

  it('supports 0-to-positive regrade, subsequent compensation across 0, delta=0 skip, and negative balance 409', async () => {
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

    // 4. Spend 80 in shop -> remaining balance is 40; downward regrade of -120 must fail 409
    await shop.purchase(ids.student, ids.classroom, { shopItemId: ids.shopItem }, 'spend-80');
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(40);

    await expect(
      grades.regradeSubmission(ids.teacher, ids.examSubmission, {
        score: 0,
        feedback: 'Cannot go negative',
        version: 3,
      }),
    ).rejects.toThrow(ConflictException);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(40);

    // 5. Partial downward regrade (-30 pts: 80 -> 60 = 90 pts) succeeds and leaves 10 pts
    const v4 = await grades.regradeSubmission(ids.teacher, ids.examSubmission, {
      score: 60,
      feedback: 'Adjusted to 60',
      version: 3,
    });
    expect(v4.version).toBe(4);
    expect(v4.pointsAwarded).toBe(90);
    expect(v4.pointTransactionId).toBe(v2.pointTransactionId);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(10);

    const revisions = await prisma.gradeRevision.findMany({
      where: { gradeId: v1.id },
      orderBy: { version: 'asc' },
    });
    expect(revisions.map((r) => [r.version, r.pointsDelta, r.pointTransactionId !== null])).toEqual(
      [
        [1, 0, false],
        [2, 120, true],
        [3, 0, false],
        [4, -30, true],
      ],
    );
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
    ]) {
      await expect(
        prisma.grade.create({
          data: {
            submissionId: ids.tpSubmission,
            graderId: ids.teacher,
            gradedAt: new Date(),
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

  it('rejects points-changing grade for an inactive student via PointsLedgerService (404) while preserving staff read access on existing grade', async () => {
    const existing = await grades.gradeSubmission(ids.teacher, ids.tpSubmission, {
      score: 70,
      feedback: 'Graded before leaving',
    });

    await prisma.classroomMembership.updateMany({
      where: { classroomId: ids.classroom, userId: ids.student },
      data: { state: MembershipState.INACTIVE, deletedAt: new Date() },
    });

    // Staff read remains preserved
    const read = await grades.getGrade(ids.teacher, ids.tpSubmission);
    expect(read.id).toBe(existing.id);

    // New points credit or compensation after student leaves fails cleanly via PointsLedgerService
    await expect(
      grades.gradeSubmission(ids.teacher, ids.examSubmission, {
        score: 80,
        feedback: 'After leaving',
      }),
    ).rejects.toThrow(NotFoundException);

    await expect(
      grades.regradeSubmission(ids.teacher, ids.tpSubmission, {
        score: 90,
        feedback: 'After leaving',
        version: 1,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
