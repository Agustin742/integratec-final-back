import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { BotMaterialsService } from '../bot/bot-materials.service';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { paginated, toSkipTake } from '../http/pagination/paginated';
import { parseSort } from '../http/pagination/sort';
import {
  assertSafeStorageKey,
  STORAGE_PORT,
  type StoragePort,
} from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { validateMaterialFile, type MaterialFile } from './material-file';
import { lockActiveModule } from './material-module-lock';
import { authorizeMaterialAccess } from './material-access';
import { UNASSIGNED_FILTER, type ListMaterialsQueryDto, type MaterialDto } from './materials.dto';

const PUBLIC_SELECT = {
  id: true,
  classroomId: true,
  authorId: true,
  filename: true,
  contentType: true,
  sizeBytes: true,
  moduleId: true,
  createdAt: true,
} satisfies Prisma.StudyMaterialSelect;
type PublicRow = Prisma.StudyMaterialGetPayload<{ select: typeof PUBLIC_SELECT }>;
const toDto = (row: PublicRow): MaterialDto => ({ ...row, createdAt: row.createdAt.toISOString() });

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly botMaterials: BotMaterialsService,
  ) {}

  private authorize(actorId: string, classroomId: string, write = false) {
    return authorizeMaterialAccess(this.access, actorId, classroomId, write);
  }

  /** A module filter or target must be an active module of the same classroom. */
  private async assertActiveModule(classroomId: string, moduleId: string) {
    if (!UUID_PATTERN.test(moduleId)) throw new NotFoundException('Module not found');
    const module = await this.prisma.materialModule.findFirst({
      where: { id: moduleId, classroomId, removedAt: null },
      select: { id: true },
    });
    if (!module) throw new NotFoundException('Module not found');
  }

  async upload(
    actorId: string,
    classroomId: string,
    file: MaterialFile | undefined,
    moduleId?: string,
  ) {
    await this.authorize(actorId, classroomId, true);
    const metadata = validateMaterialFile(file);
    if (moduleId) await this.assertActiveModule(classroomId, moduleId);
    const id = randomUUID();
    const objectKey = `materials/${classroomId}/${id}`;
    assertSafeStorageKey(objectKey);
    let stored = false;
    let createStarted = false;
    try {
      await this.storage.put(objectKey, file!.buffer, { contentType: metadata.contentType });
      stored = true;
      const data = { id, classroomId, authorId: actorId, objectKey, ...metadata };
      // Plain uploads keep the single nontransactional insert; placing it in a module also
      // share-locks the module so a concurrent module removal cannot strand the material.
      let row: PublicRow;
      if (moduleId) {
        row = await this.prisma.$transaction(async (tx) => {
          await lockActiveModule(tx, classroomId, moduleId);
          createStarted = true;
          return tx.studyMaterial.create({ data: { ...data, moduleId }, select: PUBLIC_SELECT });
        });
      } else {
        createStarted = true;
        row = await this.prisma.studyMaterial.create({ data, select: PUBLIC_SELECT });
      }
      return toDto(row);
    } catch (error) {
      // The module was removed after validation and before any DB write began: a definite
      // refusal, so clean up the newly uploaded object on a best-effort basis.
      if (error instanceof NotFoundException) {
        if (stored && !createStarted) {
          await this.storage.delete(objectKey).catch(() => undefined);
        }
        throw error;
      }
      // Either system may have committed before a timeout. Never delete here: that could
      // break a committed material. Reconcile the possible private orphan operationally.
      throw new ServiceUnavailableException(
        'Upload outcome uncertain; refresh the material list before retrying',
      );
    }
  }

  async list(actorId: string, classroomId: string, query: ListMaterialsQueryDto) {
    await this.authorize(actorId, classroomId);
    const { field, direction } = parseSort(query.sort, {
      allowed: ['createdAt'] as const,
      default: { field: 'createdAt', direction: 'desc' },
    });
    const filter = query.moduleId;
    if (filter && filter !== UNASSIGNED_FILTER) await this.assertActiveModule(classroomId, filter);
    const where = {
      classroomId,
      removedAt: null,
      ...(filter && { moduleId: filter === UNASSIGNED_FILTER ? null : filter }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.studyMaterial.findMany({
        where,
        select: PUBLIC_SELECT,
        ...toSkipTake(query),
        orderBy: [{ [field]: direction }, { id: direction }],
      }),
      this.prisma.studyMaterial.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  private async resolve(actorId: string, classroomId: string, materialId: string, write = false) {
    if (!UUID_PATTERN.test(classroomId)) {
      throw new NotFoundException('Material not found');
    }
    // Verify classroom membership and reject parents before reading the material row so
    // parents cannot use 403 vs 404 to probe whether a materialId exists in the classroom.
    const access = await this.authorize(actorId, classroomId);
    if (!UUID_PATTERN.test(materialId)) {
      throw new NotFoundException('Material not found');
    }
    const row = await this.prisma.studyMaterial.findFirst({
      where: { id: materialId, classroomId, removedAt: null },
      select: { id: true, classroomId: true, objectKey: true },
    });
    if (!row) throw new NotFoundException('Material not found');
    if (write && access.myRole === 'STUDENT') {
      throw new ForbiddenException('Material write requires staff authority');
    }
    return row;
  }

  /** Moves a material to a module of the same classroom, or to unassigned with null. */
  async move(actorId: string, classroomId: string, materialId: string, moduleId: string | null) {
    const material = await this.resolve(actorId, classroomId, materialId, true);
    return this.prisma.$transaction(async (tx) => {
      if (moduleId) await lockActiveModule(tx, classroomId, moduleId);
      const result = await tx.studyMaterial.updateMany({
        where: { id: material.id, classroomId, removedAt: null },
        data: { moduleId },
      });
      if (result.count === 0) throw new NotFoundException('Material not found');
      return toDto(
        await tx.studyMaterial.findUniqueOrThrow({
          where: { id: material.id },
          select: PUBLIC_SELECT,
        }),
      );
    });
  }

  async download(actorId: string, classroomId: string, materialId: string) {
    const material = await this.resolve(actorId, classroomId, materialId);
    assertSafeStorageKey(material.objectKey);
    try {
      const expiresInSeconds = this.config.storageSignedUrlTtlSeconds;
      const url = await this.storage.getSignedDownloadUrl(material.objectKey, { expiresInSeconds });
      return { url, expiresInSeconds };
    } catch {
      throw new ServiceUnavailableException('Download temporarily unavailable');
    }
  }

  /**
   * Soft-removes a material and excludes it from the classroom bot: the allowed
   * rows are deleted in the same transaction, then the index partition is
   * cleaned after commit. A cleanup failure never fails the removal.
   */
  async remove(actorId: string, classroomId: string, materialId: string) {
    const material = await this.resolve(actorId, classroomId, materialId, true);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.studyMaterial.updateMany({
        where: { id: material.id, classroomId: material.classroomId, removedAt: null },
        data: { removedAt: new Date(), removedById: actorId },
      });
      if (result.count === 0) throw new NotFoundException('Material not found');
      await this.botMaterials.excludeRemovedMaterial(tx, material.classroomId, material.id);
    });
    await this.botMaterials.deindexRemovedMaterial(material.classroomId, material.id);
  }
}
