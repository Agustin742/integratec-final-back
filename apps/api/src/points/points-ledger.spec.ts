import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PointEntryKind } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import { RequestValidationException } from '../http/validation';
import type { PrismaService } from '../prisma/prisma.service';
import { PointsLedgerService } from './points-ledger.service';

const classroomId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000002';
const sourceId = '00000000-0000-4000-8000-000000000003';
const actorId = '00000000-0000-4000-8000-000000000004';
const entryId = '00000000-0000-4000-8000-000000000005';
const otherClassroomId = '00000000-0000-4000-8000-000000000099';
const now = new Date('2026-11-13T12:00:00.000Z');

describe('PointsLedgerService (unit)', () => {
  let txClient: {
    $queryRaw: ReturnType<typeof vi.fn>;
    pointTransaction: {
      aggregate: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    pointTransaction: {
      aggregate: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let access: {
    verifyClassroomAccess: ReturnType<typeof vi.fn>;
    verifyStudentResourceAccess: ReturnType<typeof vi.fn>;
  };
  let service: PointsLedgerService;

  beforeEach(() => {
    txClient = {
      $queryRaw: vi.fn(),
      pointTransaction: {
        aggregate: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };
    prisma = {
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (client: typeof txClient) => Promise<unknown>)(txClient);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
      pointTransaction: {
        aggregate: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };
    access = {
      verifyClassroomAccess: vi.fn(),
      verifyStudentResourceAccess: vi.fn(),
    };
    service = new PointsLedgerService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes no update or delete mutation methods on the service', () => {
    const prototypeMethods = Object.getOwnPropertyNames(PointsLedgerService.prototype);
    expect(prototypeMethods).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/update/i),
        expect.stringMatching(/delete/i),
        expect.stringMatching(/remove/i),
      ]),
    );
  });

  describe('input validation', () => {
    it.each([
      { classroomId: 'not-a-uuid' },
      { studentId: 'not-a-uuid' },
      { sourceId: 'not-a-uuid' },
      { actorId: 'not-a-uuid' },
      { amount: 0 },
      { amount: -10 },
      { amount: 1.5 },
      { amount: 2_147_483_648 },
      { sourceType: '   ' },
      { sourceType: 'x'.repeat(41) },
      { reason: '   ' },
      { reason: 'r'.repeat(241) },
    ])('rejects invalid credit input %j before touching Prisma', async (override) => {
      await expect(
        service.credit({
          classroomId,
          studentId,
          amount: 25,
          sourceType: 'submission_grade',
          sourceId,
          reason: 'Graded quiz',
          ...override,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      { amount: 0 },
      { amount: -5 },
      { idempotencyKey: '   ' },
      { idempotencyKey: 'k'.repeat(129) },
    ])('rejects invalid debit input %j before touching Prisma', async (override) => {
      await expect(
        service.debit({
          classroomId,
          studentId,
          amount: 10,
          sourceType: 'shop_purchase',
          sourceId,
          reason: 'Purchased item',
          ...override,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      { delta: 0 },
      { delta: 1.25 },
      { delta: -2_147_483_649 },
      { actorId: 'not-a-uuid' },
      { reason: '' },
    ])('rejects invalid compensate input %j before touching Prisma', async (override) => {
      await expect(
        service.compensate({
          classroomId,
          studentId,
          delta: -5,
          sourceType: 'grade_regrade',
          sourceId,
          reason: 'Grade adjusted',
          actorId,
          ...override,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('membership lock & error mappings', () => {
    it('throws NotFoundException when student membership is missing or inactive', async () => {
      txClient.$queryRaw.mockResolvedValueOnce([]);
      await expect(
        service.credit({
          classroomId,
          studentId,
          amount: 50,
          sourceType: 'submission_grade',
          sourceId,
          reason: 'Activity graded',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('maps PostgreSQL earning row into PointEntryKind.EARNING and returns created=true', async () => {
      txClient.$queryRaw.mockResolvedValueOnce([{ id: 'membership-id' }]).mockResolvedValueOnce([
        {
          id: entryId,
          classroomId,
          studentId,
          actorId: null,
          entryKind: 'earning',
          amount: 50,
          sourceType: 'submission_grade',
          sourceId,
          idempotencyKey: null,
          reason: 'Activity graded',
          createdAt: now,
        },
      ]);

      const result = await service.credit({
        classroomId,
        studentId,
        amount: 50,
        sourceType: '  submission_grade  ',
        sourceId,
        reason: '  Activity graded  ',
      });

      expect(result).toEqual({
        created: true,
        entry: {
          id: entryId,
          classroomId,
          studentId,
          actorId: null,
          entryKind: PointEntryKind.EARNING,
          amount: 50,
          sourceType: 'submission_grade',
          sourceId,
          idempotencyKey: null,
          reason: 'Activity graded',
          createdAt: now.toISOString(),
        },
      });
    });

    it('throws ConflictException when an existing earning source is reused with mismatched parameters', async () => {
      txClient.$queryRaw.mockResolvedValueOnce([{ id: 'membership-id' }]).mockResolvedValueOnce([]);
      txClient.pointTransaction.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: entryId,
        classroomId,
        studentId,
        actorId: null,
        entryKind: PointEntryKind.EARNING,
        amount: 100,
        sourceType: 'submission_grade',
        sourceId,
        idempotencyKey: null,
        reason: 'Original grade',
        createdAt: now,
      });

      await expect(
        service.credit({
          classroomId,
          studentId,
          amount: 50,
          sourceType: 'submission_grade',
          sourceId,
          reason: 'Tampered replay',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when debit exceeds locked balance', async () => {
      txClient.$queryRaw
        .mockResolvedValueOnce([{ id: 'membership-id' }])
        .mockResolvedValueOnce([{ balance: 30 }]);

      await expect(
        service.debit({
          classroomId,
          studentId,
          amount: 50,
          sourceType: 'shop_purchase',
          sourceId,
          reason: 'Buy hat',
        }),
      ).rejects.toThrow(new ConflictException('Insufficient points balance'));
      expect(txClient.pointTransaction.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when negative compensation would push balance below zero', async () => {
      txClient.$queryRaw
        .mockResolvedValueOnce([{ id: 'membership-id' }])
        .mockResolvedValueOnce([{ balance: 10 }]);

      await expect(
        service.compensate({
          classroomId,
          studentId,
          delta: -15,
          sourceType: 'grade_regrade',
          sourceId,
          reason: 'Regrade correction',
          actorId,
        }),
      ).rejects.toThrow(new ConflictException('Point balance cannot become negative'));
    });

    it('emits structured non-PII JSON log on new compensation without logging emails or names', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      txClient.$queryRaw
        .mockResolvedValueOnce([{ id: 'membership-id' }])
        .mockResolvedValueOnce([{ balance: 100 }]);
      txClient.pointTransaction.create.mockResolvedValueOnce({
        id: entryId,
        classroomId,
        studentId,
        actorId,
        entryKind: PointEntryKind.COMPENSATION,
        amount: -20,
        sourceType: 'grade_regrade',
        sourceId,
        idempotencyKey: null,
        reason: 'Private Student Name <student@example.invalid> adjustment',
        createdAt: now,
      });

      const result = await service.compensate({
        classroomId,
        studentId,
        delta: -20,
        sourceType: 'grade_regrade',
        sourceId,
        reason: 'Private Student Name <student@example.invalid> adjustment',
        actorId,
      });

      expect(result.created).toBe(true);
      expect(logSpy).toHaveBeenCalledTimes(1);
      const loggedPayload = logSpy.mock.calls[0][0];
      expect(loggedPayload).toEqual({
        event: 'points_compensation_recorded',
        classroomId,
        entryId,
        actorId,
        amount: -20,
        sourceType: 'grade_regrade',
        sourceId,
      });
      const serialized = JSON.stringify(logSpy.mock.calls);
      expect(serialized).not.toContain('student@example.invalid');
      expect(serialized).not.toContain('Private Student Name');
    });
  });

  describe('wallet reads, access delegation, and sort rules', () => {
    it('delegates getOwnWallet to verifyClassroomAccess with requiredRole STUDENT', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({ myRole: 'STUDENT' });
      prisma.pointTransaction.aggregate.mockResolvedValueOnce({ _sum: { amount: 75 } });
      prisma.pointTransaction.count.mockResolvedValueOnce(1);
      prisma.pointTransaction.findMany.mockResolvedValueOnce([
        {
          id: entryId,
          entryKind: PointEntryKind.EARNING,
          amount: 75,
          sourceType: 'submission_grade',
          sourceId,
          reason: 'Quiz',
          actorId: null,
          createdAt: now,
        },
      ]);

      const wallet = await service.getOwnWallet(studentId, classroomId, { page: 1, pageSize: 20 });

      expect(access.verifyClassroomAccess).toHaveBeenCalledWith(studentId, classroomId, {
        requiredRole: 'STUDENT',
      });
      expect(prisma.pointTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { classroomId, studentId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: 0,
          take: 20,
        }),
      );
      expect(wallet).toEqual({
        classroomId,
        studentId,
        balance: 75,
        items: [
          {
            id: entryId,
            entryKind: PointEntryKind.EARNING,
            amount: 75,
            sourceType: 'submission_grade',
            sourceId,
            reason: 'Quiz',
            actorId: null,
            createdAt: now.toISOString(),
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      });
    });

    it('delegates getStudentWallet to verifyStudentResourceAccess and supports sort=amount', async () => {
      access.verifyStudentResourceAccess.mockResolvedValueOnce({ myRole: 'TEACHER' });
      prisma.pointTransaction.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });
      prisma.pointTransaction.count.mockResolvedValueOnce(0);
      prisma.pointTransaction.findMany.mockResolvedValueOnce([]);

      const wallet = await service.getStudentWallet(actorId, classroomId, studentId, {
        page: 2,
        pageSize: 10,
        sort: 'amount',
      });

      expect(access.verifyStudentResourceAccess).toHaveBeenCalledWith(
        actorId,
        studentId,
        classroomId,
      );
      expect(prisma.pointTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ amount: 'asc' }, { id: 'asc' }],
          skip: 10,
          take: 10,
        }),
      );
      expect(wallet.balance).toBe(0);
    });

    it('rejects unsupported sort fields with RequestValidationException', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({ myRole: 'STUDENT' });

      await expect(
        service.getOwnWallet(studentId, otherClassroomId, {
          page: 1,
          pageSize: 20,
          sort: '-reason',
        }),
      ).rejects.toThrow(RequestValidationException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reads balance via getBalance inside or outside an outer transaction and validates UUIDs', async () => {
      prisma.pointTransaction.aggregate.mockResolvedValueOnce({ _sum: { amount: 140 } });
      await expect(service.getBalance(classroomId, studentId)).resolves.toBe(140);

      txClient.pointTransaction.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });
      await expect(service.getBalance(classroomId, studentId, txClient as never)).resolves.toBe(0);

      await expect(service.getBalance('bad-uuid', studentId)).rejects.toThrow(BadRequestException);
    });

    it('replays credit, debit, and compensate before locking active student membership', async () => {
      txClient.pointTransaction.findFirst.mockResolvedValueOnce({
        id: entryId,
        classroomId,
        studentId,
        actorId: null,
        entryKind: PointEntryKind.EARNING,
        amount: 100,
        sourceType: 'submission_grade',
        sourceId,
        idempotencyKey: null,
        reason: 'Grade 100',
        createdAt: now,
      });

      const creditReplay = await service.credit({
        classroomId,
        studentId,
        amount: 100,
        sourceType: 'submission_grade',
        sourceId,
        reason: 'Grade 100',
      });
      expect(creditReplay).toEqual(
        expect.objectContaining({
          created: false,
          entry: expect.objectContaining({ id: entryId }),
        }),
      );

      txClient.pointTransaction.findUnique.mockResolvedValueOnce({
        id: entryId,
        classroomId,
        studentId,
        actorId: null,
        entryKind: PointEntryKind.DEBIT,
        amount: -25,
        sourceType: 'shop_purchase',
        sourceId,
        idempotencyKey: 'debit-replay-key',
        reason: 'Shop item',
        createdAt: now,
      });

      const debitReplay = await service.debit({
        classroomId,
        studentId,
        amount: 25,
        sourceType: 'shop_purchase',
        sourceId,
        idempotencyKey: 'debit-replay-key',
        reason: 'Shop item',
      });
      expect(debitReplay).toEqual(
        expect.objectContaining({
          created: false,
          entry: expect.objectContaining({ id: entryId }),
        }),
      );

      txClient.pointTransaction.findUnique.mockResolvedValueOnce({
        id: entryId,
        classroomId,
        studentId,
        actorId,
        entryKind: PointEntryKind.COMPENSATION,
        amount: -10,
        sourceType: 'grade_regrade',
        sourceId,
        idempotencyKey: 'comp-replay-key',
        reason: 'Adjustment',
        createdAt: now,
      });

      const compensateReplay = await service.compensate({
        classroomId,
        studentId,
        delta: -10,
        sourceType: 'grade_regrade',
        sourceId,
        idempotencyKey: 'comp-replay-key',
        reason: 'Adjustment',
        actorId,
      });
      expect(compensateReplay).toEqual(
        expect.objectContaining({
          created: false,
          entry: expect.objectContaining({ id: entryId }),
        }),
      );
      expect(txClient.$queryRaw).not.toHaveBeenCalled();
    });
  });
});
