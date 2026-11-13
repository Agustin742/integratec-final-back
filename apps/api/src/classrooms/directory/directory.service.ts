import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ClassroomRole, MembershipState, type Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AccessVerificationService,
  deriveClassroomAccessRole,
} from '../../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../../http/pagination/paginated';
import { PrismaService } from '../../prisma/prisma.service';
import { compatibilityErrors } from '../../users/avatar-access.port';
import { AvatarDto, avatarSnapshot, DEFAULT_AVATAR } from '../../users/avatar.dto';
import type {
  ClassroomMemberDto,
  ClassroomMemberRole,
  ClassroomMembersQueryDto,
} from './directory.dto';

@Injectable()
export class ClassroomDirectoryService {
  private readonly logger = new Logger(ClassroomDirectoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  async list(
    actorUserId: string,
    classroomId: string,
    query: ClassroomMembersQueryDto,
  ): Promise<Paginated<ClassroomMemberDto>> {
    const access = await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'ANY',
    });

    if (!access.capabilities.includes('list_directory')) {
      throw new ForbiddenException(
        'Classroom member directory is only accessible to classroom members',
      );
    }

    const schoolId = access.classroom.schoolId;

    const memberships = await this.prisma.classroomMembership.findMany({
      where: {
        classroomId,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        ...(schoolId === null
          ? { role: { in: [ClassroomRole.STUDENT, ClassroomRole.TEACHER] } }
          : {
              OR: [
                { role: ClassroomRole.STUDENT },
                {
                  role: ClassroomRole.TEACHER,
                  user: {
                    schoolMemberships: {
                      some: {
                        schoolId,
                        state: MembershipState.ACTIVE,
                      },
                    },
                  },
                },
              ],
            }),
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            displayName: true,
            avatarConfig: { select: { appearance: true } },
            ...(schoolId !== null
              ? {
                  schoolMemberships: {
                    where: { schoolId, state: MembershipState.ACTIVE },
                    select: { role: true },
                    take: 1,
                  },
                }
              : {}),
          },
        },
      },
    });

    const members: ClassroomMemberDto[] = [];
    for (const m of memberships) {
      const schoolRole =
        'schoolMemberships' in m.user && Array.isArray(m.user.schoolMemberships)
          ? (m.user.schoolMemberships[0]?.role ?? null)
          : null;
      const derivedRole = deriveClassroomAccessRole({
        actorUserId: m.user.id,
        classroom: access.classroom,
        schoolRole,
        membershipRole: m.role,
        hasActiveParentLink: false,
      });
      if (derivedRole === null) continue;

      members.push({
        id: m.user.id,
        userId: m.user.id,
        displayName: m.user.displayName,
        role: m.role as ClassroomMemberRole,
        avatar: this.readAppearance(m.user.avatarConfig?.appearance),
      });
    }

    const existingUserIds = new Set(members.map((m) => m.userId));

    if (
      access.classroom.independentTeacherId !== null &&
      !existingUserIds.has(access.classroom.independentTeacherId)
    ) {
      const independentTeacher = await this.prisma.user.findUnique({
        where: { id: access.classroom.independentTeacherId },
        select: {
          id: true,
          displayName: true,
          avatarConfig: { select: { appearance: true } },
        },
      });

      if (independentTeacher) {
        members.push({
          id: independentTeacher.id,
          userId: independentTeacher.id,
          displayName: independentTeacher.displayName,
          role: 'TEACHER',
          avatar: this.readAppearance(independentTeacher.avatarConfig?.appearance),
        });
      }
    }

    const filtered =
      query.q !== undefined && query.q !== ''
        ? members.filter((member) =>
            member.displayName.toLowerCase().startsWith(query.q!.toLowerCase()),
          )
        : members;

    filtered.sort((a, b) => {
      const cmp = a.displayName.localeCompare(b.displayName);
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    });

    const total = filtered.length;
    const { skip, take } = toSkipTake(query);
    const items = filtered.slice(skip, skip + take);

    return paginated(items, total, query);
  }

  private readAppearance(value: Prisma.JsonValue | undefined): AvatarDto {
    if (
      value === undefined ||
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length === 0
    ) {
      return { ...DEFAULT_AVATAR };
    }

    try {
      const appearance = plainToInstance(AvatarDto, avatarSnapshot(value as unknown as AvatarDto));
      if (validateSync(appearance).length > 0 || compatibilityErrors(appearance).length > 0) {
        return this.unsupportedAppearance();
      }
      return avatarSnapshot(appearance);
    } catch {
      return this.unsupportedAppearance();
    }
  }

  private unsupportedAppearance(): AvatarDto {
    this.logger.warn('Unsupported stored base appearance; using default avatar.');
    return { ...DEFAULT_AVATAR };
  }
}
