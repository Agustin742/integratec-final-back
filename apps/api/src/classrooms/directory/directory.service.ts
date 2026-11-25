import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ClassroomRole, MembershipState } from '@prisma/client';
import {
  AccessVerificationService,
  deriveClassroomAccessRole,
} from '../../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../../http/pagination/paginated';
import { PrismaService } from '../../prisma/prisma.service';
import { readableBaseAppearance } from '../../users/member-appearance';
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
        avatar: await readableBaseAppearance(
          this.prisma,
          m.user.id,
          m.user.avatarConfig?.appearance,
          {
            onUnsupported: () => this.unsupportedAppearance(),
          },
        ),
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
          avatar: await readableBaseAppearance(
            this.prisma,
            independentTeacher.id,
            independentTeacher.avatarConfig?.appearance,
            { onUnsupported: () => this.unsupportedAppearance() },
          ),
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

  private unsupportedAppearance(): void {
    this.logger.warn('Unsupported stored base appearance; using default avatar.');
  }
}
