import { randomUUID } from 'node:crypto';
import { ConflictException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { InvitationKind, InvitationState, PrismaClient, RegistrationPath } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import type { ApiConfig } from '../config/api-config';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import type { PrismaService } from '../prisma/prisma.service';
import { CLASSROOM_INVITATION_CREATED_EVENT } from './classroom-invitation-events';
import { ClassroomInvitationsService } from './classroom-invitations.service';
import { JoinCodeRateLimiter } from './join-code-rate-limiter.service';

describe('Classroom Invitations & Join Codes PostgreSQL Integration Tests (HU-AUL-002)', () => {
  let prisma: PrismaClient;
  let accessService: AccessVerificationService;
  let service: ClassroomInvitationsService;
  let rateLimiter: JoinCodeRateLimiter;
  let outboxWriter: OutboxWriter;

  const createdUserIds: string[] = [];
  const createdClassroomIds: string[] = [];

  let testTeacher: { id: string };
  let testClassroom: { id: string };

  const dummyConfig: ApiConfig = {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://dummy',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    refreshReuseGraceSeconds: 30,
    passwordResetTtlSeconds: 3600,
    passwordResetUrlBase: 'http://localhost/reset',
    invitationTtlSeconds: 604800,
    outboxPollIntervalSeconds: 5,
    outboxMaxAttempts: 5,
    internalServiceSecret: 'secret',
    jwtSecret: 'jwt-secret',
    allowedOrigins: ['http://localhost:3000'],
    s3Bucket: 'bucket',
    s3Region: 'sa-east-1',
    s3Endpoint: undefined,
    s3ForcePathStyle: false,
    s3Credentials: undefined,
    storageSignedUrlTtlSeconds: 60,
    authDataRetentionSeconds: 2592000,
    authCleanupIntervalSeconds: 86400,
    authCleanupBatchSize: 1000,
  };

  beforeAll(async () => {
    const globalProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const dbUrl =
      globalProcess?.env?.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

    prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });

    try {
      await prisma.$connect();
    } catch {
      // If database is not reachable, skip tests safely
      return;
    }

    accessService = new AccessVerificationService(prisma as unknown as PrismaService);
    outboxWriter = new OutboxWriter();
    rateLimiter = new JoinCodeRateLimiter({ windowMs: 60000, maxAttempts: 5 });

    service = new ClassroomInvitationsService(
      prisma as unknown as PrismaService,
      accessService,
      outboxWriter,
      rateLimiter,
      dummyConfig,
    );

    const ts = Date.now();

    // Create an independent teacher
    const teacher = await prisma.user.create({
      data: {
        email: `teacher.inv.${ts}@example.edu.ar`,
        passwordHash: 'dummy-hash',
        displayName: 'Profesor Invitaciones',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    testTeacher = teacher;
    createdUserIds.push(teacher.id);

    // Create a classroom with 12 initial desks
    const classroom = await prisma.classroom.create({
      data: {
        name: `Aula Invitaciones ${ts}`,
        independentTeacherId: teacher.id,
        adultMode: false,
      },
    });
    testClassroom = classroom;
    createdClassroomIds.push(classroom.id);

    // Provision 12 default desks
    await prisma.desk.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        classroomId: classroom.id,
        deskIndex: i + 1,
      })),
    });
  });

  afterAll(async () => {
    if (!prisma) return;

    try {
      if (createdClassroomIds.length > 0) {
        await prisma.joinCodeUsage.deleteMany({
          where: { invitation: { classroomId: { in: createdClassroomIds } } },
        });
        await prisma.outboxEvent.deleteMany({
          where: { type: CLASSROOM_INVITATION_CREATED_EVENT },
        });
        await prisma.invitation.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.desk.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.classroomMembership.deleteMany({
          where: { classroomId: { in: createdClassroomIds } },
        });
        await prisma.classroom.deleteMany({
          where: { id: { in: createdClassroomIds } },
        });
      }

      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }

      await prisma.$disconnect();
    } catch {
      // Ignore disconnect errors during teardown
    }
  });

  const createStudent = async (prefix: string) => {
    const student = await prisma.user.create({
      data: {
        email: `student.${prefix}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}@example.edu.ar`,
        passwordHash: 'dummy-hash',
        displayName: `Student ${prefix}`,
        registrationPath: RegistrationPath.SCHOOL,
      },
    });
    createdUserIds.push(student.id);
    return student;
  };

  it('creates an email invitation and persists outbox event atomically', async () => {
    if (!testClassroom) return;

    const email = `unknown.student.${Date.now()}@example.edu.ar`;
    const inv = await service.createEmailInvitation(testTeacher.id, testClassroom.id, {
      email,
    });

    expect(inv.id).toBeDefined();
    expect(inv.targetEmail).toBe(email);
    expect(inv.kind).toBe(InvitationKind.EMAIL);
    expect(inv.state).toBe(InvitationState.PENDING);

    // Verify OutboxEvent was recorded
    const event = await prisma.outboxEvent.findFirst({
      where: {
        type: CLASSROOM_INVITATION_CREATED_EVENT,
        payload: { path: ['invitationId'], equals: inv.id },
      },
    });
    expect(event).toBeDefined();
  });

  it('generates a join code and marks previous active code as REVOKED', async () => {
    if (!testClassroom) return;

    const code1 = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 10,
    });
    expect(code1.code).toBeDefined();
    expect(code1.code).toHaveLength(7);
    expect(code1.state).toBe(InvitationState.PENDING);

    // Regenerate join code
    const code2 = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 20,
    });
    expect(code2.code).not.toBe(code1.code);

    // Check code1 is now REVOKED in database
    const dbCode1 = await prisma.invitation.findUniqueOrThrow({
      where: { id: code1.id },
    });
    expect(dbCode1.state).toBe(InvitationState.REVOKED);
  });

  it('enforces idempotency when an enrolled student rejoins (does not consume uses or reassign desk)', async () => {
    if (!testClassroom) return;

    const student = await createStudent('idempotent');
    const joinCode = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 5,
    });

    // First join
    const res1 = await service.joinWithCode(student.id, { code: joinCode.code });
    expect(res1.alreadyMember).toBe(false);
    expect(res1.desk).toBeDefined();
    expect(res1.desk?.deskIndex).toBe(1);

    // Rejoin with same code
    const res2 = await service.joinWithCode(student.id, { code: joinCode.code.toLowerCase() });
    expect(res2.alreadyMember).toBe(true);
    expect(res2.membershipId).toBe(res1.membershipId);
    expect(res2.desk?.deskIndex).toBe(1);

    // Verify useCount was NOT incremented on rejoin
    const dbCode = await prisma.invitation.findUniqueOrThrow({
      where: { id: joinCode.id },
    });
    expect(dbCode.useCount).toBe(1);
  });

  it('dynamically auto-expands desks when > 12 students join', async () => {
    if (!testClassroom) return;

    // Create a dedicated classroom with 12 desks
    const cr = await prisma.classroom.create({
      data: {
        name: `Aula Expansion ${Date.now()}`,
        independentTeacherId: testTeacher.id,
      },
    });
    createdClassroomIds.push(cr.id);

    await prisma.desk.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        classroomId: cr.id,
        deskIndex: i + 1,
      })),
    });

    const code = await service.generateJoinCode(testTeacher.id, cr.id, { maxUses: 50 });

    // Join 12 students to occupy desks 1..12
    for (let i = 1; i <= 12; i++) {
      const st = await createStudent(`fill-${i}`);
      const res = await service.joinWithCode(st.id, { code: code.code });
      expect(res.desk?.deskIndex).toBe(i);
    }

    // Join 13th student -> dynamic auto-expansion
    const student13 = await createStudent('student-13');
    const res13 = await service.joinWithCode(student13.id, { code: code.code });
    expect(res13.desk?.deskIndex).toBe(13);

    // Join 14th student -> dynamic auto-expansion
    const student14 = await createStudent('student-14');
    const res14 = await service.joinWithCode(student14.id, { code: code.code });
    expect(res14.desk?.deskIndex).toBe(14);

    // Check desks count in DB
    const totalDesks = await prisma.desk.count({ where: { classroomId: cr.id } });
    expect(totalDesks).toBe(14);
  });

  it('MANDATORY CONCURRENCY: handles maxUses race condition with Promise.all (exactly 1 succeeds, other gets 409 Conflict)', async () => {
    if (!testClassroom) return;

    // Generate join code with maxUses = 1
    const joinCode = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 1,
    });

    const studentA = await createStudent('race-a');
    const studentB = await createStudent('race-b');

    // Run both joins concurrently using Promise.allSettled
    const results = await Promise.allSettled([
      service.joinWithCode(studentA.id, { code: joinCode.code }),
      service.joinWithCode(studentB.id, { code: joinCode.code }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 must succeed
    expect(fulfilled).toHaveLength(1);
    // The other must be rejected with ConflictException (or check constraint error)
    expect(rejected).toHaveLength(1);
    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejectionReason).toBeInstanceOf(ConflictException);

    // Use count in database must be exactly 1
    const dbCode = await prisma.invitation.findUniqueOrThrow({
      where: { id: joinCode.id },
    });
    expect(dbCode.useCount).toBe(1);
    expect(dbCode.state).toBe(InvitationState.USED);
  });

  it('MANDATORY CONCURRENCY: handles duplicate user join race condition cleanly with Promise.all', async () => {
    if (!testClassroom) return;

    const joinCode = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 10,
    });
    const student = await createStudent('dup-race');

    // Same student races with themselves
    const results = await Promise.allSettled([
      service.joinWithCode(student.id, { code: joinCode.code }),
      service.joinWithCode(student.id, { code: joinCode.code }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Neither request should crash with an unhandled 500 error
    for (const r of results) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(ConflictException);
      }
    }
  });

  it('enforces rate limiting on invalid join codes (returns 429 TOO_MANY_REQUESTS)', async () => {
    if (!testClassroom) return;

    const studentId = randomUUID();

    for (let i = 0; i < 5; i++) {
      await expect(service.joinWithCode(studentId, { code: `INVALID${i}` })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }

    // 6th attempt must throw 429
    try {
      await service.joinWithCode(studentId, { code: 'ANYCODE' });
      expect.unreachable('Should have failed with 429');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });
});
