import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ClassroomRole,
  MembershipState,
  type Prisma,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import {
  AccessVerificationService,
  type ClassroomAccessRole,
  type ClassroomCapability,
  computeClassroomCapabilities,
  UUID_PATTERN,
} from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_CLASSROOM_CONTROL_STATES,
  DEFAULT_INITIAL_DESK_COUNT,
  DEFAULT_PET_NAME,
  DEFAULT_PET_SPECIES,
} from './classrooms.constants';
import type {
  ClassroomDetailResponseDto,
  ClassroomListItemDto,
  PaginatedClassroomsResponseDto,
} from './dto/classroom-response.dto';
import type { CreateClassroomDto } from './dto/create-classroom.dto';
import {
  DEFAULT_CLASSROOMS_LIMIT,
  DEFAULT_CLASSROOMS_PAGE,
  type ListClassroomsQueryDto,
} from './dto/list-classrooms-query.dto';
import type { UpdateClassroomDto } from './dto/update-classroom.dto';

interface ClassroomWithDetails {
  id: string;
  name: string;
  subject: string | null;
  schoolId: string | null;
  independentTeacherId: string | null;
  adultMode: boolean;
  chatMuted: boolean;
  collaborationLocked: boolean;
  gamesDisabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  pet: {
    id: string;
    name: string;
    species: string;
    level: number;
    experience: number;
  } | null;
  _count: {
    desks: number;
  };
}

@Injectable()
export class ClassroomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: AccessVerificationService,
  ) {}

  /**
   * Atomically creates a persistent virtual classroom together with its default
   * classroom pet, initial desk layout, and school teacher membership when applicable.
   */
  async create(actorUserId: string, dto: CreateClassroomDto): Promise<ClassroomDetailResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (dto.schoolId !== undefined && !UUID_PATTERN.test(dto.schoolId)) {
      throw new NotFoundException('School not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        id: true,
        registrationPath: true,
        schoolMemberships: {
          where: {
            state: MembershipState.ACTIVE,
            school: { deletedAt: null },
          },
          orderBy: { createdAt: 'asc' },
          select: { schoolId: true, role: true },
        },
        classroomMemberships: {
          where: {
            state: MembershipState.ACTIVE,
            deletedAt: null,
            classroom: { deletedAt: null },
          },
          select: {
            classroomId: true,
            role: true,
            classroom: { select: { schoolId: true } },
          },
        },
        parentOfLinks: {
          where: {
            state: MembershipState.ACTIVE,
            classroom: { deletedAt: null },
          },
          select: {
            classroomId: true,
            classroom: { select: { schoolId: true } },
          },
        },
        _count: {
          select: {
            independentClassrooms: { where: { deletedAt: null } },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Authentication is required');
    }

    const hasStaffOrTeacherAuthorityAnywhere =
      user.schoolMemberships.length > 0 ||
      user.classroomMemberships.some((m) => m.role === ClassroomRole.TEACHER) ||
      user._count.independentClassrooms > 0;

    const hasStudentOrParentRoleAnywhere =
      user.classroomMemberships.some((m) => m.role === ClassroomRole.STUDENT) ||
      user.parentOfLinks.length > 0;

    const isPureStudentOrParent =
      hasStudentOrParentRoleAnywhere && !hasStaffOrTeacherAuthorityAnywhere;

    let targetSchoolId: string | null = null;
    let targetIndependentTeacherId: string | null = null;
    let actorSchoolRole: SchoolRole | null = null;

    if (dto.schoolId !== undefined) {
      const school = await this.prisma.school.findFirst({
        where: { id: dto.schoolId, deletedAt: null },
        select: { id: true },
      });

      if (!school) {
        throw new NotFoundException('School not found');
      }

      const schoolMembership = user.schoolMemberships.find((m) => m.schoolId === dto.schoolId);

      if (schoolMembership) {
        targetSchoolId = dto.schoolId;
        targetIndependentTeacherId = null;
        actorSchoolRole = schoolMembership.role;
      } else {
        const isStudentOrParentInSchool =
          user.classroomMemberships.some(
            (m) => m.role === ClassroomRole.STUDENT && m.classroom.schoolId === dto.schoolId,
          ) || user.parentOfLinks.some((p) => p.classroom.schoolId === dto.schoolId);

        if (isStudentOrParentInSchool || isPureStudentOrParent) {
          throw new ForbiddenException('Students and parents cannot create classrooms');
        }

        throw new NotFoundException('School not found');
      }
    } else {
      if (user.registrationPath === RegistrationPath.SCHOOL && user.schoolMemberships.length > 0) {
        const primaryMembership = user.schoolMemberships[0];
        targetSchoolId = primaryMembership.schoolId;
        targetIndependentTeacherId = null;
        actorSchoolRole = primaryMembership.role;
      } else if (user.registrationPath === RegistrationPath.INDEPENDENT_TEACHER) {
        if (isPureStudentOrParent) {
          throw new ForbiddenException('Students and parents cannot create classrooms');
        }
        targetSchoolId = null;
        targetIndependentTeacherId = actorUserId;
      } else {
        throw new ForbiddenException('Students and parents cannot create classrooms');
      }
    }

    if ((targetSchoolId !== null) === (targetIndependentTeacherId !== null)) {
      throw new BadRequestException(
        'Classroom must belong to exactly one organization (school or independent teacher)',
      );
    }

    let myRole: ClassroomAccessRole = 'TEACHER';
    if (targetSchoolId !== null) {
      if (actorSchoolRole === SchoolRole.OWNER) {
        myRole = 'OWNER';
      } else if (actorSchoolRole === SchoolRole.ADMIN) {
        myRole = 'ADMIN';
      } else {
        myRole = 'TEACHER';
      }
    }

    const capabilities = computeClassroomCapabilities(myRole);

    const created = await this.prisma.$transaction(async (tx) => {
      const classroom = await tx.classroom.create({
        data: {
          name: dto.name,
          subject: dto.subject ?? null,
          schoolId: targetSchoolId,
          independentTeacherId: targetIndependentTeacherId,
          adultMode: dto.adultMode ?? DEFAULT_CLASSROOM_CONTROL_STATES.adultMode,
          chatMuted: DEFAULT_CLASSROOM_CONTROL_STATES.chatMuted,
          collaborationLocked: DEFAULT_CLASSROOM_CONTROL_STATES.collaborationLocked,
          gamesDisabled: DEFAULT_CLASSROOM_CONTROL_STATES.gamesDisabled,
        },
      });

      const pet = await tx.classroomPet.create({
        data: {
          classroomId: classroom.id,
          name: DEFAULT_PET_NAME,
          species: DEFAULT_PET_SPECIES,
          level: 1,
          experience: 0,
        },
      });

      const desksData = Array.from({ length: DEFAULT_INITIAL_DESK_COUNT }, (_, idx) => ({
        classroomId: classroom.id,
        deskIndex: idx + 1,
      }));

      await tx.desk.createMany({
        data: desksData,
      });

      if (targetSchoolId !== null && actorSchoolRole === SchoolRole.TEACHER) {
        await tx.classroomMembership.create({
          data: {
            classroomId: classroom.id,
            userId: actorUserId,
            role: ClassroomRole.TEACHER,
            state: MembershipState.ACTIVE,
          },
        });
      }

      return {
        ...classroom,
        pet,
        _count: { desks: DEFAULT_INITIAL_DESK_COUNT },
      };
    });

    return this.toDetailResponse(created, myRole, capabilities);
  }

  /**
   * Retrieves the classroom detail and server-derived role/capabilities for the actor.
   * Responds 404 if the classroom does not exist or the actor has no valid access.
   */
  async findOne(actorUserId: string, classroomId: string): Promise<ClassroomDetailResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (!UUID_PATTERN.test(classroomId)) {
      throw new NotFoundException('Classroom not found');
    }

    const access = await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'ANY',
    });

    const classroom = await this.prisma.classroom.findFirst({
      where: { id: classroomId, deletedAt: null },
      include: {
        pet: true,
        _count: { select: { desks: true } },
      },
    });

    if (!classroom) {
      throw new NotFoundException('Classroom not found');
    }

    return this.toDetailResponse(classroom, access.myRole, access.capabilities);
  }

  /**
   * Updates classroom configuration (name, subject, adultMode, chatMuted,
   * collaborationLocked, gamesDisabled). Restricted to STAFF of the classroom
   * (School Owner/Admin or the classroom's Teacher).
   */
  async update(
    actorUserId: string,
    classroomId: string,
    dto: UpdateClassroomDto,
  ): Promise<ClassroomDetailResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    if (!UUID_PATTERN.test(classroomId)) {
      throw new NotFoundException('Classroom not found');
    }

    const access = await this.accessService.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STAFF',
    });

    const updateData: Prisma.ClassroomUpdateInput = {};
    if (dto.name !== undefined && dto.name !== null) {
      updateData.name = dto.name;
    }
    if (dto.subject !== undefined) {
      updateData.subject = dto.subject;
    }
    if (dto.adultMode !== undefined && dto.adultMode !== null) {
      updateData.adultMode = dto.adultMode;
    }
    if (dto.chatMuted !== undefined && dto.chatMuted !== null) {
      updateData.chatMuted = dto.chatMuted;
    }
    if (dto.collaborationLocked !== undefined && dto.collaborationLocked !== null) {
      updateData.collaborationLocked = dto.collaborationLocked;
    }
    if (dto.gamesDisabled !== undefined && dto.gamesDisabled !== null) {
      updateData.gamesDisabled = dto.gamesDisabled;
    }

    const updated = await this.prisma.classroom.update({
      where: { id: classroomId },
      data: updateData,
      include: {
        pet: true,
        _count: { select: { desks: true } },
      },
    });

    return this.toDetailResponse(updated, access.myRole, access.capabilities);
  }

  /**
   * Lists classrooms accessible to the authenticated actor with deterministic
   * ordering and offset pagination, deriving `myRole` and `capabilities` per item.
   */
  async listForActor(
    actorUserId: string,
    query: ListClassroomsQueryDto,
  ): Promise<PaginatedClassroomsResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    const page = query.page ?? DEFAULT_CLASSROOMS_PAGE;
    const limit = query.limit ?? DEFAULT_CLASSROOMS_LIMIT;
    const order = query.order ?? 'desc';

    const schoolMemberships = await this.prisma.schoolMember.findMany({
      where: {
        userId: actorUserId,
        state: MembershipState.ACTIVE,
        school: { deletedAt: null },
      },
      select: { schoolId: true, role: true },
    });

    const ownerOrAdminRoles = new Map<string, 'OWNER' | 'ADMIN'>();
    const activeSchoolIds = new Set<string>();

    for (const sm of schoolMemberships) {
      activeSchoolIds.add(sm.schoolId);
      if (sm.role === SchoolRole.OWNER) {
        ownerOrAdminRoles.set(sm.schoolId, 'OWNER');
      } else if (sm.role === SchoolRole.ADMIN) {
        ownerOrAdminRoles.set(sm.schoolId, 'ADMIN');
      }
    }

    const orFilters: Prisma.ClassroomWhereInput[] = [];

    if (ownerOrAdminRoles.size > 0) {
      orFilters.push({
        schoolId: { in: Array.from(ownerOrAdminRoles.keys()) },
        school: { deletedAt: null },
      });
    }

    orFilters.push({
      independentTeacherId: actorUserId,
    });

    orFilters.push({
      schoolId: null,
      memberships: {
        some: {
          userId: actorUserId,
          role: ClassroomRole.TEACHER,
          state: MembershipState.ACTIVE,
          deletedAt: null,
        },
      },
    });

    if (activeSchoolIds.size > 0) {
      orFilters.push({
        schoolId: { in: Array.from(activeSchoolIds) },
        school: { deletedAt: null },
        memberships: {
          some: {
            userId: actorUserId,
            role: ClassroomRole.TEACHER,
            state: MembershipState.ACTIVE,
            deletedAt: null,
          },
        },
      });
    }

    orFilters.push({
      memberships: {
        some: {
          userId: actorUserId,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
          deletedAt: null,
        },
      },
      OR: [{ schoolId: null }, { school: { deletedAt: null } }],
    });

    orFilters.push({
      adultMode: false,
      parentLinks: {
        some: {
          parentId: actorUserId,
          state: MembershipState.ACTIVE,
        },
      },
      OR: [{ schoolId: null }, { school: { deletedAt: null } }],
    });

    const where: Prisma.ClassroomWhereInput = {
      deletedAt: null,
      OR: orFilters,
    };

    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      this.prisma.classroom.count({ where }),
      this.prisma.classroom.findMany({
        where,
        orderBy: [{ createdAt: order }, { id: 'asc' }],
        skip,
        take: limit,
        include: {
          memberships: {
            where: {
              userId: actorUserId,
              state: MembershipState.ACTIVE,
              deletedAt: null,
            },
            select: { role: true },
          },
          parentLinks: {
            where: {
              parentId: actorUserId,
              state: MembershipState.ACTIVE,
            },
            select: { id: true },
          },
        },
      }),
    ]);

    const items: ClassroomListItemDto[] = rows.map((row) => {
      const myRole = this.resolveRoleForListedClassroom(
        actorUserId,
        row,
        ownerOrAdminRoles,
        activeSchoolIds,
      );
      const capabilities = computeClassroomCapabilities(myRole);

      return {
        id: row.id,
        name: row.name,
        subject: row.subject ?? null,
        schoolId: row.schoolId,
        independentTeacherId: row.independentTeacherId,
        adultMode: row.adultMode,
        chatMuted: row.chatMuted,
        collaborationLocked: row.collaborationLocked,
        gamesDisabled: row.gamesDisabled,
        myRole,
        capabilities,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      items,
      page,
      limit,
      total,
      totalPages,
    };
  }

  private resolveRoleForListedClassroom(
    actorUserId: string,
    classroom: {
      schoolId: string | null;
      independentTeacherId: string | null;
      adultMode: boolean;
      memberships: { role: ClassroomRole }[];
      parentLinks: { id: string }[];
    },
    ownerOrAdminRoles: Map<string, 'OWNER' | 'ADMIN'>,
    activeSchoolIds: Set<string>,
  ): ClassroomAccessRole {
    if (classroom.schoolId !== null && ownerOrAdminRoles.has(classroom.schoolId)) {
      return ownerOrAdminRoles.get(classroom.schoolId)!;
    }

    if (classroom.independentTeacherId !== null && classroom.independentTeacherId === actorUserId) {
      return 'TEACHER';
    }

    const hasTeacherMembership = classroom.memberships.some(
      (m) => m.role === ClassroomRole.TEACHER,
    );
    if (
      hasTeacherMembership &&
      (classroom.schoolId === null || activeSchoolIds.has(classroom.schoolId))
    ) {
      return 'TEACHER';
    }

    const hasStudentMembership = classroom.memberships.some(
      (m) => m.role === ClassroomRole.STUDENT,
    );
    if (hasStudentMembership) {
      return 'STUDENT';
    }

    if (!classroom.adultMode && classroom.parentLinks.length > 0) {
      return 'PARENT';
    }

    return 'STUDENT';
  }

  private toDetailResponse(
    classroom: ClassroomWithDetails,
    myRole: ClassroomAccessRole,
    capabilities: ClassroomCapability[],
  ): ClassroomDetailResponseDto {
    return {
      id: classroom.id,
      name: classroom.name,
      subject: classroom.subject ?? null,
      schoolId: classroom.schoolId,
      independentTeacherId: classroom.independentTeacherId,
      adultMode: classroom.adultMode,
      chatMuted: classroom.chatMuted,
      collaborationLocked: classroom.collaborationLocked,
      gamesDisabled: classroom.gamesDisabled,
      deskCount: classroom._count.desks,
      pet: classroom.pet
        ? {
            id: classroom.pet.id,
            name: classroom.pet.name,
            species: classroom.pet.species,
            level: classroom.pet.level,
            experience: classroom.pet.experience,
          }
        : null,
      myRole,
      capabilities,
      createdAt: classroom.createdAt.toISOString(),
      updatedAt: classroom.updatedAt.toISOString(),
    };
  }
}
