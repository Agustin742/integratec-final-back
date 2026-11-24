import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { RequestValidationException } from '../http/validation';
import { PrismaService } from '../prisma/prisma.service';
import { authorizeMaterialAccess } from './material-access';
import {
  MATERIAL_MODULE_LIMITS,
  type CreateMaterialModuleDto,
  type MaterialModuleDto,
  type ReorderMaterialModulesDto,
  type UpdateMaterialModuleDto,
} from './material-modules.dto';

const MODULE_SELECT = {
  id: true,
  classroomId: true,
  name: true,
  description: true,
  position: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { materials: { where: { removedAt: null } } } },
} satisfies Prisma.MaterialModuleSelect;
type ModuleRow = Prisma.MaterialModuleGetPayload<{ select: typeof MODULE_SELECT }>;

const toDto = ({ _count, ...row }: ModuleRow): MaterialModuleDto => ({
  ...row,
  materialCount: _count.materials,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

const emptyToNull = (value: string | null | undefined) => (value ? value : null);

/**
 * Ordered, single-level modules that group a classroom's study materials. Visibility
 * mirrors materials (staff and students read; teacher-level staff write; parents denied).
 * Removing a module is logical and moves its materials back to unassigned.
 */
@Injectable()
export class MaterialModulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  private active(classroomId: string) {
    return { classroomId, removedAt: null } satisfies Prisma.MaterialModuleWhereInput;
  }

  private async resolve(actorId: string, classroomId: string, moduleId: string) {
    // Authorize before reading the module so a 403/404 never reveals module existence.
    await authorizeMaterialAccess(this.access, actorId, classroomId, true);
    if (!UUID_PATTERN.test(moduleId)) throw new NotFoundException('Module not found');
    const row = await this.prisma.materialModule.findFirst({
      where: { id: moduleId, ...this.active(classroomId) },
      select: { id: true },
    });
    if (!row) throw new NotFoundException('Module not found');
    return row;
  }

  private async listRows(classroomId: string) {
    return this.prisma.materialModule.findMany({
      where: this.active(classroomId),
      select: MODULE_SELECT,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  async list(actorId: string, classroomId: string) {
    await authorizeMaterialAccess(this.access, actorId, classroomId);
    return { items: (await this.listRows(classroomId)).map(toDto) };
  }

  async create(actorId: string, classroomId: string, dto: CreateMaterialModuleDto) {
    await authorizeMaterialAccess(this.access, actorId, classroomId, true);
    const row = await this.prisma.$transaction(async (tx) => {
      const { _max, _count } = await tx.materialModule.aggregate({
        where: this.active(classroomId),
        _max: { position: true },
        _count: { _all: true },
      });
      if (_count._all >= MATERIAL_MODULE_LIMITS.maxModules) {
        throw new ConflictException(
          `A classroom can have at most ${MATERIAL_MODULE_LIMITS.maxModules} modules`,
        );
      }
      return tx.materialModule.create({
        data: {
          classroomId,
          name: dto.name,
          description: emptyToNull(dto.description),
          position: (_max.position ?? -1) + 1,
        },
        select: MODULE_SELECT,
      });
    });
    return toDto(row);
  }

  async update(
    actorId: string,
    classroomId: string,
    moduleId: string,
    dto: UpdateMaterialModuleDto,
  ) {
    const module = await this.resolve(actorId, classroomId, moduleId);
    if (dto.name === undefined && dto.description === undefined) {
      throw new RequestValidationException([
        { field: 'name', messages: ['Provide name or description to update'] },
      ]);
    }
    const result = await this.prisma.materialModule.updateMany({
      where: { id: module.id, ...this.active(classroomId) },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: emptyToNull(dto.description) }),
      },
    });
    if (result.count === 0) throw new NotFoundException('Module not found');
    return toDto(
      await this.prisma.materialModule.findUniqueOrThrow({
        where: { id: module.id },
        select: MODULE_SELECT,
      }),
    );
  }

  async reorder(actorId: string, classroomId: string, dto: ReorderMaterialModulesDto) {
    await authorizeMaterialAccess(this.access, actorId, classroomId, true);
    await this.prisma.$transaction(async (tx) => {
      // Lock the classroom's active modules so concurrent reorders serialize.
      const current = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM material_modules
        WHERE classroom_id = ${classroomId}::uuid AND removed_at IS NULL
        ORDER BY id FOR UPDATE`);
      const wanted = new Set(dto.moduleIds);
      const exact =
        wanted.size === dto.moduleIds.length &&
        wanted.size === current.length &&
        current.every((row) => wanted.has(row.id));
      if (!exact) {
        throw new RequestValidationException([
          {
            field: 'moduleIds',
            messages: ['Send every active module of the classroom exactly once'],
          },
        ]);
      }
      for (const [position, id] of dto.moduleIds.entries()) {
        await tx.materialModule.update({ where: { id }, data: { position } });
      }
    });
    return { items: (await this.listRows(classroomId)).map(toDto) };
  }

  /** Logical removal; the module's materials return to unassigned in the same transaction. */
  async remove(actorId: string, classroomId: string, moduleId: string) {
    const module = await this.resolve(actorId, classroomId, moduleId);
    await this.prisma.$transaction(async (tx) => {
      // Module row first: it waits for in-flight uploads/moves that share-lock it.
      const result = await tx.materialModule.updateMany({
        where: { id: module.id, ...this.active(classroomId) },
        data: { removedAt: new Date(), removedById: actorId },
      });
      if (result.count === 0) throw new NotFoundException('Module not found');
      await tx.studyMaterial.updateMany({
        where: { moduleId: module.id },
        data: { moduleId: null },
      });
    });
  }
}
