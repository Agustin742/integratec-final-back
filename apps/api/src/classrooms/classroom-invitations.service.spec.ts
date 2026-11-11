import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ClassroomRole,
  InvitationKind,
  InvitationRole,
  InvitationState,
  MembershipState,
  Prisma,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import type { ApiConfig } from '../config/api-config';
import { decryptSecret } from '../platform/crypto/secret-box';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { PrismaService } from '../prisma/prisma.service';
import { ClassroomInvitationsService } from './classroom-invitations.service';
import { JoinCodeRateLimiter } from './join-code-rate-limiter.service';

describe('ClassroomInvitationsService', () => {
  let service: ClassroomInvitationsService;
  let mockPrisma: {
    $transaction: ReturnType<typeof vi.fn>;
    invitation: Record<string, ReturnType<typeof vi.fn>>;
    classroomMembership: Record<string, ReturnType<typeof vi.fn>>;
    schoolMember: Record<string, ReturnType<typeof vi.fn>>;
    desk: Record<string, ReturnType<typeof vi.fn>>;
    joinCodeUsage: Record<string, ReturnType<typeof vi.fn>>;
  };
  let mockAccessService: {
    verifyClassroomAccess: ReturnType<typeof vi.fn>;
  };
  let mockOutbox: {
    record: ReturnType<typeof vi.fn>;
  };
  let rateLimiter: JoinCodeRateLimiter;

  const dummyConfig: ApiConfig = {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://dummy',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    refreshReuseGraceSeconds: 30,
    passwordResetTtlSeconds: 3600,
    passwordResetUrlBase: 'http://localhost/reset',
    invitationTtlSeconds: 604800, // 7 days
    outboxPollIntervalSeconds: 5,
    outboxMaxAttempts: 5,
    internalServiceSecret: 'secret',
    jwtSecret: 'jwt-secret',
    invitationTokenKey: Buffer.alloc(32, 7),
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

  const ACTOR_TEACHER_ID = randomUUID();
  const CLASSROOM_ID = randomUUID();
  const SCHOOL_ID = randomUUID();
  const STUDENT_ID = randomUUID();

  beforeEach(() => {
    rateLimiter = new JoinCodeRateLimiter({
      windowMs: 60000,
      maxAttempts: 5,
    });

    mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
      invitation: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      classroomMembership: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn().mockImplementation(async ({ data }) => ({ id: randomUUID(), ...data })),
      },
      schoolMember: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: randomUUID() }),
      },
      desk: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      joinCodeUsage: {
        create: vi.fn(),
        upsert: vi.fn(),
      },
    };

    mockAccessService = {
      verifyClassroomAccess: vi.fn().mockResolvedValue({
        classroom: {
          id: CLASSROOM_ID,
          schoolId: SCHOOL_ID,
          independentTeacherId: null,
          name: 'Ciencias Naturales',
          adultMode: false,
        },
        myRole: 'TEACHER',
        capabilities: ['invite_members', 'configure_classroom'],
      }),
    };

    mockOutbox = {
      record: vi.fn().mockResolvedValue('outbox-event-id'),
    };

    service = new ClassroomInvitationsService(
      mockPrisma as unknown as PrismaService,
      mockAccessService as unknown as AccessVerificationService,
      mockOutbox as unknown as OutboxWriter,
      rateLimiter,
      dummyConfig,
    );
  });

  describe('createEmailInvitation', () => {
    it('creates an email invitation and records an outbox event', async () => {
      const invitationId = randomUUID();
      const expiresAt = new Date(Date.now() + 604800000);

      mockPrisma.invitation.create.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.EMAIL,
        targetEmail: 'newstudent@example.edu.ar',
        role: InvitationRole.STUDENT,
        maxUses: 1,
        useCount: 0,
        state: InvitationState.PENDING,
        expiresAt,
        createdAt: new Date(),
      });

      const res = await service.createEmailInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, {
        email: 'NewStudent@Example.edu.ar',
      });

      expect(mockAccessService.verifyClassroomAccess).toHaveBeenCalledWith(
        ACTOR_TEACHER_ID,
        CLASSROOM_ID,
        { requiredRole: 'STAFF' },
      );
      expect(mockPrisma.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            kind: InvitationKind.EMAIL,
            targetEmail: 'newstudent@example.edu.ar',
            role: InvitationRole.STUDENT,
            classroomId: CLASSROOM_ID,
            maxUses: 1,
          }),
        }),
      );
      expect(mockOutbox.record).toHaveBeenCalledWith(
        mockPrisma,
        expect.objectContaining({
          type: 'classroom.invitation-created',
          payload: expect.objectContaining({
            invitationId,
            classroomId: CLASSROOM_ID,
            targetEmail: 'newstudent@example.edu.ar',
            encryptedToken: {
              iv: expect.any(String),
              authTag: expect.any(String),
              ciphertext: expect.any(String),
            },
          }),
        }),
      );
      const recorded = mockOutbox.record.mock.calls[0][1];
      expect(JSON.stringify(recorded)).not.toContain(res.token);
      expect(recorded.payload).not.toHaveProperty('token');
      expect(
        decryptSecret(recorded.payload.encryptedToken, Buffer.alloc(32, 7), invitationId),
      ).toBe(res.token);
      expect(res.id).toBe(invitationId);
      expect(res.targetEmail).toBe('newstudent@example.edu.ar');
      expect(res.token).toBeDefined();
      expect(typeof res.token).toBe('string');
    });

    it.each([InvitationRole.TEACHER, InvitationRole.OWNER, InvitationRole.ADMIN])(
      'rejects a %s invitation because only student invitations are supported',
      async (role) => {
        await expect(
          service.createEmailInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, {
            email: 'colleague@example.edu.ar',
            role,
          }),
        ).rejects.toThrow(
          new BadRequestException('Classroom invitations can only be issued for students'),
        );
        expect(mockPrisma.invitation.create).not.toHaveBeenCalled();
        expect(mockOutbox.record).not.toHaveBeenCalled();
      },
    );

    it('rejects unauthenticated callers with 401', async () => {
      await expect(
        service.createEmailInvitation('invalid-uuid', CLASSROOM_ID, {
          email: 'student@example.edu.ar',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects students or unauthorized members with 403 Forbidden', async () => {
      mockAccessService.verifyClassroomAccess.mockRejectedValueOnce(
        new ForbiddenException('Staff role required for this action'),
      );

      await expect(
        service.createEmailInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, {
          email: 'student@example.edu.ar',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listInvitations', () => {
    it('returns paginated email invitations filtered by status', async () => {
      const invitationId = randomUUID();
      mockPrisma.invitation.count.mockResolvedValue(1);
      mockPrisma.invitation.findMany.mockResolvedValue([
        {
          id: invitationId,
          kind: InvitationKind.EMAIL,
          targetEmail: 'student@example.edu.ar',
          role: InvitationRole.STUDENT,
          maxUses: 1,
          useCount: 0,
          state: InvitationState.PENDING,
          expiresAt: new Date(),
          createdAt: new Date(),
        },
      ]);

      const res = await service.listInvitations(ACTOR_TEACHER_ID, CLASSROOM_ID, {
        page: 1,
        pageSize: 20,
        status: InvitationState.PENDING,
      });

      expect(res.total).toBe(1);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].id).toBe(invitationId);
    });
  });

  describe('revokeInvitation', () => {
    it('revokes a pending email invitation with an atomic conditional update', async () => {
      const invitationId = randomUUID();
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.revokeInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, invitationId);

      expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith({
        where: {
          id: invitationId,
          classroomId: CLASSROOM_ID,
          kind: InvitationKind.EMAIL,
          state: InvitationState.PENDING,
        },
        data: { state: InvitationState.REVOKED },
      });
      expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
      expect(res).toEqual({ id: invitationId, state: InvitationState.REVOKED });
    });

    it('does not overwrite an invitation accepted after the caller looked at it (USED)', async () => {
      const invitationId = randomUUID();
      // The conditional update matches nothing because acceptance committed first.
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.invitation.findFirst.mockResolvedValue({
        id: invitationId,
        state: InvitationState.USED,
      });

      await expect(
        service.revokeInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, invitationId),
      ).rejects.toThrow(
        new BadRequestException('Invitation has already been used and cannot be revoked'),
      );
      expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
    });

    it.each([InvitationState.REVOKED, InvitationState.EXPIRED])(
      'throws BadRequestException when the invitation is %s (POL-02)',
      async (state) => {
        const invitationId = randomUUID();
        mockPrisma.invitation.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.invitation.findFirst.mockResolvedValue({ id: invitationId, state });

        await expect(
          service.revokeInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, invitationId),
        ).rejects.toThrow(new BadRequestException('Only pending invitations can be revoked'));
      },
    );

    it('throws 404 when invitation is not found', async () => {
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.invitation.findFirst.mockResolvedValue(null);

      await expect(
        service.revokeInvitation(ACTOR_TEACHER_ID, CLASSROOM_ID, randomUUID()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateJoinCode', () => {
    it('revokes previous active join code and generates a new one with raw code returned once', async () => {
      const newInvitationId = randomUUID();
      const expiresAt = new Date(Date.now() + 604800000);

      mockPrisma.invitation.create.mockResolvedValue({
        id: newInvitationId,
        kind: InvitationKind.JOIN_CODE,
        role: InvitationRole.STUDENT,
        maxUses: 30,
        useCount: 0,
        expiresAt,
        state: InvitationState.PENDING,
        createdAt: new Date(),
      });

      const res = await service.generateJoinCode(ACTOR_TEACHER_ID, CLASSROOM_ID, {
        maxUses: 30,
      });

      expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith({
        where: {
          classroomId: CLASSROOM_ID,
          kind: InvitationKind.JOIN_CODE,
          state: InvitationState.PENDING,
        },
        data: {
          state: InvitationState.REVOKED,
        },
      });

      expect(res.code).toBeDefined();
      expect(res.code).toHaveLength(7);
      expect(res.id).toBe(newInvitationId);
      expect(res.maxUses).toBe(30);
    });
  });

  describe('revokeJoinCode', () => {
    it('revokes the active join code with an atomic conditional update', async () => {
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.revokeJoinCode(ACTOR_TEACHER_ID, CLASSROOM_ID);

      expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith({
        where: {
          classroomId: CLASSROOM_ID,
          kind: InvitationKind.JOIN_CODE,
          state: InvitationState.PENDING,
        },
        data: { state: InvitationState.REVOKED },
      });
      expect(mockPrisma.invitation.update).not.toHaveBeenCalled();
      expect(res.success).toBe(true);
    });

    it('throws 404 if no active join code exists (including one that just became USED)', async () => {
      mockPrisma.invitation.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revokeJoinCode(ACTOR_TEACHER_ID, CLASSROOM_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('joinWithCode', () => {
    it('returns existing membership idempotently without consuming uses or reassigning desk', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 5,
        useCount: 2,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        desk: { id: deskId, deskIndex: 3 },
      });

      const res = await service.joinWithCode(STUDENT_ID, { code: `  ${rawCode.toLowerCase()}  ` });

      expect(res.alreadyMember).toBe(true);
      expect(res.membershipId).toBe(membershipId);
      expect(res.desk?.deskIndex).toBe(3);
      expect(mockPrisma.invitation.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.joinCodeUsage.create).not.toHaveBeenCalled();
    });

    it('allocates the lowest available desk on successful new join', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);

      mockPrisma.classroomMembership.create.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
      });

      mockPrisma.desk.findFirst.mockResolvedValueOnce({
        id: deskId,
        classroomId: CLASSROOM_ID,
        deskIndex: 1,
        membershipId: null,
      });

      mockPrisma.desk.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await service.joinWithCode(STUDENT_ID, { code: rawCode });

      expect(res.alreadyMember).toBe(false);
      expect(res.desk?.deskIndex).toBe(1);
      expect(mockPrisma.joinCodeUsage.create).toHaveBeenCalledWith({
        data: { invitationId, userId: STUDENT_ID },
      });
      expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: invitationId }),
          data: expect.objectContaining({ useCount: { increment: 1 } }),
        }),
      );
    });

    it('retries desk assignment when first available desk was claimed concurrently (CRIT-01)', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId1 = randomUUID();
      const deskId2 = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);
      mockPrisma.classroomMembership.create.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
      });

      // Attempt 1: desk 1 found, but claimed.count === 0 (lost race)
      // Attempt 2: desk 2 found, claimed.count === 1 (won race)
      mockPrisma.desk.findFirst
        .mockResolvedValueOnce({ id: deskId1, deskIndex: 1 })
        .mockResolvedValueOnce({ id: deskId2, deskIndex: 2 });

      mockPrisma.desk.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });

      const res = await service.joinWithCode(STUDENT_ID, { code: rawCode });

      expect(res.alreadyMember).toBe(false);
      expect(res.desk?.id).toBe(deskId2);
      expect(res.desk?.deskIndex).toBe(2);
    });

    it('dynamically provisions desk 13 when all 12 initial desks are occupied (desk auto-expansion)', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const newDeskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: null,
        useCount: 12,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);

      mockPrisma.classroomMembership.create.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
      });

      // No desk available (all occupied)
      mockPrisma.desk.findFirst
        .mockResolvedValueOnce(null) // for available desk
        .mockResolvedValueOnce({ deskIndex: 12 }); // for max desk index

      mockPrisma.desk.create.mockResolvedValue({
        id: newDeskId,
        deskIndex: 13,
      });

      const res = await service.joinWithCode(STUDENT_ID, { code: rawCode });

      expect(res.alreadyMember).toBe(false);
      expect(res.desk?.deskIndex).toBe(13);
      expect(mockPrisma.desk.create).toHaveBeenCalledWith({
        data: {
          classroomId: CLASSROOM_ID,
          membershipId,
          deskIndex: 13,
        },
        select: { id: true, deskIndex: true },
      });
    });

    it('reactivates inactive or soft-deleted membership without creating duplicate (CRIT-05)', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      // Existing inactive membership with deletedAt timestamp
      mockPrisma.classroomMembership.findUnique.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
        state: MembershipState.INACTIVE,
        deletedAt: new Date(),
        desk: { id: deskId, deskIndex: 5 },
      });

      mockPrisma.classroomMembership.update.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
      });

      const res = await service.joinWithCode(STUDENT_ID, { code: rawCode });

      expect(res.alreadyMember).toBe(false);
      expect(res.membershipId).toBe(membershipId);
      expect(res.desk?.deskIndex).toBe(5);
      expect(mockPrisma.classroomMembership.update).toHaveBeenCalledWith({
        where: { id: membershipId },
        data: {
          state: MembershipState.ACTIVE,
          deletedAt: null,
          role: ClassroomRole.STUDENT,
        },
      });
      expect(mockPrisma.joinCodeUsage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            invitationId_userId: {
              invitationId,
              userId: STUDENT_ID,
            },
          },
        }),
      );
      expect(mockPrisma.joinCodeUsage.create).not.toHaveBeenCalled();
      expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
    });

    it('returns alreadyMember: true when concurrent join triggers P2002 for the same newly active student', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      // First check before transaction returns null; second check in catch block returns active membership
      mockPrisma.classroomMembership.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        desk: { id: deskId, deskIndex: 1 },
      });

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      });
      mockPrisma.joinCodeUsage.create.mockRejectedValueOnce(p2002Error);

      const res = await service.joinWithCode(STUDENT_ID, { code: rawCode });

      expect(res).toEqual({
        classroomId: CLASSROOM_ID,
        membershipId,
        role: ClassroomRole.STUDENT,
        desk: { id: deskId, deskIndex: 1 },
        alreadyMember: true,
      });
    });

    it('rejects classroom staff from joining as students (WARN-05)', async () => {
      const rawCode = 'ABC1234';
      const staffUserId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: staffUserId, // Caller is the independent teacher
          schoolId: null,
          school: null,
        },
      });

      await expect(service.joinWithCode(staffUserId, { code: rawCode })).rejects.toThrow(
        new ConflictException('Classroom staff cannot join as a student'),
      );
    });

    it('rejects soft-deleted school with uniform 404 message (CRIT-04 / WARN-04)', async () => {
      const rawCode = 'ABC1234';

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: { deletedAt: new Date() }, // School is soft-deleted
        },
      });

      await expect(service.joinWithCode(STUDENT_ID, { code: rawCode })).rejects.toThrow(
        new NotFoundException('Invalid or expired join code'),
      );
    });

    it('catches P2004 database constraint error and throws ConflictException (CRIT-02)', async () => {
      const rawCode = 'ABC1234';
      const invitationId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 10,
        useCount: 0,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);

      const p2004Error = new Prisma.PrismaClientKnownRequestError('Constraint failed', {
        code: 'P2004',
        clientVersion: '5.0.0',
      });
      mockPrisma.invitation.updateMany.mockRejectedValueOnce(p2004Error);

      await expect(service.joinWithCode(STUDENT_ID, { code: rawCode })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('throws ConflictException when join code has reached maximum uses', async () => {
      const rawCode = 'ABC1234';
      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.JOIN_CODE,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        maxUses: 5,
        useCount: 5,
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          independentTeacherId: null,
          schoolId: SCHOOL_ID,
          school: null,
        },
      });

      await expect(service.joinWithCode(STUDENT_ID, { code: rawCode })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('enforces rate limiting and throws 429 after 5 failed attempts', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue(null);

      for (let i = 0; i < 5; i++) {
        await expect(
          service.joinWithCode(STUDENT_ID, { code: `WRONG${i}` }),
        ).rejects.toBeInstanceOf(NotFoundException);
      }

      // 6th attempt is blocked by rate limiter with 429
      await expect(service.joinWithCode(STUDENT_ID, { code: 'ANYCODE' })).rejects.toThrow(
        expect.objectContaining({ status: 429 }),
      );
    });
  });

  describe('acceptEmailInvitation', () => {
    it('accepts valid invitation, creates membership, and allocates desk', async () => {
      const token = 'token-1234567890123456';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.EMAIL,
        classroomId: CLASSROOM_ID,
        role: InvitationRole.STUDENT,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        classroom: { id: CLASSROOM_ID, deletedAt: null, school: null },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);

      mockPrisma.classroomMembership.create.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
      });

      mockPrisma.desk.findFirst.mockResolvedValueOnce({
        id: deskId,
        deskIndex: 1,
        membershipId: null,
      });

      mockPrisma.desk.updateMany.mockResolvedValueOnce({ count: 1 });

      const res = await service.acceptEmailInvitation(STUDENT_ID, { token });

      expect(res.alreadyMember).toBe(false);
      expect(res.desk?.deskIndex).toBe(1);
      expect(mockPrisma.invitation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: invitationId }),
          data: { state: InvitationState.USED, useCount: 1 },
        }),
      );
    });

    it('refuses to accept a non-student invitation and creates no membership', async () => {
      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.EMAIL,
        classroomId: CLASSROOM_ID,
        schoolId: SCHOOL_ID,
        role: InvitationRole.TEACHER,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        classroom: { id: CLASSROOM_ID, deletedAt: null, school: null },
      });
      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);

      await expect(
        service.acceptEmailInvitation(randomUUID(), { token: 'token-legacy-teacher' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
      expect(mockPrisma.schoolMember.upsert).not.toHaveBeenCalled();
    });

    it('never touches school membership when accepting an invitation', async () => {
      const token = 'token-no-school-member';
      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.EMAIL,
        classroomId: CLASSROOM_ID,
        schoolId: SCHOOL_ID,
        role: InvitationRole.STUDENT,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        classroom: { id: CLASSROOM_ID, deletedAt: null, school: null },
      });
      mockPrisma.classroomMembership.findUnique.mockResolvedValue(null);
      mockPrisma.classroomMembership.create.mockResolvedValue({
        id: randomUUID(),
        classroomId: CLASSROOM_ID,
        role: ClassroomRole.STUDENT,
      });

      const res = await service.acceptEmailInvitation(randomUUID(), { token });

      expect(res.role).toBe(ClassroomRole.STUDENT);
      expect(mockPrisma.schoolMember.upsert).not.toHaveBeenCalled();
    });

    it('reactivates inactive membership when accepting invitation (CRIT-05)', async () => {
      const token = 'token-student-reactivate';
      const invitationId = randomUUID();
      const membershipId = randomUUID();
      const deskId = randomUUID();

      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: invitationId,
        kind: InvitationKind.EMAIL,
        classroomId: CLASSROOM_ID,
        role: InvitationRole.STUDENT,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        classroom: { id: CLASSROOM_ID, deletedAt: null, school: null },
      });

      mockPrisma.classroomMembership.findUnique.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
        state: MembershipState.INACTIVE,
        deletedAt: new Date(),
        desk: { id: deskId, deskIndex: 2 },
      });

      mockPrisma.classroomMembership.update.mockResolvedValue({
        id: membershipId,
        classroomId: CLASSROOM_ID,
        userId: STUDENT_ID,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
      });

      const res = await service.acceptEmailInvitation(STUDENT_ID, { token });

      expect(res.alreadyMember).toBe(false);
      expect(res.membershipId).toBe(membershipId);
      expect(res.desk?.deskIndex).toBe(2);
      expect(mockPrisma.classroomMembership.update).toHaveBeenCalled();
      expect(mockPrisma.classroomMembership.create).not.toHaveBeenCalled();
    });

    it('rejects expired invitation with BadRequestException', async () => {
      const token = 'token-1234567890123456';
      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.EMAIL,
        classroomId: CLASSROOM_ID,
        role: InvitationRole.STUDENT,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() - 1000), // expired
        classroom: { id: CLASSROOM_ID, deletedAt: null, school: null },
      });

      await expect(service.acceptEmailInvitation(STUDENT_ID, { token })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects soft-deleted school with uniform 404 message (CRIT-04 / WARN-04)', async () => {
      const token = 'token-1234567890123456';
      mockPrisma.invitation.findUnique.mockResolvedValue({
        id: randomUUID(),
        kind: InvitationKind.EMAIL,
        classroomId: CLASSROOM_ID,
        state: InvitationState.PENDING,
        expiresAt: new Date(Date.now() + 100000),
        classroom: {
          id: CLASSROOM_ID,
          deletedAt: null,
          school: { deletedAt: new Date() },
        },
      });

      await expect(service.acceptEmailInvitation(STUDENT_ID, { token })).rejects.toThrow(
        new NotFoundException('Invalid or expired invitation'),
      );
    });
  });
});
