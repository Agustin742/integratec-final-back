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
import type { ListMaterialsQueryDto, MaterialDto } from './materials.dto';

const PUBLIC_SELECT = {
  id: true,
  classroomId: true,
  authorId: true,
  filename: true,
  contentType: true,
  sizeBytes: true,
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
  ) {}

  private async authorize(actorId: string, classroomId: string, write = false) {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: write ? 'STAFF' : 'ANY',
    });
    if (access.myRole === 'PARENT')
      throw new ForbiddenException('Material is for staff and students');
    return access;
  }

  async upload(actorId: string, classroomId: string, file: MaterialFile | undefined) {
    await this.authorize(actorId, classroomId, true);
    const metadata = validateMaterialFile(file);
    const id = randomUUID();
    const objectKey = `materials/${classroomId}/${id}`;
    assertSafeStorageKey(objectKey);
    try {
      await this.storage.put(objectKey, file!.buffer, { contentType: metadata.contentType });
      const row = await this.prisma.studyMaterial.create({
        data: { id, classroomId, authorId: actorId, objectKey, ...metadata },
        select: PUBLIC_SELECT,
      });
      return toDto(row);
    } catch {
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
    const where = { classroomId, removedAt: null };
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

  async remove(actorId: string, classroomId: string, materialId: string) {
    const material = await this.resolve(actorId, classroomId, materialId, true);
    const result = await this.prisma.studyMaterial.updateMany({
      where: { id: material.id, classroomId: material.classroomId, removedAt: null },
      data: { removedAt: new Date(), removedById: actorId },
    });
    if (result.count === 0) throw new NotFoundException('Material not found');
  }
}
