import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import type { StoragePort } from '../platform/storage/storage.port';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmbeddingModelPort } from './ai-provider.ports';
import { PgVectorMaterialIndexAdapter } from './pgvector-material-index.adapter';
import type { TextExtractorService } from './text-extractor.service';

const unitVector = (slot: number, length = 768) =>
  Array.from({ length }, (_, index) => (index === slot ? 1 : 0));

describe('PgVectorMaterialIndexAdapter (unit)', () => {
  const classroomId = randomUUID();
  const materialId = randomUUID();

  function buildAdapter(overrides?: { aiEmbeddingDimension?: number }) {
    const executeRaw = vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
    const queryRaw = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []);
    const prisma = {
      $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ $executeRaw: executeRaw, $queryRaw: queryRaw }),
      ),
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    } as unknown as PrismaService;
    const storage: StoragePort = {
      put: vi.fn(),
      get: vi.fn(async () => ({
        body: Buffer.from('Photosynthesis converts light energy.'),
        contentType: 'text/plain',
      })),
      delete: vi.fn(),
      getSignedDownloadUrl: vi.fn(),
    };
    const extractor = {
      extract: vi.fn(async () => [
        { position: 'page 1', text: 'Photosynthesis converts light energy.' },
        { position: 'page 2', text: 'Chloroplasts contain chlorophyll.' },
      ]),
    } as unknown as TextExtractorService;
    const embeddings: EmbeddingModelPort = {
      embed: vi.fn(async (texts: string[]) => ({
        vectors: texts.map((_, index) => unitVector(index)),
        totalTokens: texts.length * 10,
      })),
    };
    const adapter = new PgVectorMaterialIndexAdapter(
      prisma,
      storage,
      extractor,
      embeddings,
      authTestConfig(overrides),
    );
    return { adapter, prisma, executeRaw, queryRaw, storage, extractor, embeddings };
  }

  function rawSqlText(call: unknown[]): string {
    const first = call[0];
    if (Array.isArray(first)) {
      return (first as readonly string[]).join('?');
    }
    return (first as { strings: readonly string[] }).strings.join('?');
  }

  it('replaces all prior classroom/material chunks transactionally during index()', async () => {
    const { adapter, executeRaw, embeddings } = buildAdapter();

    await adapter.index({
      classroomId,
      materialId,
      objectKey: `materials/${classroomId}/${materialId}`,
      filename: 'biology.pdf',
      contentType: 'application/pdf',
    });

    expect(embeddings.embed).toHaveBeenCalledTimes(1);
    // 1 delete + 2 chunk inserts inside the transaction.
    expect(executeRaw).toHaveBeenCalledTimes(3);
    const deleteSql = rawSqlText(executeRaw.mock.calls[0]!);
    expect(deleteSql).toContain('DELETE FROM "material_chunks"');
    const insertSql = rawSqlText(executeRaw.mock.calls[1]!);
    expect(insertSql).toContain('INSERT INTO "material_chunks"');
    expect(insertSql).toContain('::vector');
  });

  it('fails closed when aiEmbeddingDimension mismatches the schema vector(768) column', async () => {
    const { adapter, storage, embeddings, executeRaw } = buildAdapter({
      aiEmbeddingDimension: 1536,
    });

    await expect(
      adapter.index({
        classroomId,
        materialId,
        objectKey: `materials/${classroomId}/${materialId}`,
        filename: 'biology.pdf',
        contentType: 'application/pdf',
      }),
    ).rejects.toThrow(/768/);
    await expect(
      adapter.search({
        classroomId,
        queryEmbedding: unitVector(0, 1536),
        topK: 5,
        minSimilarity: 0.35,
      }),
    ).rejects.toThrow(/768/);
    expect(storage.get).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it('enforces server-side classroom, AllowedMaterial and non-removed filters in search()', async () => {
    const { adapter, queryRaw } = buildAdapter();
    queryRaw.mockResolvedValueOnce([
      {
        chunkId: 'c1',
        materialId,
        filename: 'biology.pdf',
        position: 'page 1',
        content: 'Chloroplasts perform photosynthesis.',
        similarity: 0.91,
      },
    ]);

    const hits = await adapter.search({
      classroomId,
      queryEmbedding: unitVector(0),
      topK: 5,
      minSimilarity: 0.35,
    });

    expect(hits).toHaveLength(1);
    const sql = rawSqlText(queryRaw.mock.calls[0]!);
    expect(sql).toContain('JOIN "allowed_materials"');
    expect(sql).toContain('JOIN "study_materials"');
    expect(sql).toContain('am."index_state" = \'indexed\'');
    expect(sql).toContain('sm."removed_at" IS NULL');
    expect(sql).toContain('mc."classroom_id"');
  });
});
