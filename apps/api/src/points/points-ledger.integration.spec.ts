import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClassroomRole, MembershipState, PointEntryKind, RegistrationPath } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { PrismaService } from '../prisma/prisma.service';
import { PointsLedgerService } from './points-ledger.service';
import { PointsModule } from './points.module';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    otherStudent: randomUUID(),
    classroom: randomUUID(),
    otherClassroom: randomUUID(),
    gradeSource: randomUUID(),
    purchaseSource: randomUUID(),
  };
}

describe('PointsLedgerService (real PostgreSQL)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let ids: ReturnType<typeof makeIds>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), PointsModule],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    ledger = module.get(PointsLedgerService);
  }, 20_000);

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    ids = makeIds();
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [ids.teacher, ids.student, ids.otherStudent].map((id) => ({
          id,
          email: `points-int-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: 'Synthetic User',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          {
            id: ids.classroom,
            independentTeacherId: ids.teacher,
            name: 'Points Classroom',
          },
          {
            id: ids.otherClassroom,
            independentTeacherId: ids.teacher,
            name: 'Other Classroom',
          },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          {
            classroomId: ids.classroom,
            userId: ids.student,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
          {
            classroomId: ids.classroom,
            userId: ids.otherStudent,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
        ],
      });
    });
  });

  it('credits idempotently per (sourceType, sourceId) without aborting an outer transaction', async () => {
    const first = await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 100,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'Activity graded: 10/10',
      actorId: ids.teacher,
    });
    expect(first.created).toBe(true);
    expect(first.entry.entryKind).toBe(PointEntryKind.EARNING);
    expect(first.entry.amount).toBe(100);

    // Replay inside an outer caller $transaction followed by another SQL write: must NOT hit 25P02.
    const replayResult = await prisma.$transaction(async (tx) => {
      const replay = await ledger.credit(
        {
          classroomId: ids.classroom,
          studentId: ids.student,
          amount: 100,
          sourceType: 'submission_grade',
          sourceId: ids.gradeSource,
          reason: 'Activity graded: 10/10',
          actorId: ids.teacher,
        },
        tx,
      );
      const count = await tx.pointTransaction.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      });
      return { replay, count };
    });

    expect(replayResult.replay.created).toBe(false);
    expect(replayResult.replay.entry.id).toBe(first.entry.id);
    expect(replayResult.count).toBe(1);
  });

  it('handles concurrent duplicate earning credits cleanly and rejects mismatched reuse with 409', async () => {
    const results = await Promise.all([
      ledger.credit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 40,
        sourceType: 'submission_grade',
        sourceId: ids.gradeSource,
        reason: 'Concurrent grade',
      }),
      ledger.credit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 40,
        sourceType: 'submission_grade',
        sourceId: ids.gradeSource,
        reason: 'Concurrent grade',
      }),
    ]);

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results.filter((r) => !r.created)).toHaveLength(1);
    expect(results[0].entry.id).toBe(results[1].entry.id);

    await expect(
      ledger.credit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 99,
        sourceType: 'submission_grade',
        sourceId: ids.gradeSource,
        reason: 'Mismatched amount',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rolls back ledger entries atomically when an outer caller transaction fails', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await ledger.credit(
          {
            classroomId: ids.classroom,
            studentId: ids.student,
            amount: 50,
            sourceType: 'submission_grade',
            sourceId: ids.gradeSource,
            reason: 'Rolled back grade',
          },
          tx,
        );
        throw new Error('Synthetic grading rollback');
      }),
    ).rejects.toThrow('Synthetic grading rollback');

    const count = await prisma.pointTransaction.count({
      where: { classroomId: ids.classroom, studentId: ids.student },
    });
    expect(count).toBe(0);
  });

  it('prevents negative balance under concurrent debits using FOR UPDATE locking', async () => {
    await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 100,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'Initial balance 100',
    });

    const attempts = await Promise.allSettled([
      ledger.debit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 60,
        sourceType: 'shop_purchase',
        sourceId: randomUUID(),
        reason: 'Purchase A',
      }),
      ledger.debit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 60,
        sourceType: 'shop_purchase',
        sourceId: randomUUID(),
        reason: 'Purchase B',
      }),
    ]);

    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a) => a.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const wallet = await ledger.getOwnWallet(ids.student, ids.classroom, { page: 1, pageSize: 20 });
    expect(wallet.balance).toBe(40);
    expect(wallet.balance).toBeGreaterThanOrEqual(0);
  });

  it('supports idempotent debit and compensation retries while rejecting parameter mismatches', async () => {
    await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 80,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'Seed points',
    });

    const debitKey = `purchase-${randomUUID()}`;
    const firstDebit = await ledger.debit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 50,
      sourceType: 'shop_purchase',
      sourceId: ids.purchaseSource,
      reason: 'Buy cat hat',
      actorId: ids.student,
      idempotencyKey: debitKey,
    });
    expect(firstDebit.created).toBe(true);
    expect(firstDebit.entry.amount).toBe(-50);

    // Retry succeeds even though remaining balance (30) < debit amount (50).
    const retryDebit = await ledger.debit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 50,
      sourceType: 'shop_purchase',
      sourceId: ids.purchaseSource,
      reason: 'Buy cat hat',
      actorId: ids.student,
      idempotencyKey: debitKey,
    });
    expect(retryDebit.created).toBe(false);
    expect(retryDebit.entry.id).toBe(firstDebit.entry.id);

    await expect(
      ledger.debit({
        classroomId: ids.classroom,
        studentId: ids.student,
        amount: 20,
        sourceType: 'shop_purchase',
        sourceId: ids.purchaseSource,
        reason: 'Changed amount',
        idempotencyKey: debitKey,
      }),
    ).rejects.toThrow(ConflictException);

    const compKey = `comp-${randomUUID()}`;
    const comp1 = await ledger.compensate({
      classroomId: ids.classroom,
      studentId: ids.student,
      delta: 15,
      sourceType: 'grade_regrade',
      sourceId: ids.gradeSource,
      reason: 'Regrade +15',
      actorId: ids.teacher,
      idempotencyKey: compKey,
    });
    const comp2 = await ledger.compensate({
      classroomId: ids.classroom,
      studentId: ids.student,
      delta: 15,
      sourceType: 'grade_regrade',
      sourceId: ids.gradeSource,
      reason: 'Regrade +15',
      actorId: ids.teacher,
      idempotencyKey: compKey,
    });
    expect(comp1.created).toBe(true);
    expect(comp2.created).toBe(false);
    expect(comp2.entry.id).toBe(comp1.entry.id);
  });

  it('allows multiple regrade compensations on the same grade source and blocks negative balance', async () => {
    await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 50,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'Initial grade',
      actorId: ids.teacher,
    });

    const firstAdj = await ledger.compensate({
      classroomId: ids.classroom,
      studentId: ids.student,
      delta: 25,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'First regrade +25',
      actorId: ids.teacher,
    });
    const secondAdj = await ledger.compensate({
      classroomId: ids.classroom,
      studentId: ids.student,
      delta: -15,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'Second regrade -15',
      actorId: ids.teacher,
    });

    expect(firstAdj.entry.id).not.toBe(secondAdj.entry.id);

    await expect(
      ledger.compensate({
        classroomId: ids.classroom,
        studentId: ids.student,
        delta: -61,
        sourceType: 'submission_grade',
        sourceId: ids.gradeSource,
        reason: 'Too negative',
        actorId: ids.teacher,
      }),
    ).rejects.toThrow(ConflictException);

    const wallet = await ledger.getOwnWallet(ids.student, ids.classroom, { page: 1, pageSize: 20 });
    expect(wallet.balance).toBe(60);
    expect(wallet.total).toBe(3);
  });

  it('rejects credit/debit/compensate when student is not actively enrolled in the classroom', async () => {
    await expect(
      ledger.credit({
        classroomId: ids.otherClassroom,
        studentId: ids.student,
        amount: 10,
        sourceType: 'submission_grade',
        sourceId: ids.gradeSource,
        reason: 'Wrong classroom',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces database-level immutability trigger against raw UPDATE and DELETE and CHECK constraints', async () => {
    const { entry } = await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 30,
      sourceType: 'submission_grade',
      sourceId: ids.gradeSource,
      reason: 'Immutable entry',
    });

    await expect(
      prisma.$executeRaw`UPDATE "point_transactions" SET "amount" = 999 WHERE "id" = ${entry.id}::uuid`,
    ).rejects.toThrow(/immutable/i);

    await expect(
      prisma.$executeRaw`DELETE FROM "point_transactions" WHERE "id" = ${entry.id}::uuid`,
    ).rejects.toThrow(/immutable/i);

    await expect(
      prisma.$executeRaw`
        INSERT INTO "point_transactions" (
          "id", "classroom_id", "student_id", "entry_kind", "amount",
          "source_type", "source_id", "reason"
        )
        VALUES (
          ${randomUUID()}::uuid, ${ids.classroom}::uuid, ${ids.student}::uuid,
          'earning'::"point_entry_kind", -10, 'submission_grade', ${randomUUID()}::uuid, 'Negative earning'
        )
      `,
    ).rejects.toThrow();

    const persisted = await prisma.pointTransaction.findUniqueOrThrow({ where: { id: entry.id } });
    expect(persisted.amount).toBe(30);
  });
});
