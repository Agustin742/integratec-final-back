import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ActivityFormat, ActivityType, PointEntryKind, Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { createValidationPipe, RequestValidationException } from '../http/validation';
import type { NotificationRecorder } from '../notifications/notification-recorder.service';
import type { PointsLedgerService } from '../points/points-ledger.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  calculateWeightedGradePoints,
  resolveActivityTypeWeight,
  SUBMISSION_GRADE_SOURCE_TYPE,
  toHundredths,
} from './grade-points';
import { ClassroomSubmissionsController, SubmissionGradesController } from './grades.controller';
import { GradeSubmissionDto, ListGradingQueueQueryDto, RegradeSubmissionDto } from './grades.dto';
import { GradesService } from './grades.service';

const actorId = '00000000-0000-4000-8000-000000000001';
const classroomId = '00000000-0000-4000-8000-000000000002';
const activityId = '00000000-0000-4000-8000-000000000003';
const submissionId = '00000000-0000-4000-8000-000000000004';
const studentId = '00000000-0000-4000-8000-000000000005';
const otherStudentId = '00000000-0000-4000-8000-000000000006';
const gradeId = '00000000-0000-4000-8000-000000000010';
const txId1 = '00000000-0000-4000-8000-000000000020';
const txId2 = '00000000-0000-4000-8000-000000000021';
const now = new Date('2026-11-16T12:00:00.000Z');

describe('grade-points helpers (unit)', () => {
  it('converts numbers, strings, and Prisma.Decimal to exact hundredths without float drift', () => {
    expect(toHundredths(1)).toBe(100);
    expect(toHundredths(1.15)).toBe(115);
    expect(toHundredths(0.75)).toBe(75);
    expect(toHundredths('1.50')).toBe(150);
    expect(toHundredths(new Prisma.Decimal('0.60'))).toBe(60);
    expect(toHundredths(new Prisma.Decimal('2.95'))).toBe(295);

    expect(() => toHundredths(-0.1)).toThrow(RangeError);
    expect(() => toHundredths(1.234)).toThrow(RangeError);
    expect(() => toHundredths('1.234')).toThrow(RangeError);
    expect(() => toHundredths(Number.NaN)).toThrow(RangeError);
  });

  it('computes exact integer half-up weighted points without IEEE-754 drift', () => {
    expect(calculateWeightedGradePoints(0, 1.5, 3)).toBe(0);
    expect(calculateWeightedGradePoints(85, 1, 1)).toBe(85);
    expect(calculateWeightedGradePoints(85, 1.5, 1)).toBe(128); // 127.5 -> 128 half-up
    expect(calculateWeightedGradePoints(1, 1, 0.5)).toBe(1); // 0.5 -> 1 half-up
    expect(calculateWeightedGradePoints(1, 0.1, 0.5)).toBe(0); // 0.05 -> 0
    // In IEEE-754 float: 10 * 0.75 * 0.6 === 4.499999999999999 (Math.round gives 4).
    expect(calculateWeightedGradePoints(10, 0.75, 0.6)).toBe(5);
    expect(calculateWeightedGradePoints(10, 1.15, new Prisma.Decimal('1.00'))).toBe(12);
    expect(calculateWeightedGradePoints(19, 0.35, '1.00')).toBe(7);

    expect(() => calculateWeightedGradePoints(-1, 1, 1)).toThrow(RangeError);
    expect(() => calculateWeightedGradePoints(101, 1, 1)).toThrow(RangeError);
    expect(() => calculateWeightedGradePoints(85.5, 1, 1)).toThrow(RangeError);
  });

  it('looks up the TP and EXAM weights from config', () => {
    expect(
      resolveActivityTypeWeight(ActivityType.TP, { gradeWeightTp: 1, gradeWeightExam: 1.5 }),
    ).toBe(1);
    expect(
      resolveActivityTypeWeight(ActivityType.EXAM, { gradeWeightTp: 1, gradeWeightExam: 1.5 }),
    ).toBe(1.5);
  });
});

describe('Grade & Queue DTO validation (unit)', () => {
  const pipe = createValidationPipe();

  it('validates score bounds, trimmed VisibleText feedback, and rejects unknown fields on GradeSubmissionDto', async () => {
    const valid = await pipe.transform(
      { score: 0, feedback: '  Well done!  ' },
      { type: 'body', metatype: GradeSubmissionDto },
    );
    expect(valid).toEqual({ score: 0, feedback: 'Well done!' });

    const maxValid = await pipe.transform(
      { score: 100, feedback: 'x'.repeat(5000) },
      { type: 'body', metatype: GradeSubmissionDto },
    );
    expect(maxValid.score).toBe(100);
    expect(maxValid.feedback.length).toBe(5000);

    for (const badBody of [
      { score: -1, feedback: 'ok' },
      { score: 101, feedback: 'ok' },
      { score: 85.5, feedback: 'ok' },
      { score: '85', feedback: 'ok' },
      { score: 85, feedback: '' },
      { score: 85, feedback: '   ' },
      { score: 85, feedback: '\u200B\u200C' },
      { score: 85, feedback: 'ok\u0000' },
      { score: 85, feedback: 'line1\nline2' },
      { score: 85, feedback: 'x'.repeat(5001) },
      { score: 85, feedback: 'ok', pointsAwarded: 999 },
      { score: 85, feedback: 'ok', version: 1 },
      { score: 85, feedback: 'ok', studentId },
    ]) {
      await expect(
        pipe.transform(badBody, { type: 'body', metatype: GradeSubmissionDto }),
      ).rejects.toThrow(RequestValidationException);
    }
  });

  it('validates version >= 1 and rejects extra fields on RegradeSubmissionDto', async () => {
    const valid = await pipe.transform(
      { score: 90, feedback: 'Updated', version: 2 },
      { type: 'body', metatype: RegradeSubmissionDto },
    );
    expect(valid).toEqual({ score: 90, feedback: 'Updated', version: 2 });

    for (const badBody of [
      { score: 90, feedback: 'Updated' },
      { score: 90, feedback: 'Updated', version: 0 },
      { score: 90, feedback: 'Updated', version: -1 },
      { score: 90, feedback: 'Updated', version: 1.5 },
      { score: 90, feedback: 'Updated', version: '1' },
      { score: 90, feedback: 'Updated', version: 1, graderId: actorId },
    ]) {
      await expect(
        pipe.transform(badBody, { type: 'body', metatype: RegradeSubmissionDto }),
      ).rejects.toThrow(RequestValidationException);
    }
  });

  it('validates ListGradingQueueQueryDto filters, sort allow-list, and unknown fields', async () => {
    const valid = await pipe.transform(
      { activityId, state: 'graded', sort: '-gradedAt', page: '2', pageSize: '10' },
      { type: 'query', metatype: ListGradingQueueQueryDto },
    );
    expect(valid).toMatchObject({
      activityId,
      state: 'graded',
      sort: '-gradedAt',
      page: 2,
      pageSize: 10,
    });

    for (const badQuery of [
      { activityId: 'not-a-uuid' },
      { state: 'pending' },
      { sort: 'score' },
      { sort: '--submittedAt' },
      { page: '0' },
      { studentId },
    ]) {
      await expect(
        pipe.transform(badQuery, { type: 'query', metatype: ListGradingQueueQueryDto }),
      ).rejects.toThrow(RequestValidationException);
    }
  });
});

describe('GradesService (unit)', () => {
  let txClient: {
    $queryRaw: ReturnType<typeof vi.fn>;
    grade: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    gradeRevision: {
      create: ReturnType<typeof vi.fn>;
    };
    activity: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    submission: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    submission: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let access: {
    verifyClassroomAccess: ReturnType<typeof vi.fn>;
    isActiveStudent: ReturnType<typeof vi.fn>;
  };
  let pointsLedger: {
    credit: ReturnType<typeof vi.fn>;
    compensate: ReturnType<typeof vi.fn>;
  };
  let notifications: {
    record: ReturnType<typeof vi.fn>;
  };
  let service: GradesService;

  beforeEach(() => {
    txClient = {
      $queryRaw: vi.fn(),
      grade: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      gradeRevision: {
        create: vi.fn(),
      },
      activity: {
        findFirst: vi.fn(),
      },
      submission: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };
    prisma = {
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (client: typeof txClient) => Promise<unknown>)(txClient);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
      submission: {
        findFirst: vi.fn().mockResolvedValue({
          id: submissionId,
          activityId,
          studentId,
          activity: { classroomId },
        }),
      },
    };
    access = {
      verifyClassroomAccess: vi.fn().mockResolvedValue({ myRole: 'TEACHER', classroom: {} }),
      isActiveStudent: vi.fn().mockResolvedValue(true),
    };
    pointsLedger = {
      credit: vi.fn().mockResolvedValue({
        created: true,
        entry: {
          id: txId1,
          classroomId,
          studentId,
          actorId,
          entryKind: PointEntryKind.EARNING,
          amount: 100,
          sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
          sourceId: gradeId,
          idempotencyKey: null,
          reason: 'Grade: Essay (100/100)',
          createdAt: now.toISOString(),
        },
      }),
      compensate: vi.fn().mockResolvedValue({
        created: true,
        entry: {
          id: txId2,
          classroomId,
          studentId,
          actorId,
          entryKind: PointEntryKind.COMPENSATION,
          amount: 20,
          sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
          sourceId: gradeId,
          idempotencyKey: null,
          reason: 'Regrade v2',
          createdAt: now.toISOString(),
        },
      }),
    };
    notifications = {
      record: vi.fn().mockResolvedValue(randomUUID()),
    };
    service = new GradesService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
      pointsLedger as unknown as PointsLedgerService,
      notifications as unknown as NotificationRecorder,
      authTestConfig({ gradeWeightTp: 1, gradeWeightExam: 1.5 }),
    );
  });

  it('skips PointsLedgerService.credit when weighted points equal 0 while creating Grade, Revision, and grade_posted notice', async () => {
    txClient.$queryRaw
      .mockResolvedValueOnce([
        {
          id: activityId,
          type: ActivityType.TP,
          format: ActivityFormat.FILE,
          title: 'TP 1',
          weightMultiplier: new Prisma.Decimal('1.00'),
        },
      ])
      .mockResolvedValueOnce([{ id: submissionId, studentId }]);
    txClient.grade.findUnique.mockResolvedValue(null);
    txClient.grade.create.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: now,
      updatedAt: now,
    }));

    const res = await service.gradeSubmission(actorId, submissionId, {
      score: 0,
      feedback: 'No work attached',
    });

    expect(pointsLedger.credit).not.toHaveBeenCalled();
    expect(res.pointsAwarded).toBe(0);
    expect(res.pointTransactionId).toBeNull();
    expect(txClient.gradeRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 1,
        score: 0,
        pointsDelta: 0,
        pointTransactionId: null,
      }),
    });
    expect(notifications.record).toHaveBeenCalledWith(txClient, {
      kind: 'grade_posted',
      classroomId,
      resourceId: res.id,
      recipientId: studentId,
      studentId,
    });
  });

  it('skips PointsLedgerService on PATCH when delta === 0 while incrementing version and preserving initial pointTransactionId', async () => {
    txClient.$queryRaw
      .mockResolvedValueOnce([
        {
          id: activityId,
          type: ActivityType.TP,
          format: ActivityFormat.FILE,
          title: 'TP 1',
          weightMultiplier: new Prisma.Decimal('1.00'),
        },
      ])
      .mockResolvedValueOnce([{ id: submissionId, studentId }])
      .mockResolvedValueOnce([
        {
          id: gradeId,
          submissionId,
          graderId: actorId,
          score: 80,
          feedback: 'Initial',
          pointsAwarded: 80,
          typeWeight: new Prisma.Decimal('1.00'),
          weightMultiplier: new Prisma.Decimal('1.00'),
          pointTransactionId: txId1,
          version: 1,
          gradedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    txClient.grade.update.mockImplementation(async ({ data }) => ({
      id: gradeId,
      submissionId,
      ...data,
      createdAt: now,
      updatedAt: now,
    }));

    const res = await service.regradeSubmission(actorId, submissionId, {
      score: 80,
      feedback: 'Clarified feedback only',
      version: 1,
    });

    expect(pointsLedger.credit).not.toHaveBeenCalled();
    expect(pointsLedger.compensate).not.toHaveBeenCalled();
    expect(res.version).toBe(2);
    expect(res.pointTransactionId).toBe(txId1);
    expect(txClient.gradeRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gradeId,
        version: 2,
        pointsDelta: 0,
        pointTransactionId: null,
      }),
    });
  });

  it('returns the current grade without writes on an identical regrade, but still 409s on a stale version', async () => {
    const gradeRow = {
      id: gradeId,
      submissionId,
      graderId: actorId,
      score: 80,
      feedback: 'Same words',
      pointsAwarded: 80,
      typeWeight: new Prisma.Decimal('1.00'),
      weightMultiplier: new Prisma.Decimal('1.00'),
      pointTransactionId: txId1,
      version: 3,
      gradedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const lockRows = () =>
      txClient.$queryRaw
        .mockResolvedValueOnce([
          {
            id: activityId,
            type: ActivityType.TP,
            format: ActivityFormat.FILE,
            title: 'TP 1',
            maxScore: 100,
            weightMultiplier: new Prisma.Decimal('1.00'),
          },
        ])
        .mockResolvedValueOnce([{ id: submissionId, studentId }])
        .mockResolvedValueOnce([gradeRow]);

    lockRows();
    const res = await service.regradeSubmission(actorId, submissionId, {
      score: 80,
      feedback: 'Same words',
      version: 3,
    });

    expect(res).toMatchObject({ id: gradeId, version: 3, pointsAwarded: 80, score: 80 });
    expect(txClient.grade.update).not.toHaveBeenCalled();
    expect(txClient.gradeRevision.create).not.toHaveBeenCalled();
    expect(pointsLedger.credit).not.toHaveBeenCalled();
    expect(pointsLedger.compensate).not.toHaveBeenCalled();
    expect(notifications.record).not.toHaveBeenCalled();

    lockRows();
    await expect(
      service.regradeSubmission(actorId, submissionId, {
        score: 80,
        feedback: 'Same words',
        version: 2,
      }),
    ).rejects.toThrow(ConflictException);
    expect(txClient.grade.update).not.toHaveBeenCalled();
  });

  it('writes ledger reasons on the activity maxScore scale and truncates overlong ones', async () => {
    const activityRow = (title: string) => ({
      id: activityId,
      type: ActivityType.TP,
      format: ActivityFormat.FILE,
      title,
      maxScore: 50,
      weightMultiplier: new Prisma.Decimal('1.00'),
    });
    txClient.$queryRaw
      .mockResolvedValueOnce([activityRow('TP 1')])
      .mockResolvedValueOnce([{ id: submissionId, studentId }]);
    txClient.grade.findUnique.mockResolvedValue(null);
    txClient.grade.create.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: now,
      updatedAt: now,
    }));

    await service.gradeSubmission(actorId, submissionId, { score: 40, feedback: 'ok' });
    expect(pointsLedger.credit).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'Grade: TP 1 (40/50)' }),
      txClient,
    );

    const longTitle = 'T'.repeat(300);
    txClient.$queryRaw
      .mockResolvedValueOnce([activityRow(longTitle)])
      .mockResolvedValueOnce([{ id: submissionId, studentId }]);
    await service.gradeSubmission(actorId, submissionId, { score: 40, feedback: 'ok' });
    const longReason = pointsLedger.credit.mock.calls.at(-1)?.[0].reason as string;
    expect(longReason).toHaveLength(240);
    expect(longReason.startsWith('Grade: TTTT')).toBe(true);

    txClient.$queryRaw
      .mockResolvedValueOnce([activityRow('TP 1')])
      .mockResolvedValueOnce([{ id: submissionId, studentId }])
      .mockResolvedValueOnce([
        {
          id: gradeId,
          submissionId,
          graderId: actorId,
          score: 20,
          feedback: 'v1',
          pointsAwarded: 20,
          typeWeight: new Prisma.Decimal('1.00'),
          weightMultiplier: new Prisma.Decimal('1.00'),
          pointTransactionId: txId1,
          version: 1,
          gradedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    txClient.grade.update.mockImplementation(async ({ data }) => ({
      id: gradeId,
      submissionId,
      ...data,
      createdAt: now,
      updatedAt: now,
    }));
    await service.regradeSubmission(actorId, submissionId, {
      score: 45,
      feedback: 'better',
      version: 1,
    });
    expect(pointsLedger.compensate).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'Regrade v2: TP 1 (45/50)' }),
      txClient,
    );
  });

  it('calls credit (not compensate) when regrading from 0 points to positive points', async () => {
    txClient.$queryRaw
      .mockResolvedValueOnce([
        {
          id: activityId,
          type: ActivityType.EXAM,
          format: ActivityFormat.FILE,
          title: 'Midterm',
          weightMultiplier: new Prisma.Decimal('1.00'),
        },
      ])
      .mockResolvedValueOnce([{ id: submissionId, studentId }])
      .mockResolvedValueOnce([
        {
          id: gradeId,
          submissionId,
          graderId: actorId,
          score: 0,
          feedback: 'Missing',
          pointsAwarded: 0,
          typeWeight: new Prisma.Decimal('1.50'),
          weightMultiplier: new Prisma.Decimal('1.00'),
          pointTransactionId: null,
          version: 1,
          gradedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    txClient.grade.update.mockImplementation(async ({ data }) => ({
      id: gradeId,
      submissionId,
      ...data,
      createdAt: now,
      updatedAt: now,
    }));

    const res = await service.regradeSubmission(actorId, submissionId, {
      score: 50,
      feedback: 'Recovered work',
      version: 1,
    });

    expect(pointsLedger.credit).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 75,
        sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
        sourceId: gradeId,
      }),
      txClient,
    );
    expect(pointsLedger.compensate).not.toHaveBeenCalled();
    expect(res.pointTransactionId).toBe(txId1);
    expect(res.pointsAwarded).toBe(75);
  });

  it('does not report an unrelated unique violation as "already graded"', async () => {
    const unrelated = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { modelName: 'Grade', target: ['point_transaction_id'] },
    });
    prisma.$transaction.mockRejectedValueOnce(unrelated);

    const outcome = await service
      .gradeSubmission(actorId, submissionId, { score: 80, feedback: 'ok' })
      .catch((error: unknown) => error);

    expect(outcome).toBe(unrelated);
    expect(outcome).not.toBeInstanceOf(ConflictException);
  });

  it('throws 409 on non-FILE activity, already graded submission, P2002 outside tx, and stale PATCH version', async () => {
    txClient.$queryRaw
      .mockResolvedValueOnce([
        {
          id: activityId,
          type: ActivityType.TP,
          format: ActivityFormat.MULTIPLE_CHOICE,
          title: 'Quiz',
          weightMultiplier: new Prisma.Decimal('1.00'),
        },
      ])
      .mockResolvedValueOnce([{ id: submissionId, studentId }]);

    await expect(
      service.gradeSubmission(actorId, submissionId, { score: 80, feedback: 'ok' }),
    ).rejects.toThrow(ConflictException);

    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { modelName: 'Grade', target: ['submission_id'] },
      }),
    );
    await expect(
      service.gradeSubmission(actorId, submissionId, { score: 80, feedback: 'ok' }),
    ).rejects.toThrow(ConflictException);

    txClient.$queryRaw
      .mockResolvedValueOnce([
        {
          id: activityId,
          type: ActivityType.TP,
          format: ActivityFormat.FILE,
          title: 'TP',
          weightMultiplier: new Prisma.Decimal('1.00'),
        },
      ])
      .mockResolvedValueOnce([{ id: submissionId, studentId }])
      .mockResolvedValueOnce([
        {
          id: gradeId,
          submissionId,
          graderId: actorId,
          score: 80,
          feedback: 'v1',
          pointsAwarded: 80,
          typeWeight: new Prisma.Decimal('1.00'),
          weightMultiplier: new Prisma.Decimal('1.00'),
          pointTransactionId: txId1,
          version: 2,
          gradedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ]);

    await expect(
      service.regradeSubmission(actorId, submissionId, {
        score: 90,
        feedback: 'stale',
        version: 1,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('enforces #26 access isolation for unlinked parents (404) and classmate students (403) without leaking', async () => {
    access.verifyClassroomAccess.mockResolvedValueOnce({
      myRole: 'PARENT',
      classroom: { adultMode: false },
      linkedChildIds: [otherStudentId],
    });
    await expect(
      service.gradeSubmission(actorId, submissionId, { score: 50, feedback: 'ok' }),
    ).rejects.toThrow(NotFoundException);

    prisma.submission.findFirst.mockResolvedValueOnce({
      id: submissionId,
      activityId,
      studentId,
      activity: { classroomId },
      grade: null,
    });
    access.verifyClassroomAccess.mockResolvedValueOnce({
      myRole: 'STUDENT',
      classroom: { adultMode: false },
    });
    await expect(service.getGrade(otherStudentId, submissionId)).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('Grades controllers (unit adapter delegation)', () => {
  const serviceStub = {
    gradeSubmission: vi.fn(),
    regradeSubmission: vi.fn(),
    getGrade: vi.fn(),
    listGradingQueue: vi.fn(),
  };
  const gradesController = new SubmissionGradesController(serviceStub as unknown as GradesService);
  const queueController = new ClassroomSubmissionsController(
    serviceStub as unknown as GradesService,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates controller methods with authenticated actorId and validated inputs', async () => {
    const gradeDto = {
      id: gradeId,
      submissionId,
      activityId,
      studentId,
      graderId: actorId,
      score: 90,
      feedback: 'Solid work',
      pointsAwarded: 90,
      pointTransactionId: txId1,
      version: 1,
      gradedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    serviceStub.gradeSubmission.mockResolvedValueOnce(gradeDto);
    serviceStub.regradeSubmission.mockResolvedValueOnce({ ...gradeDto, version: 2 });
    serviceStub.getGrade.mockResolvedValueOnce(gradeDto);
    serviceStub.listGradingQueue.mockResolvedValueOnce({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });

    await expect(
      gradesController.grade(actorId, submissionId, { score: 90, feedback: 'Solid work' }),
    ).resolves.toEqual(gradeDto);
    expect(serviceStub.gradeSubmission).toHaveBeenCalledWith(actorId, submissionId, {
      score: 90,
      feedback: 'Solid work',
    });

    await expect(
      gradesController.regrade(actorId, submissionId, {
        score: 90,
        feedback: 'Solid work',
        version: 1,
      }),
    ).resolves.toMatchObject({ version: 2 });
    expect(serviceStub.regradeSubmission).toHaveBeenCalledWith(actorId, submissionId, {
      score: 90,
      feedback: 'Solid work',
      version: 1,
    });

    await expect(gradesController.getGrade(actorId, submissionId)).resolves.toEqual(gradeDto);
    expect(serviceStub.getGrade).toHaveBeenCalledWith(actorId, submissionId);

    const queueQuery = { page: 1, pageSize: 20 } as ListGradingQueueQueryDto;
    await expect(queueController.list(actorId, classroomId, queueQuery)).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    expect(serviceStub.listGradingQueue).toHaveBeenCalledWith(actorId, classroomId, queueQuery);
  });
});
