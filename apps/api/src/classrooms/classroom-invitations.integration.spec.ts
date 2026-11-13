import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  InvitationKind,
  InvitationRole,
  InvitationState,
  MembershipState,
  PrismaClient,
  RegistrationPath,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import type { ApiConfig } from '../config/api-config';
import { InMemoryEmailAdapter } from '../platform/email/in-memory-email.adapter';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import type { PrismaService } from '../prisma/prisma.service';
import { CLASSROOM_INVITATION_CREATED_EVENT } from './classroom-invitation-events';
import { ClassroomInvitationCreatedHandler } from './classroom-invitation-created.handler';
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
    realtimeInternalUrl: 'http://localhost:2567',
    internalServiceSecret: 'secret',
    jwtSecret: 'jwt-secret',
    invitationTokenKey: randomBytes(32),
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
    await prisma.$connect();

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

  /** A classroom of its own, so desk indexes in a test never depend on other tests. */
  const createClassroom = async (prefix: string, deskCount = 12) => {
    const classroom = await prisma.classroom.create({
      data: {
        name: `Aula ${prefix} ${Date.now()}`,
        independentTeacherId: testTeacher.id,
        adultMode: false,
      },
    });
    createdClassroomIds.push(classroom.id);
    await prisma.desk.createMany({
      data: Array.from({ length: deskCount }, (_, i) => ({
        classroomId: classroom.id,
        deskIndex: i + 1,
      })),
    });
    return classroom;
  };

  it('creates an email invitation and persists outbox event atomically', async () => {
    const email = `unknown.student.${Date.now()}@example.edu.ar`;
    const inv = await service.createEmailInvitation(testTeacher.id, testClassroom.id, {
      email,
    });

    expect(inv.id).toBeDefined();
    expect(inv.token).toBeDefined();
    expect(typeof inv.token).toBe('string');
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

  it('never persists the raw invitation token and still delivers a working email', async () => {
    // Dedicated classroom so accepting the invitation does not consume a shared desk.
    const classroom = await prisma.classroom.create({
      data: {
        name: `Aula Token ${Date.now()}`,
        independentTeacherId: testTeacher.id,
        adultMode: false,
      },
    });
    createdClassroomIds.push(classroom.id);
    await prisma.desk.createMany({
      data: Array.from({ length: 2 }, (_, i) => ({ classroomId: classroom.id, deskIndex: i + 1 })),
    });

    const email = `no.plaintext.${Date.now()}@example.edu.ar`;
    const inv = await service.createEmailInvitation(testTeacher.id, classroom.id, { email });

    // No persisted row may contain the raw token: outbox payloads and invitation rows.
    const events = await prisma.$queryRaw<{ payload: string }[]>`
      SELECT payload::text AS payload FROM outbox_events`;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.payload).not.toContain(inv.token);
    }
    const invitationRows = await prisma.$queryRaw<{ row: string }[]>`
      SELECT to_jsonb(i)::text AS row FROM invitations i WHERE i.id = ${inv.id}::uuid`;
    expect(invitationRows[0].row).not.toContain(inv.token);

    // The outbox handler decrypts at delivery time and mails the working token.
    const stored = await prisma.outboxEvent.findFirstOrThrow({
      where: {
        type: CLASSROOM_INVITATION_CREATED_EVENT,
        payload: { path: ['invitationId'], equals: inv.id },
      },
    });
    const emailAdapter = new InMemoryEmailAdapter();
    const handler = new ClassroomInvitationCreatedHandler(
      prisma as unknown as PrismaService,
      new OutboxHandlerRegistry(),
      emailAdapter,
      dummyConfig,
    );
    await handler.handle({
      id: stored.id,
      type: stored.type,
      payload: stored.payload as never,
      occurredAt: stored.occurredAt,
    });

    expect(emailAdapter.sent).toHaveLength(1);
    expect(emailAdapter.sent[0].to).toBe(email);
    expect(emailAdapter.sent[0].text).toContain(inv.token);

    const student = await createStudent('mailed-token');
    const accepted = await service.acceptEmailInvitation(student.id, { token: inv.token });
    expect(accepted.alreadyMember).toBe(false);
  });

  it('rejects a TEACHER invitation without persisting an invitation or outbox event', async () => {
    const email = `colleague.${Date.now()}@example.edu.ar`;
    await expect(
      service.createEmailInvitation(testTeacher.id, testClassroom.id, {
        email,
        role: InvitationRole.TEACHER,
      }),
    ).rejects.toThrow(
      new BadRequestException('Classroom invitations can only be issued for students'),
    );
    expect(await prisma.invitation.count({ where: { targetEmail: email } })).toBe(0);
  });

  it('generates a join code and marks previous active code as REVOKED', async () => {
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

  it('keeps join-code retries idempotent after the code reaches maxUses', async () => {
    const classroom = await createClassroom('exhausted-retry');
    const student = await createStudent('exhausted-retry');
    const stranger = await createStudent('exhausted-stranger');
    const joinCode = await service.generateJoinCode(testTeacher.id, classroom.id, { maxUses: 1 });

    const first = await service.joinWithCode(student.id, { code: joinCode.code });
    expect(first.alreadyMember).toBe(false);
    const exhausted = await prisma.invitation.findUniqueOrThrow({ where: { id: joinCode.id } });
    expect(exhausted.state).toBe(InvitationState.USED);
    expect(exhausted.useCount).toBe(1);

    // The response was lost: the same student retries with the now-exhausted code.
    const retry = await service.joinWithCode(student.id, { code: joinCode.code });
    expect(retry.alreadyMember).toBe(true);
    expect(retry.membershipId).toBe(first.membershipId);
    expect(retry.desk).toEqual(first.desk);
    const after = await prisma.invitation.findUniqueOrThrow({ where: { id: joinCode.id } });
    expect(after.useCount).toBe(1);
    expect(await prisma.classroomMembership.count({ where: { classroomId: classroom.id } })).toBe(
      1,
    );

    // A different user is still rejected and does not enroll.
    await expect(service.joinWithCode(stranger.id, { code: joinCode.code })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(
      await prisma.classroomMembership.count({
        where: { classroomId: classroom.id, userId: stranger.id },
      }),
    ).toBe(0);
  });

  it('does not let a removed student rejoin through an exhausted join code', async () => {
    const classroom = await createClassroom('exhausted-removed');
    const student = await createStudent('exhausted-removed');
    const joinCode = await service.generateJoinCode(testTeacher.id, classroom.id, { maxUses: 1 });
    const first = await service.joinWithCode(student.id, { code: joinCode.code });
    await prisma.classroomMembership.update({
      where: { id: first.membershipId },
      data: { state: MembershipState.INACTIVE },
    });

    await expect(service.joinWithCode(student.id, { code: joinCode.code })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const membership = await prisma.classroomMembership.findUniqueOrThrow({
      where: { id: first.membershipId },
    });
    expect(membership.state).toBe(MembershipState.INACTIVE);
  });

  it('keeps hiding a deleted classroom from an enrolled student retrying an exhausted code', async () => {
    const classroom = await createClassroom('exhausted-deleted');
    const student = await createStudent('exhausted-deleted');
    const joinCode = await service.generateJoinCode(testTeacher.id, classroom.id, { maxUses: 1 });
    await service.joinWithCode(student.id, { code: joinCode.code });
    await prisma.classroom.update({ where: { id: classroom.id }, data: { deletedAt: new Date() } });

    await expect(service.joinWithCode(student.id, { code: joinCode.code })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps email-invitation acceptance idempotent after the invitation is used', async () => {
    const classroom = await createClassroom('email-retry');
    const student = await createStudent('email-retry');
    const stranger = await createStudent('email-stranger');
    const inv = await service.createEmailInvitation(testTeacher.id, classroom.id, {
      email: `email.retry.${Date.now()}@example.edu.ar`,
    });

    const first = await service.acceptEmailInvitation(student.id, { token: inv.token });
    expect(first.alreadyMember).toBe(false);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).state).toBe(
      InvitationState.USED,
    );

    const retry = await service.acceptEmailInvitation(student.id, { token: inv.token });
    expect(retry.alreadyMember).toBe(true);
    expect(retry.membershipId).toBe(first.membershipId);
    expect(retry.desk).toEqual(first.desk);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).useCount).toBe(1);

    await expect(
      service.acceptEmailInvitation(stranger.id, { token: inv.token }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      await prisma.classroomMembership.count({
        where: { classroomId: classroom.id, userId: stranger.id },
      }),
    ).toBe(0);
  });

  describe('revocation versus acceptance', () => {
    const enrollmentCount = (classroomId: string, userId: string) =>
      prisma.classroomMembership.count({ where: { classroomId, userId } });
    const deskCount = (classroomId: string, membershipUserId: string) =>
      prisma.desk.count({
        where: { classroomId, membership: { userId: membershipUserId } },
      });

    it('keeps USED when acceptance wins and rejects the later revocation', async () => {
      const classroom = await createClassroom('accept-first');
      const student = await createStudent('accept-first');
      const inv = await service.createEmailInvitation(testTeacher.id, classroom.id, {
        email: `accept.first.${Date.now()}@example.edu.ar`,
      });

      await service.acceptEmailInvitation(student.id, { token: inv.token });
      await expect(
        service.revokeInvitation(testTeacher.id, classroom.id, inv.id),
      ).rejects.toBeInstanceOf(BadRequestException);

      const row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
      expect(row.state).toBe(InvitationState.USED);
      expect(await enrollmentCount(classroom.id, student.id)).toBe(1);
      expect(await deskCount(classroom.id, student.id)).toBe(1);
    });

    it('rejects acceptance without membership or desk when revocation wins', async () => {
      const classroom = await createClassroom('revoke-first');
      const student = await createStudent('revoke-first');
      const inv = await service.createEmailInvitation(testTeacher.id, classroom.id, {
        email: `revoke.first.${Date.now()}@example.edu.ar`,
      });

      const revoked = await service.revokeInvitation(testTeacher.id, classroom.id, inv.id);
      expect(revoked.state).toBe(InvitationState.REVOKED);
      await expect(
        service.acceptEmailInvitation(student.id, { token: inv.token }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect((await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } })).state).toBe(
        InvitationState.REVOKED,
      );
      expect(await enrollmentCount(classroom.id, student.id)).toBe(0);
      expect(
        await prisma.desk.count({
          where: { classroomId: classroom.id, membershipId: { not: null } },
        }),
      ).toBe(0);
    });

    it('keeps the audit state consistent when acceptance and revocation race', async () => {
      const classroom = await createClassroom('race');
      for (let round = 0; round < 8; round++) {
        const student = await createStudent(`race-${round}`);
        const inv = await service.createEmailInvitation(testTeacher.id, classroom.id, {
          email: `race.${round}.${Date.now()}@example.edu.ar`,
        });

        const [accepted, revoked] = await Promise.allSettled([
          service.acceptEmailInvitation(student.id, { token: inv.token }),
          service.revokeInvitation(testTeacher.id, classroom.id, inv.id),
        ]);

        // Exactly one operation wins.
        expect([accepted.status, revoked.status].sort()).toEqual(['fulfilled', 'rejected']);

        const row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.id } });
        const enrolled = await enrollmentCount(classroom.id, student.id);
        const desks = await deskCount(classroom.id, student.id);
        if (accepted.status === 'fulfilled') {
          expect(row.state).toBe(InvitationState.USED);
          expect(enrolled).toBe(1);
          expect(desks).toBe(1);
        } else {
          expect(row.state).toBe(InvitationState.REVOKED);
          expect(enrolled).toBe(0);
          expect(desks).toBe(0);
        }
      }
    });

    it('does not revoke a join code that was just exhausted (stays USED)', async () => {
      const classroom = await createClassroom('code-revoke');
      const student = await createStudent('code-revoke');
      const joinCode = await service.generateJoinCode(testTeacher.id, classroom.id, {
        maxUses: 1,
      });
      await service.joinWithCode(student.id, { code: joinCode.code });

      await expect(service.revokeJoinCode(testTeacher.id, classroom.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id: joinCode.id } })).state,
      ).toBe(InvitationState.USED);
    });
  });

  it('reactivates inactive or soft-deleted membership without duplicate or crash (CRIT-05)', async () => {
    const student = await createStudent('reactivate');
    const joinCode = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 5,
    });

    // Initial join
    const res1 = await service.joinWithCode(student.id, { code: joinCode.code });
    expect(res1.alreadyMember).toBe(false);

    // Soft-delete the membership
    await prisma.classroomMembership.update({
      where: { id: res1.membershipId },
      data: { deletedAt: new Date() },
    });

    // Re-join with code: must reactivate and NOT crash with P2002
    const res2 = await service.joinWithCode(student.id, { code: joinCode.code });
    expect(res2.alreadyMember).toBe(false);
    expect(res2.membershipId).toBe(res1.membershipId);

    const activeInDb = await prisma.classroomMembership.findUniqueOrThrow({
      where: { id: res1.membershipId },
    });
    expect(activeInDb.deletedAt).toBeNull();
  });

  it('rejects classroom staff from joining with code (WARN-05)', async () => {
    const joinCode = await service.generateJoinCode(testTeacher.id, testClassroom.id, {
      maxUses: 5,
    });

    await expect(service.joinWithCode(testTeacher.id, { code: joinCode.code })).rejects.toThrow(
      new ConflictException('Classroom staff cannot join as a student'),
    );
  });

  it('dynamically auto-expands desks when > 12 students join', async () => {
    // Policy (rules/classrooms-and-roles.md, Desk allocation): there is always one assignable desk
    // per enrolled student, so the 13th student gets a new desk with index 13 (indexes are 1-based).
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

  it('MANDATORY CONCURRENCY: handles concurrent desk allocation cleanly with Promise.all without clobbering (CRIT-01)', async () => {
    // Dedicated classroom with only 1 desk available
    const cr = await prisma.classroom.create({
      data: {
        name: `Aula Concurrency Desk ${Date.now()}`,
        independentTeacherId: testTeacher.id,
      },
    });
    createdClassroomIds.push(cr.id);

    await prisma.desk.create({
      data: {
        classroomId: cr.id,
        deskIndex: 1,
      },
    });

    const joinCode = await service.generateJoinCode(testTeacher.id, cr.id, { maxUses: 10 });
    const student1 = await createStudent('desk-race-1');
    const student2 = await createStudent('desk-race-2');

    // Both join concurrently when only 1 desk is unassigned
    const [res1, res2] = await Promise.all([
      service.joinWithCode(student1.id, { code: joinCode.code }),
      service.joinWithCode(student2.id, { code: joinCode.code }),
    ]);

    expect(res1.desk).toBeDefined();
    expect(res2.desk).toBeDefined();
    // One got desk 1, the other auto-expanded to desk 2 - NO desk clobbering!
    expect(res1.desk!.id).not.toBe(res2.desk!.id);
    expect(res1.desk!.deskIndex).not.toBe(res2.desk!.deskIndex);

    const totalDesks = await prisma.desk.count({ where: { classroomId: cr.id } });
    expect(totalDesks).toBe(2);
  });

  it('MANDATORY CONCURRENCY: handles maxUses race condition with Promise.all (exactly 1 succeeds, other gets 409 Conflict)', async () => {
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
