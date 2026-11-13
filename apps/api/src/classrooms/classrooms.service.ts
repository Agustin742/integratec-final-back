import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ClassroomRole, MembershipState, type Prisma, SchoolRole } from '@prisma/client';
import {
  AccessVerificationService,
  computeClassroomPanels,
  type ClassroomAccessRole,
  type ClassroomCapability,
  UUID_PATTERN,
} from '../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import type { Sort } from '../http/pagination/sort';
import { RequestValidationException } from '../http/validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_CLASSROOM_CONTROL_STATES,
  DEFAULT_INITIAL_DESK_COUNT,
  DEFAULT_PET_NAME,
  DEFAULT_PET_SPECIES,
} from './classrooms.constants';
import type {
  ClassroomContextResponseDto,
  ClassroomDetailResponseDto,
  ClassroomListItemDto,
} from './dto/classroom-response.dto';
import type { ClassroomSortField } from './dto/list-classrooms-query.dto';
import type { CreateClassroomDto } from './dto/create-classroom.dto';
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

    const target = await this.accessService.resolveClassroomCreationTarget(
      actorUserId,
      dto.schoolId,
    );

    if ((target.schoolId !== null) === (target.independentTeacherId !== null)) {
      throw new BadRequestException(
        'Classroom must belong to exactly one organization (school or independent teacher)',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const classroom = await tx.classroom.create({
        data: {
          name: dto.name,
          subject: dto.subject ?? null,
          schoolId: target.schoolId,
          independentTeacherId: target.independentTeacherId,
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

      if (target.schoolId !== null && target.schoolRole === SchoolRole.TEACHER) {
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

    return this.toDetailResponse(created, target.myRole, target.capabilities);
  }

  /**
   * Retrieves the classroom detail and server-derived role/capabilities for the actor.
   * Responds 404 if the classroom does not exist or the actor has no valid access.
   */
  async findOne(actorUserId: string, classroomId: string): Promise<ClassroomContextResponseDto> {
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

    return {
      ...this.toDetailResponse(classroom, access.myRole, access.capabilities),
      availablePanels: computeClassroomPanels(access.myRole),
    };
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

    if (Object.values(dto).every((value) => value === undefined)) {
      throw new RequestValidationException([
        { field: 'body', messages: ['Provide at least one field to update'] },
      ]);
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
   * ordering and offset pagination. Accessibility, `myRole` and `capabilities` come
   * from the shared access service, so they agree with `GET /classrooms/:id`.
   */
  async listForActor(
    actorUserId: string,
    query: { page: number; pageSize: number; sort: Sort<ClassroomSortField> },
  ): Promise<Paginated<ClassroomListItemDto>> {
    if (!UUID_PATTERN.test(actorUserId)) {
      throw new UnauthorizedException('Authentication is required');
    }

    const { skip, take } = toSkipTake(query);
    const { total, items: accessible } = await this.accessService.listAccessibleClassrooms(
      actorUserId,
      { skip, take, sort: query.sort },
    );

    const items: ClassroomListItemDto[] = accessible.map(({ classroom, myRole, capabilities }) => ({
      id: classroom.id,
      name: classroom.name,
      subject: classroom.subject ?? null,
      schoolId: classroom.schoolId,
      independentTeacherId: classroom.independentTeacherId,
      adultMode: classroom.adultMode,
      chatMuted: classroom.chatMuted,
      collaborationLocked: classroom.collaborationLocked,
      gamesDisabled: classroom.gamesDisabled,
      myRole,
      capabilities,
      createdAt: classroom.createdAt.toISOString(),
      updatedAt: classroom.updatedAt.toISOString(),
    }));

    return paginated(items, total, query);
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
