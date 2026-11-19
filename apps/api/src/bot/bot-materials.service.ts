import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MaterialIndexState, Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { paginated, toSkipTake } from '../http/pagination/paginated';
import { parseSort } from '../http/pagination/sort';
import { PrismaService } from '../prisma/prisma.service';
import type { BotMaterialDto, ListBotMaterialsQueryDto } from './bot-materials.dto';
import { MATERIAL_INDEX_PORT, type MaterialIndexPort } from './material-index.port';

const PUBLIC_SELECT = {
  id: true,
  classroomId: true,
  materialId: true,
  indexState: true,
  failureReason: true,
  createdAt: true,
  material: { select: { filename: true, contentType: true, sizeBytes: true } },
} satisfies Prisma.AllowedMaterialSelect;
type PublicRow = Prisma.AllowedMaterialGetPayload<{ select: typeof PUBLIC_SELECT }>;
const toDto = (row: PublicRow): BotMaterialDto => ({
  id: row.id,
  classroomId: row.classroomId,
  materialId: row.materialId,
  filename: row.material.filename,
  contentType: row.material.contentType,
  sizeBytes: row.material.sizeBytes,
  indexState: row.indexState,
  failureReason: row.failureReason,
  createdAt: row.createdAt.toISOString(),
});

/** Fixed, non-diagnostic reason recorded when indexing fails. */
const INDEX_FAILURE_REASON =
  'Indexing failed. The material stays available for the classroom; retry enabling it to index it again.';

@Injectable()
export class BotMaterialsService {
  private readonly logger = new Logger(BotMaterialsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    @Inject(MATERIAL_INDEX_PORT) private readonly index: MaterialIndexPort,
  ) {}

  /**
   * Teacher-level authorization with this card's explicit concealment policy:
   * every actor without teacher-level authority over the classroom answers 404,
   * including enrolled students and linked parents, so the bot's material choice
   * is never revealed (issue #40; `rules/classrooms-and-roles.md`).
   */
  private async authorize(actorId: string, classroomId: string) {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId);
    if (access.myRole !== 'OWNER' && access.myRole !== 'ADMIN' && access.myRole !== 'TEACHER') {
      throw new NotFoundException('Classroom not found');
    }
    return access;
  }

  /**
   * Enables a material for the classroom bot. The material must belong to this
   * classroom and not be soft-removed; the allowed-material row and the
   * classroom's bot config are upserted in one transaction, then the material is
   * indexed under the classroom partition. A duplicate enable is idempotent: it
   * re-indexes from scratch (the port contract forbids reusing earlier chunks).
   * Indexing failure is recorded as a visible FAILED state and never touches the
   * material itself (`rules/ai-bot-and-daily-briefing.md`).
   */
  async enable(actorId: string, classroomId: string, materialId: string): Promise<BotMaterialDto> {
    await this.authorize(actorId, classroomId);
    const material = await this.resolveMaterial(classroomId, materialId);
    const row = await this.prisma.$transaction(async (tx) => {
      const config = await tx.botConfig.upsert({
        where: { classroomId },
        create: { classroomId },
        update: {},
        select: { id: true },
      });
      return tx.allowedMaterial.upsert({
        where: { classroomId_materialId: { classroomId, materialId } },
        create: { botConfigId: config.id, classroomId, materialId },
        update: { indexState: MaterialIndexState.PENDING, failureReason: null },
        select: { id: true },
      });
    });
    let indexState: MaterialIndexState;
    let failureReason: string | null = null;
    try {
      await this.index.index({
        classroomId,
        materialId,
        objectKey: material.objectKey,
        filename: material.filename,
        contentType: material.contentType,
      });
      indexState = MaterialIndexState.INDEXED;
    } catch {
      // The stored reason is the fixed message above, never the provider error.
      indexState = MaterialIndexState.FAILED;
      failureReason = INDEX_FAILURE_REASON;
    }
    // If this final write fails the row stays PENDING; a re-enable retries safely.
    return toDto(
      await this.prisma.allowedMaterial.update({
        where: { id: row.id },
        data: { indexState, failureReason },
        select: PUBLIC_SELECT,
      }),
    );
  }

  /**
   * Disables a material for the classroom bot. The database row is the authority
   * for exclusion (the future retrieval filters by the allowed rows), so deleting
   * it excludes the material from the next request immediately; the index
   * partition is cleaned up through the port afterwards.
   */
  async disable(actorId: string, classroomId: string, materialId: string): Promise<void> {
    await this.authorize(actorId, classroomId);
    if (!UUID_PATTERN.test(materialId)) {
      throw new NotFoundException('Material not found');
    }
    const removed = await this.prisma.allowedMaterial.deleteMany({
      where: { classroomId, materialId },
    });
    if (removed.count === 0) {
      throw new NotFoundException('Material not found');
    }
    try {
      await this.index.remove(classroomId, materialId);
    } catch {
      // The row is already gone, so the material is excluded from the bot either
      // way; only the partition cleanup is pending and a re-enable re-indexes.
      throw new ServiceUnavailableException(
        'Bot material removal is temporarily unavailable; the material is already excluded',
      );
    }
  }

  /**
   * Called by the materials module when a study material is soft-removed. The
   * allowed rows are the exclusion authority, so they are deleted inside the
   * caller's transaction: a removed material is never left with an allowed row.
   */
  async excludeRemovedMaterial(
    tx: Prisma.TransactionClient,
    classroomId: string,
    materialId: string,
  ): Promise<void> {
    await tx.allowedMaterial.deleteMany({ where: { classroomId, materialId } });
  }

  /**
   * Cleans the index partition after {@link excludeRemovedMaterial} committed.
   * Never throws: the material is already excluded, so a cleanup failure must
   * not fail the material removal; it is logged and a re-enable re-indexes.
   */
  async deindexRemovedMaterial(classroomId: string, materialId: string): Promise<void> {
    try {
      await this.index.remove(classroomId, materialId);
    } catch {
      // Fixed message only: provider errors may carry diagnostics.
      this.logger.warn(
        `Bot index cleanup failed for removed material ${materialId} in classroom ${classroomId}; it is already excluded`,
      );
    }
  }

  /**
   * Lists the classroom's allowed bot materials with their indexing state. Rows
   * whose material was soft-removed after enabling are excluded, matching the
   * classroom material list, and remain removable through the disable endpoint.
   */
  async list(actorId: string, classroomId: string, query: ListBotMaterialsQueryDto) {
    await this.authorize(actorId, classroomId);
    const { field, direction } = parseSort(query.sort, {
      allowed: ['createdAt'] as const,
      default: { field: 'createdAt', direction: 'desc' },
    });
    const where = { classroomId, material: { removedAt: null } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.allowedMaterial.findMany({
        where,
        select: PUBLIC_SELECT,
        ...toSkipTake(query),
        orderBy: [{ [field]: direction }, { id: direction }],
      }),
      this.prisma.allowedMaterial.count({ where }),
    ]);
    return paginated(rows.map(toDto), total, query);
  }

  /** Resolves an active material of this classroom; foreign and removed ids 404. */
  private async resolveMaterial(classroomId: string, materialId: string) {
    if (!UUID_PATTERN.test(materialId)) {
      throw new NotFoundException('Material not found');
    }
    const material = await this.prisma.studyMaterial.findFirst({
      where: { id: materialId, classroomId, removedAt: null },
      select: { id: true, objectKey: true, filename: true, contentType: true },
    });
    if (!material) {
      throw new NotFoundException('Material not found');
    }
    return material;
  }
}
