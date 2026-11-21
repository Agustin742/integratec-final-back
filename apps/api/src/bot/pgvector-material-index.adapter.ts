import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_AI_CHUNK_MAX_CHARS,
  DEFAULT_AI_CHUNK_OVERLAP_CHARS,
  DEFAULT_AI_EMBEDDING_DIMENSION,
  type ApiConfig,
} from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { EMBEDDING_MODEL_PORT, type EmbeddingModelPort } from './ai-provider.ports';
import type { MaterialIndexEntry, MaterialIndexPort } from './material-index.port';
import type {
  MaterialRetrievalPort,
  MaterialRetrievalQuery,
  RetrievedChunk,
} from './material-retrieval.port';
import { chunkExtractedSections } from './text-chunker';
import { EmptyExtractedTextError, TextExtractorService } from './text-extractor.service';

/** Matches the `embedding vector(768)` column defined in migration `create_material_chunks`. */
export const DB_EMBEDDING_DIMENSION = 768;

const EMBEDDING_BATCH_SIZE = 32;

/** Formats a validated vector into a safe pgvector literal (`[n1,n2,...]`). */
export function formatVectorLiteral(vector: readonly number[], expectedDimension: number): string {
  if (vector.length !== expectedDimension) {
    throw new Error(
      `Embedding dimension ${vector.length} does not match vector(${expectedDimension})`,
    );
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error('Embedding vector must contain only finite numbers');
    }
  }
  return `[${vector.join(',')}]`;
}

/**
 * PostgreSQL + pgvector implementation of both {@link MaterialIndexPort} and
 * {@link MaterialRetrievalPort}, keeping every chunk partitioned by
 * `(classroom_id, material_id)` and verifying server-side `allowed_materials`
 * and non-removed `study_materials` at retrieval time.
 */
@Injectable()
export class PgVectorMaterialIndexAdapter implements MaterialIndexPort, MaterialRetrievalPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    private readonly extractor: TextExtractorService,
    @Inject(EMBEDDING_MODEL_PORT) private readonly embeddings: EmbeddingModelPort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  async index(entry: MaterialIndexEntry): Promise<void> {
    this.assertMatchingSchemaDimension();

    const stored = await this.storage.get(entry.objectKey);
    const sections = await this.extractor.extract(stored.body, entry.contentType);
    const chunks = chunkExtractedSections(sections, {
      maxChars: this.config.aiChunkMaxChars ?? DEFAULT_AI_CHUNK_MAX_CHARS,
      overlapChars: this.config.aiChunkOverlapChars ?? DEFAULT_AI_CHUNK_OVERLAP_CHARS,
    });
    if (chunks.length === 0) {
      throw new EmptyExtractedTextError();
    }

    const vectors: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      const batchTexts = chunks
        .slice(offset, offset + EMBEDDING_BATCH_SIZE)
        .map((chunk) => chunk.content);
      const result = await this.embeddings.embed(batchTexts);
      if (result.vectors.length !== batchTexts.length) {
        throw new Error('Embedding count mismatch');
      }
      vectors.push(...result.vectors);
    }

    const literals = vectors.map((vector) => formatVectorLiteral(vector, DB_EMBEDDING_DIMENSION));

    // Full replacement inside one transaction: a re-enable never reuses earlier chunks.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        DELETE FROM "material_chunks"
        WHERE "classroom_id" = ${entry.classroomId}::uuid
          AND "material_id" = ${entry.materialId}::uuid`;

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]!;
        const vectorLiteral = literals[i]!;
        await tx.$executeRaw`
          INSERT INTO "material_chunks" (
            "id",
            "classroom_id",
            "material_id",
            "chunk_index",
            "content",
            "position",
            "embedding"
          ) VALUES (
            ${randomUUID()}::uuid,
            ${entry.classroomId}::uuid,
            ${entry.materialId}::uuid,
            ${chunk.chunkIndex},
            ${chunk.content},
            ${chunk.position},
            ${vectorLiteral}::vector
          )`;
      }
    });
  }

  async remove(classroomId: string, materialId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM "material_chunks"
      WHERE "classroom_id" = ${classroomId}::uuid
        AND "material_id" = ${materialId}::uuid`;
  }

  async isIndexed(classroomId: string, materialId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ found: number }[]>`
      SELECT 1 AS "found"
      FROM "material_chunks"
      WHERE "classroom_id" = ${classroomId}::uuid
        AND "material_id" = ${materialId}::uuid
      LIMIT 1`;
    return rows.length > 0;
  }

  async search(query: MaterialRetrievalQuery): Promise<RetrievedChunk[]> {
    this.assertMatchingSchemaDimension();
    const vectorLiteral = formatVectorLiteral(query.queryEmbedding, DB_EMBEDDING_DIMENSION);
    const topK = Math.max(1, Math.min(20, Math.floor(query.topK)));
    const minSimilarity = Math.max(0, Math.min(1, query.minSimilarity));

    return this.prisma.$queryRaw<RetrievedChunk[]>`
      SELECT
        mc."id"::text AS "chunkId",
        mc."material_id"::text AS "materialId",
        sm."filename" AS "filename",
        mc."position" AS "position",
        mc."content" AS "content",
        (1 - (mc."embedding" <=> ${vectorLiteral}::vector))::double precision AS "similarity"
      FROM "material_chunks" mc
      INNER JOIN "allowed_materials" am
        ON am."classroom_id" = mc."classroom_id"
       AND am."material_id" = mc."material_id"
      INNER JOIN "study_materials" sm
        ON sm."id" = mc."material_id"
       AND sm."classroom_id" = mc."classroom_id"
      WHERE mc."classroom_id" = ${query.classroomId}::uuid
        AND am."index_state" = 'indexed'::"material_index_state"
        AND sm."removed_at" IS NULL
        AND (1 - (mc."embedding" <=> ${vectorLiteral}::vector)) >= ${minSimilarity}
      ORDER BY mc."embedding" <=> ${vectorLiteral}::vector ASC, mc."id" ASC
      LIMIT ${topK}`;
  }

  private assertMatchingSchemaDimension(): void {
    const configured = this.config.aiEmbeddingDimension ?? DEFAULT_AI_EMBEDDING_DIMENSION;
    if (configured !== DB_EMBEDDING_DIMENSION) {
      throw new Error(
        `AI_EMBEDDING_DIMENSION (${configured}) must equal database vector(${DB_EMBEDDING_DIMENSION})`,
      );
    }
  }
}
