import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ClassroomRole, MembershipState, RegistrationPath } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { PrismaService } from '../prisma/prisma.service';
import { utcDayOf } from './utc-day';
import { MetricRecordingService } from './metric-recording.service';
import { MetricsModule } from './metrics.module';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    classroom: randomUUID(),
  };
}

describe('MetricRecordingService (real PostgreSQL)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let recorder: MetricRecordingService;
  let ids: ReturnType<typeof makeIds>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), MetricsModule],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    recorder = module.get(MetricRecordingService);
  }, 20_000);

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    ids = makeIds();
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [ids.teacher, ids.student].map((id) => ({
          id,
          email: `metrics-int-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: 'Synthetic User',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.create({
        data: { id: ids.classroom, independentTeacherId: ids.teacher, name: 'Metrics Classroom' },
      });
      await tx.classroomMembership.create({
        data: {
          classroomId: ids.classroom,
          userId: ids.student,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
      });
    });
  });

  it('creates the UTC-day row of the submission instant and counts raw submissions', async () => {
    const at = new Date('2026-11-17T23:30:00.000Z');
    await recorder.recordSubmission(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at,
    });
    await recorder.recordSubmission(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at,
    });

    const rows = await prisma.activityMetric.findMany({
      where: { classroomId: ids.classroom, userId: ids.student },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      classroomId: ids.classroom,
      userId: ids.student,
      day: utcDayOf(at),
      submissionCount: 2,
      messageCount: 0,
    });
  });

  it('keeps one row per UTC day, never per instant', async () => {
    await recorder.recordSubmission(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at: new Date('2026-11-17T10:00:00.000Z'),
    });
    await recorder.recordSubmission(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at: new Date('2026-11-17T10:00:05.000Z'),
    });
    await recorder.recordSubmission(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at: new Date('2026-11-18T00:00:01.000Z'),
    });

    const rows = await prisma.activityMetric.findMany({
      where: { classroomId: ids.classroom, userId: ids.student },
      orderBy: { day: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ submissionCount: 2 });
    expect(rows[1]).toMatchObject({ submissionCount: 1 });
  });

  it('records message participation as its own counter (chat wires it later)', async () => {
    await recorder.recordMessage(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at: new Date('2026-11-17T10:00:00.000Z'),
    });
    await recorder.recordSubmission(prisma, {
      classroomId: ids.classroom,
      userId: ids.student,
      at: new Date('2026-11-17T10:01:00.000Z'),
    });

    const row = await prisma.activityMetric.findFirstOrThrow({
      where: { classroomId: ids.classroom, userId: ids.student },
    });
    expect(row).toMatchObject({ submissionCount: 1, messageCount: 1 });
  });

  it('increments inside the caller transaction without overwriting concurrent reports', async () => {
    const at = new Date('2026-11-17T12:00:00.000Z');
    // Two transactions racing to create the same row: exactly one winner, the loser adds to it.
    const first = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await recorder.recordSubmission(tx, { classroomId: ids.classroom, userId: ids.student, at });
    });
    const second = prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await recorder.recordSubmission(tx, { classroomId: ids.classroom, userId: ids.student, at });
    });
    await Promise.all([first, second]);

    const row = await prisma.activityMetric.findFirstOrThrow({
      where: { classroomId: ids.classroom, userId: ids.student },
    });
    expect(row.submissionCount).toBe(2);
  });
});
