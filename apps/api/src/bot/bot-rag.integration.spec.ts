import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHAT_MODEL_PORT,
  EMBEDDING_MODEL_PORT,
  type ChatModelPort,
  type EmbeddingModelPort,
} from './ai-provider.ports';
import { BotMaterialsService } from './bot-materials.service';
import { MATERIAL_INDEX_PORT, type MaterialIndexPort } from './material-index.port';
import { MATERIAL_RETRIEVAL_PORT, type MaterialRetrievalPort } from './material-retrieval.port';
import { PNG_BYTES, buildMinimalPdf } from './testing/material-fixtures';

const databaseUrl = loadIsolatedTestDatabaseUrl();

function topicVector(text: string): number[] {
  const lower = text.toLowerCase();
  const vec = new Array<number>(768).fill(0);
  if (lower.includes('photosynthesis') || lower.includes('chloroplast')) vec[0] = 1;
  else if (lower.includes('fraction') || lower.includes('numerator')) vec[1] = 1;
  else if (lower.includes('ecosystem') || lower.includes('biome')) vec[2] = 1;
  else if (lower.includes('mitochondria') || lower.includes('atp')) vec[3] = 1;
  else vec[10] = 1;
  return vec;
}

describe('pgvector RAG pipeline integration — issue #41 / HU-BOT-002', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let botMaterials: BotMaterialsService;
  let indexPort: MaterialIndexPort;
  let retrievalPort: MaterialRetrievalPort;

  const [teacherA, teacherB] = [randomUUID(), randomUUID()];
  const [classroomA, classroomB] = [randomUUID(), randomUUID()];
  const [pdfMat, mdMat, txtMat, pngMat, foreignPdfMat] = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];

  const storageObjects = new Map<string, { body: Uint8Array; contentType: string }>();

  const fakeStorage: StoragePort = {
    put: async (key, body, options) => {
      storageObjects.set(key, { body: Uint8Array.from(body), contentType: options.contentType });
    },
    get: async (key) => {
      const obj = storageObjects.get(key);
      if (!obj) throw new Error(`Missing synthetic object ${key}`);
      return obj;
    },
    delete: async (key) => {
      storageObjects.delete(key);
    },
    getSignedDownloadUrl: async () => 'https://storage.example.invalid/signed',
  };

  const fakeEmbeddings: EmbeddingModelPort = {
    embed: async (texts) => ({
      vectors: texts.map(topicVector),
      totalTokens: texts.length * 10,
    }),
  };

  const fakeChat: ChatModelPort = {
    chatCompletion: async () => ({
      content: 'Unused in RAG integration suite',
      toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    }),
  };

  beforeAll(async () => {
    storageObjects.set(`materials/${classroomA}/${pdfMat}`, {
      body: buildMinimalPdf(['Photosynthesis converts light inside chloroplasts.']),
      contentType: 'application/pdf',
    });
    storageObjects.set(`materials/${classroomA}/${mdMat}`, {
      body: Buffer.from('# Fractions\nEquivalent fractions share the same ratio.', 'utf8'),
      contentType: 'text/markdown',
    });
    storageObjects.set(`materials/${classroomA}/${txtMat}`, {
      body: Buffer.from('An ecosystem links living organisms and abiotic factors.', 'utf8'),
      contentType: 'text/plain',
    });
    storageObjects.set(`materials/${classroomA}/${pngMat}`, {
      body: PNG_BYTES,
      contentType: 'image/png',
    });
    storageObjects.set(`materials/${classroomB}/${foreignPdfMat}`, {
      body: buildMinimalPdf(['Foreign classroom photosynthesis notes.']),
      contentType: 'application/pdf',
    });

    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    })
      .overrideProvider(STORAGE_PORT)
      .useValue(fakeStorage)
      .overrideProvider(EMBEDDING_MODEL_PORT)
      .useValue(fakeEmbeddings)
      .overrideProvider(CHAT_MODEL_PORT)
      .useValue(fakeChat)
      .compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();

    prisma = app.get(PrismaService);
    botMaterials = app.get(BotMaterialsService);
    indexPort = app.get(MATERIAL_INDEX_PORT);
    retrievalPort = app.get(MATERIAL_RETRIEVAL_PORT);

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          {
            id: teacherA,
            displayName: 'Teacher A',
            email: `rag-ta-${teacherA}@example.invalid`,
            passwordHash: 'synthetic-unused-hash',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: teacherB,
            displayName: 'Teacher B',
            email: `rag-tb-${teacherB}@example.invalid`,
            passwordHash: 'synthetic-unused-hash',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: 'RAG Bio A', independentTeacherId: teacherA },
          { id: classroomB, name: 'RAG Bio B', independentTeacherId: teacherB },
        ],
      });
      await tx.studyMaterial.createMany({
        data: [
          {
            id: pdfMat,
            classroomId: classroomA,
            authorId: teacherA,
            objectKey: `materials/${classroomA}/${pdfMat}`,
            filename: 'bio-photosynthesis.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1200,
          },
          {
            id: mdMat,
            classroomId: classroomA,
            authorId: teacherA,
            objectKey: `materials/${classroomA}/${mdMat}`,
            filename: 'math-fractions.md',
            contentType: 'text/markdown',
            sizeBytes: 200,
          },
          {
            id: txtMat,
            classroomId: classroomA,
            authorId: teacherA,
            objectKey: `materials/${classroomA}/${txtMat}`,
            filename: 'ecology-notes.txt',
            contentType: 'text/plain',
            sizeBytes: 200,
          },
          {
            id: pngMat,
            classroomId: classroomA,
            authorId: teacherA,
            objectKey: `materials/${classroomA}/${pngMat}`,
            filename: 'diagram.png',
            contentType: 'image/png',
            sizeBytes: PNG_BYTES.length,
          },
          {
            id: foreignPdfMat,
            classroomId: classroomB,
            authorId: teacherB,
            objectKey: `materials/${classroomB}/${foreignPdfMat}`,
            filename: 'foreign-bio.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1200,
          },
        ],
      });
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('indexes PDF, Markdown and plain text into pgvector and isolates retrieval by classroom', async () => {
    const enabledPdf = await botMaterials.enable(teacherA, classroomA, pdfMat);
    const enabledMd = await botMaterials.enable(teacherA, classroomA, mdMat);
    const enabledTxt = await botMaterials.enable(teacherA, classroomA, txtMat);
    const enabledForeign = await botMaterials.enable(teacherB, classroomB, foreignPdfMat);

    expect(enabledPdf.indexState).toBe('INDEXED');
    expect(enabledMd.indexState).toBe('INDEXED');
    expect(enabledTxt.indexState).toBe('INDEXED');
    expect(enabledForeign.indexState).toBe('INDEXED');

    expect(await indexPort.isIndexed(classroomA, pdfMat)).toBe(true);
    expect(await indexPort.isIndexed(classroomB, pdfMat)).toBe(false);

    const hitsA = await retrievalPort.search({
      classroomId: classroomA,
      queryEmbedding: topicVector('photosynthesis'),
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(hitsA).toHaveLength(1);
    expect(hitsA[0]).toMatchObject({
      materialId: pdfMat,
      filename: 'bio-photosynthesis.pdf',
      position: 'page 1',
    });
    expect(hitsA[0]!.content).toContain('chloroplasts');

    // Cross-classroom isolation: identical topic vector in classroom B never surfaces classroom A chunks.
    const hitsB = await retrievalPort.search({
      classroomId: classroomB,
      queryEmbedding: topicVector('photosynthesis'),
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(hitsB).toHaveLength(1);
    expect(hitsB[0]!.materialId).toBe(foreignPdfMat);

    // Below threshold returns empty array.
    const unrelated = await retrievalPort.search({
      classroomId: classroomA,
      queryEmbedding: topicVector('mitochondria'),
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(unrelated).toEqual([]);
  });

  it('replaces prior chunks completely on re-enable and excludes disabled or soft-removed materials immediately', async () => {
    storageObjects.set(`materials/${classroomA}/${txtMat}`, {
      body: Buffer.from('Mitochondria generate ATP via cellular respiration.', 'utf8'),
      contentType: 'text/plain',
    });
    const reindexed = await botMaterials.enable(teacherA, classroomA, txtMat);
    expect(reindexed.indexState).toBe('INDEXED');

    // Old ecosystem topic no longer matches txtMat; new mitochondria topic matches.
    const oldHits = await retrievalPort.search({
      classroomId: classroomA,
      queryEmbedding: topicVector('ecosystem'),
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(oldHits).toEqual([]);

    const newHits = await retrievalPort.search({
      classroomId: classroomA,
      queryEmbedding: topicVector('mitochondria'),
      topK: 5,
      minSimilarity: 0.5,
    });
    expect(newHits).toHaveLength(1);
    expect(newHits[0]!.content).toContain('ATP');

    // Even if stale chunks remain in DB, soft-removing StudyMaterial excludes it immediately.
    await prisma.studyMaterial.update({
      where: { id: mdMat },
      data: { removedAt: new Date(), removedById: teacherA },
    });
    expect(
      await retrievalPort.search({
        classroomId: classroomA,
        queryEmbedding: topicVector('fraction'),
        topK: 5,
        minSimilarity: 0.5,
      }),
    ).toEqual([]);

    // Disabling via BotMaterialsService deletes material_chunks rows too.
    await botMaterials.disable(teacherA, classroomA, txtMat);
    expect(await indexPort.isIndexed(classroomA, txtMat)).toBe(false);
    expect(
      await retrievalPort.search({
        classroomId: classroomA,
        queryEmbedding: topicVector('mitochondria'),
        topK: 5,
        minSimilarity: 0.5,
      }),
    ).toEqual([]);
  });

  it('records FAILED state for unsupported image materials while keeping the material usable', async () => {
    const failed = await botMaterials.enable(teacherA, classroomA, pngMat);
    expect(failed.indexState).toBe('FAILED');
    expect(failed.failureReason).toBeTruthy();

    const row = await prisma.studyMaterial.findUnique({
      where: { id: pngMat },
      select: { removedAt: true },
    });
    expect(row).toEqual({ removedAt: null });
    expect(await indexPort.isIndexed(classroomA, pngMat)).toBe(false);
  });
});
