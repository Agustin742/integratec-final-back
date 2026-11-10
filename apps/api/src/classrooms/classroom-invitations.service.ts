import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { OutboxWriter } from '../platform/outbox/outbox.writer';
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
import type { JoinClassroomResponseDto } from './dto/join-classroom-response.dto';
import type { JoinClassroomWithCodeDto } from './dto/join-classroom.dto';
import type { JoinCodeResponseDto } from './dto/join-code-response.dto';
import type { ListInvitationsQueryDto } from './dto/list-invitations-query.dto';

@Injectable()
export class ClassroomInvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessVerificationService,
    private readonly outbox: OutboxWriter,
    private readonly rateLimiter: JoinCodeRateLimiter,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
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

    const role = dto.role ?? InvitationRole.STUDENT;

    if (role === InvitationRole.OWNER || role === InvitationRole.ADMIN) {
      throw new BadRequestException('Classroom invitations cannot grant OWNER or ADMIN roles');
    }

    if (role === InvitationRole.TEACHER && access.myRole !== 'OWNER' && access.myRole !== 'ADMIN') {
      throw new ForbiddenException('Only school owners and administrators may invite teachers');
    }

    const token = randomBytes(32).toString('hex');
    const secretHash = hashSecret(token);
    const expiresAt = new Date(Date.now() + this.config.invitationTtlSeconds * 1000);
    const targetEmail = dto.email.trim().toLowerCase();

    const invitation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: {
          kind: InvitationKind.EMAIL,
          secretHash,
          targetEmail,
          classroomId,
          schoolId: access.classroom.schoolId,
          role,
          maxUses: 1,
          useCount: 0,
          expiresAt,
          state: InvitationState.PENDING,
          createdById: actorUserId,
        },
      });

      await this.outbox.record(tx, {
        type: CLASSROOM_INVITATION_CREATED_EVENT,
        payload: {
          invitationId: created.id,
          classroomId,
          targetEmail,
          role,
          token,
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

    const invitation = await this.prisma.invitation.findFirst({
      where: {
        id: invitationId,
        classroomId,
        kind: InvitationKind.EMAIL,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.state !== InvitationState.PENDING) {
      throw new BadRequestException('Only pending invitations can be revoked');
    }

    const updated = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { state: InvitationState.REVOKED },
    });

    return {
      id: updated.id,
      state: updated.state,
    };
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

    const activeCode = await this.prisma.invitation.findFirst({
      where: {
        classroomId,
        kind: InvitationKind.JOIN_CODE,
        state: InvitationState.PENDING,
      },
    });

    if (!activeCode) {
      throw new NotFoundException('No active join code found for this classroom');
    }

    await this.prisma.invitation.update({
      where: { id: activeCode.id },
      data: { state: InvitationState.REVOKED },
    });

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
   * Atomically binds the authenticated account to the classroom and assigns a desk.
   */
  async acceptEmailInvitation(
    actorUserId: string,
    dto: AcceptInvitationDto,
  ): Promise<JoinClassroomResponseDto> {
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
            deletedAt: true,
            school: { select: { deletedAt: true } },
          },
        },
      },
    });

    if (
      !invitation ||
      invitation.kind !== InvitationKind.EMAIL ||
      !invitation.classroom ||
      invitation.classroom.deletedAt ||
      invitation.classroom.school?.deletedAt
    ) {
      throw new NotFoundException('Invalid or expired invitation');
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
        role: existingMembership.role,
        desk: existingMembership.desk,
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
              role: concurrentMember.role,
              desk: concurrentMember.desk,
              alreadyMember: true,
            };
          }

          const latest = await tx.invitation.findUnique({ where: { id: invitation.id } });
          if (latest && (latest.state === InvitationState.USED || latest.useCount > 0)) {
            throw new ConflictException('Invitation has already been used');
          }
          throw new BadRequestException('Invitation is no longer active');
        }

        const targetRole =
          invitation.role === InvitationRole.TEACHER
            ? ClassroomRole.TEACHER
            : ClassroomRole.STUDENT;

        // If invited as a school classroom teacher, guarantee active SchoolMember authority
        if (targetRole === ClassroomRole.TEACHER && invitation.schoolId) {
          await tx.schoolMember.upsert({
            where: {
              schoolId_userId: {
                schoolId: invitation.schoolId,
                userId: actorUserId,
              },
            },
            create: {
              schoolId: invitation.schoolId,
              userId: actorUserId,
              role: SchoolRole.TEACHER,
              state: MembershipState.ACTIVE,
            },
            update: {
              state: MembershipState.ACTIVE,
            },
          });
        }

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
          if (targetRole === ClassroomRole.STUDENT) {
            if (existingMembership.desk) {
              desk = existingMembership.desk;
            } else {
              desk = await this.assignDesk(tx, classroomId, membershipId);
            }
          }
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
          if (targetRole === ClassroomRole.STUDENT) {
            desk = await this.assignDesk(tx, classroomId, membershipId);
          }
        }

        return {
          classroomId,
          membershipId,
          role: targetRole,
          desk,
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

  /**
   * Assigns an available desk (lowest deskIndex with membershipId: null).
   * Uses atomic conditional update (`membershipId: null`) to prevent race condition overwrites.
   * Dynamically provisions a new desk (maxDeskIndex + 1) if all desks are occupied,
   * retrying on transient deskIndex collision.
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
      maxUses: row.maxUses,
      useCount: row.useCount,
      state: row.state,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
