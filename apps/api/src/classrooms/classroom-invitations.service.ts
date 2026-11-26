import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
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
  SchoolRole,
} from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import { encryptSecret } from '../platform/crypto/secret-box';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { ClassroomContextRecorder } from '../platform/classroom-context/classroom-context.recorder';
import { RealtimeEventsRecorder } from '../platform/realtime/realtime-events.recorder';
import { PrismaService } from '../prisma/prisma.service';
import { CLASSROOM_INVITATION_CREATED_EVENT } from './classroom-invitation-events';
import { JoinCodeRateLimiter } from './join-code-rate-limiter.service';
import { generateJoinCode, hashSecret, normalizeJoinCode } from './join-code.util';
import type { AcceptInvitationDto } from './dto/accept-invitation.dto';
import type { CreateClassroomInvitationDto } from './dto/create-invitation.dto';
import type { CreateJoinCodeDto } from './dto/create-join-code.dto';
import type {
  ClassroomInvitationResponseDto,
  CreatedClassroomInvitationResponseDto,
  RevokeInvitationResponseDto,
} from './dto/invitation-response.dto';
import type {
  AcceptInvitationResponseDto,
  JoinClassroomResponseDto,
} from './dto/join-classroom-response.dto';
import type { JoinClassroomWithCodeDto } from './dto/join-classroom.dto';
import type { JoinCodeResponseDto } from './dto/join-code-response.dto';
import type { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';
import type { ClassroomParentLinksResponseDto } from './dto/parent-link-response.dto';

const MAX_GUARDIANS_PER_STUDENT = 2;

@Injectable()
export class ClassroomInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessVerificationService,
    private readonly outbox: OutboxWriter,
    private readonly rateLimiter: JoinCodeRateLimiter,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly contextRecorder: ClassroomContextRecorder,
    private readonly realtimeEvents: RealtimeEventsRecorder,
  ) {}

  /**
   * Issues an email invitation for a classroom.
   * Dispatches outbox event for asynchronous email delivery.
   * Completely preserves non-disclosure (never reveals whether target email exists).
   */
  async createEmailInvitation(
    actorUserId: string,
    classroomId: string,
    dto: CreateClassroomInvitationDto,
  ): Promise<CreatedClassroomInvitationResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    const access = await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    // Only student and parent invitations are supported here. Teacher invitations
    // belong to the school-teacher invitation flow (HU-AUL-004).
    const role = dto.role ?? InvitationRole.STUDENT;
    if (role !== InvitationRole.STUDENT && role !== InvitationRole.PARENT) {
      throw new BadRequestException(
        'Classroom invitations can only be issued for students or parents',
      );
    }

    let childId: string | null = null;
    if (role === InvitationRole.STUDENT) {
      if (dto.childId !== undefined && dto.childId !== null) {
        throw new BadRequestException('childId is only allowed for parent invitations');
      }
    } else {
      if (!dto.childId) {
        throw new BadRequestException('childId is required for parent invitations');
      }
      if (!UUID_PATTERN.test(dto.childId)) {
        throw new BadRequestException('childId must be a valid UUID');
      }
      if (access.classroom.adultMode) {
        throw new ConflictException('Parent invitations are disabled in adult education mode');
      }
      const studentMembership = await this.prisma.classroomMembership.findFirst({
        where: {
          classroomId,
          userId: dto.childId,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!studentMembership) {
        throw new NotFoundException('Active student not found in this classroom');
      }
      const activeParentCount = await this.prisma.parentLink.count({
        where: {
          classroomId,
          childId: dto.childId,
          state: MembershipState.ACTIVE,
        },
      });
      if (activeParentCount >= MAX_GUARDIANS_PER_STUDENT) {
        throw new ConflictException(
          'This student already has the maximum of 2 active guardians in this classroom',
        );
      }
      childId = dto.childId;
    }

    const token = randomBytes(32).toString('hex');
    const secretHash = hashSecret(token);
    const expiresAt = new Date(Date.now() + this.config.invitationTtlSeconds * 1000);
    const targetEmail = dto.email.trim().toLowerCase();

    const invitation = await this.prisma.$transaction(async (tx) => {
      if (role === InvitationRole.PARENT && childId !== null) {
        const existingPending = await tx.invitation.findFirst({
          where: {
            classroomId,
            kind: InvitationKind.EMAIL,
            role: InvitationRole.PARENT,
            targetEmail,
            childId,
            state: InvitationState.PENDING,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (existingPending) {
          throw new ConflictException(
            'A pending parent invitation already exists for this email and student in this classroom',
          );
        }
      }

      const created = await tx.invitation.create({
        data: {
          kind: InvitationKind.EMAIL,
          secretHash,
          targetEmail,
          classroomId,
          schoolId: access.classroom.schoolId,
          childId,
          role,
          maxUses: 1,
          useCount: 0,
          expiresAt,
          state: InvitationState.PENDING,
          createdById: actorUserId,
        },
        include: {
          child: { select: { displayName: true } },
        },
      });

      await this.outbox.record(tx, {
        type: CLASSROOM_INVITATION_CREATED_EVENT,
        payload: {
          invitationId: created.id,
          classroomId,
          targetEmail,
          role,
          // Never persist the raw token: seal it, bound to this invitation.
          encryptedToken: encryptSecret(token, this.config.invitationTokenKey, created.id),
        },
      });

      return created;
    });

    return {
      ...this.toInvitationResponse(invitation),
      token,
    };
  }

  /**
   * Returns a paginated list of email invitations for the specified classroom.
   */
  async listInvitations(
    actorUserId: string,
    classroomId: string,
    query: ListInvitationsQueryDto,
  ): Promise<Paginated<ClassroomInvitationResponseDto>> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    const where: Prisma.InvitationWhereInput = {
      classroomId,
      kind: InvitationKind.EMAIL,
    };

    if (query.status && query.status !== 'ALL') {
      where.state = query.status;
    }

    const [total, rows] = await Promise.all([
      this.prisma.invitation.count({ where }),
      this.prisma.invitation.findMany({
        where,
        include: {
          child: { select: { displayName: true } },
        },
        ...toSkipTake({ page: query.page, pageSize: query.pageSize }),
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    ]);

    const items = rows.map((row) => this.toInvitationResponse(row));
    return paginated(items, total, { page: query.page, pageSize: query.pageSize });
  }

  /**
   * Revokes an active email invitation.
   */
  async revokeInvitation(
    actorUserId: string,
    classroomId: string,
    invitationId: string,
  ): Promise<RevokeInvitationResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }
    if (!UUID_PATTERN.test(classroomId) || !UUID_PATTERN.test(invitationId)) {
      throw new NotFoundException('Invitation not found');
    }

    await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    // Atomic compare-and-set: only a PENDING invitation can be revoked. A read followed by an
    // update by id could overwrite an acceptance that committed in between.
    const revoked = await this.prisma.invitation.updateMany({
      where: {
        id: invitationId,
        classroomId,
        kind: InvitationKind.EMAIL,
        state: InvitationState.PENDING,
      },
      data: { state: InvitationState.REVOKED },
    });

    if (revoked.count === 1) {
      return { id: invitationId, state: InvitationState.REVOKED };
    }

    // Nothing matched: report why, without changing anything.
    const current = await this.prisma.invitation.findFirst({
      where: { id: invitationId, classroomId, kind: InvitationKind.EMAIL },
      select: { state: true },
    });

    if (!current) {
      throw new NotFoundException('Invitation not found');
    }
    if (current.state === InvitationState.USED) {
      throw new BadRequestException('Invitation has already been used and cannot be revoked');
    }
    throw new BadRequestException('Only pending invitations can be revoked');
  }

  /**
   * Generates or regenerates the classroom join code.
   * If an active code already exists, marks it as REVOKED.
   * Raw join code is returned ONCE in this response.
   */
  async generateJoinCode(
    actorUserId: string,
    classroomId: string,
    dto: CreateJoinCodeDto,
  ): Promise<JoinCodeResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    const access = await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    const rawCode = generateJoinCode();
    const normalized = normalizeJoinCode(rawCode);
    const secretHash = hashSecret(normalized);
    const expiresInSeconds = dto.expiresInSeconds ?? this.config.invitationTtlSeconds;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const invitation = await this.prisma.$transaction(async (tx) => {
      // Regenerating marks previous pending join code as REVOKED
      await tx.invitation.updateMany({
        where: {
          classroomId,
          kind: InvitationKind.JOIN_CODE,
          state: InvitationState.PENDING,
        },
        data: {
          state: InvitationState.REVOKED,
        },
      });

      return tx.invitation.create({
        data: {
          kind: InvitationKind.JOIN_CODE,
          secretHash,
          classroomId,
          schoolId: access.classroom.schoolId,
          role: InvitationRole.STUDENT,
          maxUses: dto.maxUses ?? null,
          useCount: 0,
          expiresAt,
          state: InvitationState.PENDING,
          createdById: actorUserId,
        },
      });
    });

    return {
      id: invitation.id,
      code: rawCode,
      role: invitation.role,
      maxUses: invitation.maxUses,
      useCount: invitation.useCount,
      state: invitation.state,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  /**
   * Revokes the active join code for a classroom.
   */
  async revokeJoinCode(
    actorUserId: string,
    classroomId: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    // Atomic compare-and-set so a code that was just exhausted (USED) is never overwritten.
    const revoked = await this.prisma.invitation.updateMany({
      where: {
        classroomId,
        kind: InvitationKind.JOIN_CODE,
        state: InvitationState.PENDING,
      },
      data: { state: InvitationState.REVOKED },
    });

    if (revoked.count === 0) {
      throw new NotFoundException('No active join code found for this classroom');
    }

    return {
      success: true,
      message: 'Join code revoked successfully',
    };
  }

  /**
   * Joins a virtual classroom using a normalized join code.
   * Rate-limited against brute-force guessing (429 TOO_MANY_REQUESTS).
   * Fully atomic, idempotent, and performs dynamic desk auto-expansion when desks are full.
   */
  async joinWithCode(
    actorUserId: string,
    dto: JoinClassroomWithCodeDto,
  ): Promise<JoinClassroomResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    // 1. Enforce rate limiting
    this.rateLimiter.checkRateLimit(actorUserId);

    const normalized = normalizeJoinCode(dto.code);
    const secretHash = hashSecret(normalized);

    const invitation = await this.prisma.invitation.findUnique({
      where: { secretHash },
      include: {
        classroom: {
          select: {
            id: true,
            deletedAt: true,
            independentTeacherId: true,
            schoolId: true,
            school: { select: { deletedAt: true } },
          },
        },
      },
    });

    if (
      !invitation ||
      invitation.kind !== InvitationKind.JOIN_CODE ||
      !invitation.classroom ||
      invitation.classroom.deletedAt ||
      invitation.classroom.school?.deletedAt
    ) {
      this.rateLimiter.recordFailure(actorUserId);
      throw new NotFoundException('Invalid or expired join code');
    }

    // Idempotent retry: a student who is already enrolled gets their existing membership back
    // even when their own join consumed the last use. It never admits a new user, and it only
    // applies once the classroom and school were confirmed to exist above.
    const isExhausted =
      invitation.state === InvitationState.USED ||
      (invitation.state === InvitationState.PENDING &&
        invitation.maxUses !== null &&
        invitation.useCount >= invitation.maxUses);
    if (isExhausted) {
      const enrolled = await this.findActiveStudentMembership(invitation.classroomId!, actorUserId);
      if (enrolled) {
        this.rateLimiter.recordSuccess(actorUserId);
        return enrolled;
      }
    }

    if (invitation.state !== InvitationState.PENDING) {
      this.rateLimiter.recordFailure(actorUserId);
      throw new BadRequestException('Join code is no longer active');
    }

    if (invitation.expiresAt <= new Date()) {
      this.rateLimiter.recordFailure(actorUserId);
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { state: InvitationState.EXPIRED },
      });
      throw new BadRequestException('Join code has expired');
    }

    if (invitation.maxUses !== null && invitation.useCount >= invitation.maxUses) {
      this.rateLimiter.recordFailure(actorUserId);
      throw new ConflictException('Join code has reached maximum uses');
    }

    const classroomId = invitation.classroomId!;

    // Prevent classroom staff from enrolling as students
    if (invitation.classroom.independentTeacherId === actorUserId) {
      throw new ConflictException('Classroom staff cannot join as a student');
    }

    if (invitation.classroom.schoolId) {
      const staffMember = await this.prisma.schoolMember.findFirst({
        where: {
          schoolId: invitation.classroom.schoolId,
          userId: actorUserId,
          state: MembershipState.ACTIVE,
          role: { in: [SchoolRole.OWNER, SchoolRole.ADMIN] },
        },
        select: { id: true },
      });
      if (staffMember) {
        throw new ConflictException('Classroom staff cannot join as a student');
      }
    }

    // 2. Check existing membership (idempotency, staff check, or reactivation)
    const existingMembership = await this.prisma.classroomMembership.findUnique({
      where: {
        classroomId_userId: {
          classroomId,
          userId: actorUserId,
        },
      },
      include: {
        desk: { select: { id: true, deskIndex: true } },
      },
    });

    if (
      existingMembership &&
      existingMembership.state === MembershipState.ACTIVE &&
      !existingMembership.deletedAt
    ) {
      if (existingMembership.role === ClassroomRole.TEACHER) {
        throw new ConflictException('Classroom staff cannot join as a student');
      }
      this.rateLimiter.recordSuccess(actorUserId);
      return {
        classroomId,
        membershipId: existingMembership.id,
        role: existingMembership.role,
        desk: existingMembership.desk,
        alreadyMember: true,
      };
    }

    // 3. Atomically consume code, enroll/reactivate student, and allocate/expand desk
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Atomic conditional update on useCount to prevent concurrent overconsumption
        const whereClause: Prisma.InvitationWhereInput = {
          id: invitation.id,
          state: InvitationState.PENDING,
          expiresAt: { gt: new Date() },
        };
        if (invitation.maxUses !== null) {
          whereClause.useCount = { lt: invitation.maxUses };
        }

        const updated = await tx.invitation.updateMany({
          where: whereClause,
          data: {
            useCount: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          const concurrentMember = await tx.classroomMembership.findUnique({
            where: {
              classroomId_userId: {
                classroomId,
                userId: actorUserId,
              },
            },
            include: {
              desk: { select: { id: true, deskIndex: true } },
            },
          });

          if (
            concurrentMember &&
            concurrentMember.state === MembershipState.ACTIVE &&
            !concurrentMember.deletedAt &&
            concurrentMember.role === ClassroomRole.STUDENT
          ) {
            return {
              classroomId,
              membershipId: concurrentMember.id,
              role: concurrentMember.role,
              desk: concurrentMember.desk,
              alreadyMember: true,
            };
          }

          const latest = await tx.invitation.findUnique({ where: { id: invitation.id } });
          if (latest && latest.maxUses !== null && latest.useCount >= latest.maxUses) {
            throw new ConflictException('Join code has reached maximum uses');
          }
          throw new BadRequestException('Join code is no longer active');
        }

        if (invitation.maxUses !== null) {
          await tx.invitation.updateMany({
            where: {
              id: invitation.id,
              useCount: { gte: invitation.maxUses },
              state: InvitationState.PENDING,
            },
            data: { state: InvitationState.USED },
          });
        }

        let membershipId: string;
        let desk: { id: string; deskIndex: number } | null = null;

        if (existingMembership) {
          await tx.joinCodeUsage.upsert({
            where: {
              invitationId_userId: {
                invitationId: invitation.id,
                userId: actorUserId,
              },
            },
            create: {
              invitationId: invitation.id,
              userId: actorUserId,
            },
            update: {
              usedAt: new Date(),
            },
          });

          const reactivated = await tx.classroomMembership.update({
            where: { id: existingMembership.id },
            data: {
              state: MembershipState.ACTIVE,
              deletedAt: null,
              role: ClassroomRole.STUDENT,
            },
          });
          membershipId = reactivated.id;
          if (existingMembership.desk) {
            desk = existingMembership.desk;
          } else {
            desk = await this.assignDesk(tx, classroomId, membershipId);
          }
        } else {
          await tx.joinCodeUsage.create({
            data: {
              invitationId: invitation.id,
              userId: actorUserId,
            },
          });

          const created = await tx.classroomMembership.create({
            data: {
              classroomId,
              userId: actorUserId,
              role: ClassroomRole.STUDENT,
              state: MembershipState.ACTIVE,
            },
          });
          membershipId = created.id;
          desk = await this.assignDesk(tx, classroomId, membershipId);
        }

        await this.contextRecorder.recordChanged(tx, classroomId);

        return {
          classroomId,
          membershipId,
          role: ClassroomRole.STUDENT,
          desk,
          alreadyMember: false,
        };
      });

      this.rateLimiter.recordSuccess(actorUserId);
      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          const concurrentMembership = await this.prisma.classroomMembership.findUnique({
            where: {
              classroomId_userId: {
                classroomId,
                userId: actorUserId,
              },
            },
            include: {
              desk: { select: { id: true, deskIndex: true } },
            },
          });

          if (
            concurrentMembership &&
            concurrentMembership.state === MembershipState.ACTIVE &&
            !concurrentMembership.deletedAt &&
            concurrentMembership.role === ClassroomRole.STUDENT
          ) {
            this.rateLimiter.recordSuccess(actorUserId);
            return {
              classroomId,
              membershipId: concurrentMembership.id,
              role: concurrentMembership.role,
              desk: concurrentMembership.desk,
              alreadyMember: true,
            };
          }
        }

        if (error.code === 'P2002' || error.code === 'P2004') {
          // Unique constraint violation or database constraint conflict
          throw new ConflictException('Concurrent join operation conflict, please retry');
        }
      }
      throw error;
    }
  }

  /**
   * Accepts an email invitation using the opaque token received by email.
   * For STUDENT invitations, atomically binds the account to the classroom and assigns a desk.
   * For PARENT invitations, atomically links the account as a guardian of the target student
   * (max 2 active guardians, disabled in adult mode, no classroom membership or desk).
   */
  async acceptEmailInvitation(
    actorUserId: string,
    dto: AcceptInvitationDto,
  ): Promise<AcceptInvitationResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    const secretHash = hashSecret(dto.token.trim());

    const invitation = await this.prisma.invitation.findUnique({
      where: { secretHash },
      include: {
        classroom: {
          select: {
            id: true,
            adultMode: true,
            deletedAt: true,
            school: { select: { deletedAt: true } },
          },
        },
      },
    });

    if (
      !invitation ||
      invitation.kind !== InvitationKind.EMAIL ||
      (invitation.role !== InvitationRole.STUDENT && invitation.role !== InvitationRole.PARENT) ||
      !invitation.classroom ||
      invitation.classroom.deletedAt ||
      invitation.classroom.school?.deletedAt
    ) {
      throw new NotFoundException('Invalid or expired invitation');
    }

    if (invitation.role === InvitationRole.PARENT) {
      return this.acceptParentEmailInvitation(actorUserId, invitation);
    }

    // Idempotent retry: the account that consumed this single-use invitation gets its
    // existing membership back instead of an error. Other accounts are still rejected.
    if (invitation.state === InvitationState.USED) {
      const enrolled = await this.findActiveStudentMembership(invitation.classroomId!, actorUserId);
      if (enrolled) {
        return {
          ...enrolled,
          role: InvitationRole.STUDENT,
          deskIndex: enrolled.desk?.deskIndex ?? null,
          childId: null,
          parentLinkId: null,
        };
      }
    }

    if (invitation.state !== InvitationState.PENDING) {
      throw new BadRequestException('Invitation is no longer active');
    }

    if (invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { state: InvitationState.EXPIRED },
      });
      throw new BadRequestException('Invitation has expired');
    }

    const classroomId = invitation.classroomId!;

    // Idempotency: check if caller is already enrolled
    const existingMembership = await this.prisma.classroomMembership.findUnique({
      where: {
        classroomId_userId: {
          classroomId,
          userId: actorUserId,
        },
      },
      include: {
        desk: { select: { id: true, deskIndex: true } },
      },
    });

    if (
      existingMembership &&
      existingMembership.state === MembershipState.ACTIVE &&
      !existingMembership.deletedAt
    ) {
      return {
        classroomId,
        membershipId: existingMembership.id,
        role: InvitationRole.STUDENT,
        desk: existingMembership.desk,
        deskIndex: existingMembership.desk?.deskIndex ?? null,
        childId: null,
        parentLinkId: null,
        alreadyMember: true,
      };
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.invitation.updateMany({
          where: {
            id: invitation.id,
            state: InvitationState.PENDING,
            expiresAt: { gt: new Date() },
            useCount: 0,
          },
          data: {
            state: InvitationState.USED,
            useCount: 1,
          },
        });

        if (updated.count === 0) {
          const concurrentMember = await tx.classroomMembership.findUnique({
            where: {
              classroomId_userId: {
                classroomId,
                userId: actorUserId,
              },
            },
            include: {
              desk: { select: { id: true, deskIndex: true } },
            },
          });

          if (
            concurrentMember &&
            concurrentMember.state === MembershipState.ACTIVE &&
            !concurrentMember.deletedAt
          ) {
            return {
              classroomId,
              membershipId: concurrentMember.id,
              role: InvitationRole.STUDENT,
              desk: concurrentMember.desk,
              deskIndex: concurrentMember.desk?.deskIndex ?? null,
              childId: null,
              parentLinkId: null,
              alreadyMember: true,
            };
          }

          const latest = await tx.invitation.findUnique({ where: { id: invitation.id } });
          if (latest && (latest.state === InvitationState.USED || latest.useCount > 0)) {
            throw new ConflictException('Invitation has already been used');
          }
          throw new BadRequestException('Invitation is no longer active');
        }

        const targetRole = ClassroomRole.STUDENT;

        let membershipId: string;
        let desk: { id: string; deskIndex: number } | null = null;

        if (existingMembership) {
          const reactivated = await tx.classroomMembership.update({
            where: { id: existingMembership.id },
            data: {
              state: MembershipState.ACTIVE,
              deletedAt: null,
              role: targetRole,
            },
          });
          membershipId = reactivated.id;
          desk = existingMembership.desk ?? (await this.assignDesk(tx, classroomId, membershipId));
        } else {
          const created = await tx.classroomMembership.create({
            data: {
              classroomId,
              userId: actorUserId,
              role: targetRole,
              state: MembershipState.ACTIVE,
            },
          });
          membershipId = created.id;
          desk = await this.assignDesk(tx, classroomId, membershipId);
        }

        await this.contextRecorder.recordChanged(tx, classroomId);

        return {
          classroomId,
          membershipId,
          role: InvitationRole.STUDENT,
          desk,
          deskIndex: desk?.deskIndex ?? null,
          childId: null,
          parentLinkId: null,
          alreadyMember: false,
        };
      });

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002' || error.code === 'P2004') {
          throw new ConflictException('Concurrent invitation acceptance conflict, please retry');
        }
      }
      throw error;
    }
  }

  private async acceptParentEmailInvitation(
    actorUserId: string,
    invitation: {
      id: string;
      classroomId: string | null;
      childId: string | null;
      state: InvitationState;
      expiresAt: Date;
      classroom: {
        id: string;
        adultMode: boolean;
        deletedAt: Date | null;
        school: { deletedAt: Date | null } | null;
      } | null;
    },
  ): Promise<AcceptInvitationResponseDto> {
    if (!invitation.classroomId || !invitation.childId || !invitation.classroom) {
      throw new NotFoundException('Invalid or expired invitation');
    }

    const classroomId = invitation.classroomId;
    const childId = invitation.childId;

    // Idempotent retry when this account already holds an active parent link for the child.
    if (invitation.state === InvitationState.USED) {
      if (invitation.classroom.adultMode) {
        throw new ConflictException('Parent invitations are disabled in adult education mode');
      }
      const existingLink = await this.prisma.parentLink.findUnique({
        where: {
          parentId_childId_classroomId: {
            parentId: actorUserId,
            childId,
            classroomId,
          },
        },
        select: { id: true, state: true },
      });
      if (existingLink && existingLink.state === MembershipState.ACTIVE) {
        const activeStudent = await this.prisma.classroomMembership.findFirst({
          where: {
            classroomId,
            userId: childId,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (activeStudent) {
          return {
            classroomId,
            membershipId: null,
            role: InvitationRole.PARENT,
            desk: null,
            deskIndex: null,
            childId,
            parentLinkId: existingLink.id,
            alreadyMember: true,
          };
        }
      }
    }

    if (invitation.state !== InvitationState.PENDING) {
      throw new BadRequestException('Invitation is no longer active');
    }

    if (invitation.expiresAt <= new Date()) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { state: InvitationState.EXPIRED },
      });
      throw new BadRequestException('Invitation has expired');
    }

    if (actorUserId === childId) {
      throw new ConflictException('A student cannot link themselves as their own guardian');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const freshClassroom = await tx.classroom.findUnique({
          where: { id: classroomId },
          select: {
            deletedAt: true,
            adultMode: true,
            school: { select: { deletedAt: true } },
          },
        });
        if (!freshClassroom || freshClassroom.deletedAt || freshClassroom.school?.deletedAt) {
          throw new NotFoundException('Invalid or expired invitation');
        }
        if (freshClassroom.adultMode) {
          throw new ConflictException('Parent invitations are disabled in adult education mode');
        }

        // Lock the student's active membership row so concurrent parent acceptances for the
        // same student serialize cleanly when checking the 2-guardian cap.
        const lockedStudentRows = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM classroom_memberships
          WHERE classroom_id = ${classroomId}::uuid
            AND user_id = ${childId}::uuid
            AND role = 'student'::classroom_role
            AND state = 'active'::membership_state
            AND deleted_at IS NULL
          FOR UPDATE
        `;
        if (lockedStudentRows.length === 0) {
          throw new ConflictException('Student is no longer enrolled in this classroom');
        }

        const existingLink = await tx.parentLink.findUnique({
          where: {
            parentId_childId_classroomId: {
              parentId: actorUserId,
              childId,
              classroomId,
            },
          },
          select: { id: true, state: true },
        });

        if (existingLink && existingLink.state === MembershipState.ACTIVE) {
          return {
            classroomId,
            membershipId: null,
            role: InvitationRole.PARENT,
            desk: null,
            deskIndex: null,
            childId,
            parentLinkId: existingLink.id,
            alreadyMember: true,
          };
        }

        const activeParentCount = await tx.parentLink.count({
          where: {
            classroomId,
            childId,
            state: MembershipState.ACTIVE,
          },
        });
        if (activeParentCount >= MAX_GUARDIANS_PER_STUDENT) {
          throw new ConflictException(
            'This student already has the maximum of 2 active guardians in this classroom',
          );
        }

        const updated = await tx.invitation.updateMany({
          where: {
            id: invitation.id,
            state: InvitationState.PENDING,
            expiresAt: { gt: new Date() },
            useCount: 0,
          },
          data: {
            state: InvitationState.USED,
            useCount: 1,
          },
        });

        if (updated.count === 0) {
          const latest = await tx.invitation.findUnique({ where: { id: invitation.id } });
          if (latest && (latest.state === InvitationState.USED || latest.useCount > 0)) {
            throw new ConflictException('Invitation has already been used');
          }
          throw new BadRequestException('Invitation is no longer active');
        }

        const parentLink = existingLink
          ? await tx.parentLink.update({
              where: { id: existingLink.id },
              data: { state: MembershipState.ACTIVE },
              select: { id: true },
            })
          : await tx.parentLink.create({
              data: {
                parentId: actorUserId,
                childId,
                classroomId,
                state: MembershipState.ACTIVE,
              },
              select: { id: true },
            });

        await this.contextRecorder.recordChanged(tx, classroomId);

        return {
          classroomId,
          membershipId: null,
          role: InvitationRole.PARENT,
          desk: null,
          deskIndex: null,
          childId,
          parentLinkId: parentLink.id,
          alreadyMember: false,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002' || error.code === 'P2004') {
          throw new ConflictException('Concurrent invitation acceptance conflict, please retry');
        }
      }
      throw error;
    }
  }

  /**
   * Lists active parent-child guardian links for a classroom. Restricted to classroom staff.
   */
  async listParentLinks(
    actorUserId: string,
    classroomId: string,
  ): Promise<ClassroomParentLinksResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    const rows = await this.prisma.parentLink.findMany({
      where: {
        classroomId,
        state: MembershipState.ACTIVE,
      },
      select: {
        id: true,
        parentId: true,
        childId: true,
        state: true,
        createdAt: true,
        parent: { select: { displayName: true } },
        child: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        parentDisplayName: row.parent.displayName,
        childId: row.childId,
        childDisplayName: row.child.displayName,
        state: row.state,
        createdAt: row.createdAt,
      })),
    };
  }

  /**
   * Logically unlinks a parent from a child in a classroom by marking the ParentLink INACTIVE.
   * Preserves historical messages and records. Restricted to classroom staff.
   */
  async unlinkParentLink(actorUserId: string, classroomId: string, linkId: string): Promise<void> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    if (!UUID_PATTERN.test(linkId)) {
      throw new NotFoundException('Parent link not found');
    }

    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.parentLink.findFirst({
        where: { id: linkId, classroomId },
        select: { id: true, state: true },
      });

      if (!existing) {
        throw new NotFoundException('Parent link not found');
      }

      if (existing.state !== MembershipState.ACTIVE) {
        return;
      }

      const changed = await tx.parentLink.updateMany({
        where: {
          id: linkId,
          classroomId,
          state: MembershipState.ACTIVE,
        },
        data: {
          state: MembershipState.INACTIVE,
        },
      });

      if (changed.count === 1) {
        await this.contextRecorder.recordChanged(tx, classroomId);
      }
    });
  }

  /**
   * Returns the caller's existing, active student enrollment in the classroom, or null.
   * Used to answer retries idempotently; inactive or soft-deleted memberships and staff
   * memberships never match.
   */
  private async findActiveStudentMembership(
    classroomId: string,
    userId: string,
  ): Promise<JoinClassroomResponseDto | null> {
    const membership = await this.prisma.classroomMembership.findUnique({
      where: { classroomId_userId: { classroomId, userId } },
      include: { desk: { select: { id: true, deskIndex: true } } },
    });
    if (
      !membership ||
      membership.state !== MembershipState.ACTIVE ||
      membership.deletedAt ||
      membership.role !== ClassroomRole.STUDENT
    ) {
      return null;
    }
    return {
      classroomId,
      membershipId: membership.id,
      role: membership.role,
      desk: membership.desk,
      alreadyMember: true,
    };
  }

  /**
   * Assigns an available desk (lowest deskIndex with membershipId: null).
   * Uses atomic conditional update (`membershipId: null`) to prevent race condition overwrites.
   * Dynamically provisions a new desk (maxDeskIndex + 1) if all desks are occupied,
   * retrying on transient deskIndex collision. A provisioned desk also records the realtime layout
   * event in the same transaction (#79).
   */
  private async assignDesk(
    tx: Prisma.TransactionClient,
    classroomId: string,
    membershipId: string,
  ): Promise<{ id: string; deskIndex: number }> {
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const availableDesk = await tx.desk.findFirst({
        where: {
          classroomId,
          membershipId: null,
        },
        orderBy: { deskIndex: 'asc' },
        select: { id: true, deskIndex: true },
      });

      if (availableDesk) {
        const claimed = await tx.desk.updateMany({
          where: { id: availableDesk.id, membershipId: null },
          data: { membershipId },
        });

        if (claimed.count === 1) {
          return { id: availableDesk.id, deskIndex: availableDesk.deskIndex };
        }
        // Concurrent transaction claimed this desk, retry loop
        continue;
      }

      // No unassigned desk found: auto-expand
      const maxDesk = await tx.desk.findFirst({
        where: { classroomId },
        orderBy: { deskIndex: 'desc' },
        select: { deskIndex: true },
      });

      const nextIndex = (maxDesk?.deskIndex ?? 0) + 1;
      try {
        const createdDesk = await tx.desk.create({
          data: {
            classroomId,
            membershipId,
            deskIndex: nextIndex,
          },
          select: { id: true, deskIndex: true },
        });
        // Live rooms learn the new layout only if this transaction commits. The count is read
        // inside it, so it includes the desk just created.
        await this.realtimeEvents.recordClassroomLayoutChanged(tx, {
          classroomId,
          deskCount: await tx.desk.count({ where: { classroomId } }),
        });
        return createdDesk;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          (err.code === 'P2002' || err.code === 'P2004')
        ) {
          // Concurrent auto-expansion collided on (classroomId, deskIndex), retry loop
          continue;
        }
        throw err;
      }
    }

    throw new ConflictException('Unable to allocate a desk due to concurrent joins, please retry');
  }

  private toInvitationResponse(row: {
    id: string;
    kind: InvitationKind;
    targetEmail: string | null;
    role: InvitationRole;
    childId?: string | null;
    child?: { displayName: string } | null;
    maxUses: number | null;
    useCount: number;
    state: InvitationState;
    expiresAt: Date;
    createdAt: Date;
  }): ClassroomInvitationResponseDto {
    return {
      id: row.id,
      kind: row.kind,
      targetEmail: row.targetEmail,
      role: row.role,
      childId: row.childId ?? null,
      childDisplayName: row.child?.displayName ?? null,
      maxUses: row.maxUses,
      useCount: row.useCount,
      state: row.state,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
