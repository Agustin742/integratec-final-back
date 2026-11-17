import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import type { ApiConfig } from '../config/api-config';
import { ERROR_CODES } from '../http/error-envelope';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { mountApiDocs } from './docs';
import { renderOpenApiJson, OPENAPI_FILE_PATH } from './export';
import { buildOpenApiDocument } from './openapi-document';

// Synthetic, clearly non-secret values: nothing here is read from the environment.
const config = (nodeEnv: ApiConfig['nodeEnv']): ApiConfig => ({
  nodeEnv,
  port: 3000,
  databaseUrl: 'postgresql://user:password@localhost:5432/synthetic',
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604800,
  refreshReuseGraceSeconds: 30,
  passwordResetTtlSeconds: 3600,
  passwordResetUrlBase: 'http://localhost:5173/reset-password',
  invitationTtlSeconds: 604800,
  outboxPollIntervalSeconds: 5,
  outboxMaxAttempts: 5,
  realtimeInternalUrl: 'http://localhost:2567',
  internalServiceSecret: 'synthetic-secret-for-tests-only-0000',
  jwtSecret: 'synthetic-jwt-secret-for-tests-only-0000',
  invitationTokenKey: Buffer.alloc(32, 1),
  allowedOrigins: ['http://localhost:5173'],
  s3Bucket: 'synthetic-bucket',
  s3Region: 'sa-east-1',
  s3Endpoint: undefined,
  s3ForcePathStyle: false,
  s3Credentials: undefined,
  storageSignedUrlTtlSeconds: 300,
  authDataRetentionSeconds: 2592000,
  authCleanupIntervalSeconds: 86400,
  authCleanupBatchSize: 1000,
});

async function createApp(nodeEnv: ApiConfig['nodeEnv']): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config(nodeEnv))],
  })
    .overrideProvider(PrismaService)
    .useValue({
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      onModuleInit: vi.fn(),
      onModuleDestroy: vi.fn(),
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureHttp(app, { logSink: () => undefined });
  mountApiDocs(app, config(nodeEnv));
  await app.init();
  return app;
}

describe('OpenAPI document', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('describes /health and the reusable error envelope schemas', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);

    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBe(
      (
        JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
          version: string;
        }
      ).version,
    );
    expect(doc.paths['/health']?.get?.summary).toBeTruthy();
    expect(doc.paths['/health']?.get?.responses?.['200']).toBeDefined();

    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'ErrorEnvelope',
        'ErrorBody',
        'ErrorDetail',
        'ErrorCode',
        'HealthStatus',
      ]),
    );
    // The enum is generated from the single source of truth, not retyped.
    expect(schemas.ErrorCode).toMatchObject({ enum: Object.values(ERROR_CODES) });
  });

  it('publishes private material upload, discovery, download and logical-removal contracts', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);
    const root = '/classrooms/{id}/materials';
    for (const [path, method, success] of [
      [root, 'get', '200'],
      [root, 'post', '201'],
      [`${root}/{materialId}/download`, 'get', '200'],
      [`${root}/{materialId}`, 'delete', '204'],
    ] as const) {
      const operation = doc.paths[path]?.[method];
      expect(operation?.security).toEqual([{ bearer: [] }]);
      for (const status of [success, '401', '403', '404']) {
        expect(operation?.responses[status]).toBeDefined();
      }
    }
    expect(doc.paths[root]?.post?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': {
          schema: {
            required: ['file'],
            properties: { file: { type: 'string', format: 'binary' } },
          },
        },
      },
    });
    expect(doc.paths[root]?.post?.responses['413']).toBeDefined();
    expect(doc.paths[root]?.post?.responses['503']).toBeDefined();
    const schema = doc.components?.schemas?.MaterialDto;
    expect(schema && 'properties' in schema && Object.keys(schema.properties ?? {})).toEqual([
      'id',
      'classroomId',
      'authorId',
      'filename',
      'contentType',
      'sizeBytes',
      'createdAt',
    ]);
    expect(doc.components?.schemas?.MaterialDownloadDto).toMatchObject({
      required: ['url', 'expiresInSeconds'],
    });
  });

  it('publishes authenticated notification navigation and read contracts without storage internals', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);
    for (const [path, method] of [
      ['/notifications', 'get'],
      ['/notifications/{id}/read', 'patch'],
      ['/notifications/read-all', 'patch'],
    ] as const) {
      const operation = doc.paths[path]?.[method];
      expect(operation).toBeDefined();
      expect(operation?.security).toEqual([{ bearer: [] }]);
      expect(operation?.responses['200']).toBeDefined();
      expect(operation?.responses['401']).toBeDefined();
    }
    expect(doc.paths['/notifications/{id}/read']?.patch?.responses['404']).toBeDefined();
    const query = doc.paths['/notifications']?.get?.parameters ?? [];
    expect(query.map((parameter) => 'name' in parameter && parameter.name)).toEqual([
      'page',
      'pageSize',
    ]);
    expect(doc.components?.schemas?.NotificationDto).toMatchObject({
      required: ['id', 'kind', 'resourceId', 'classroomId', 'studentId', 'readAt', 'createdAt'],
      properties: {
        studentId: { nullable: true, format: 'uuid' },
        readAt: { nullable: true, format: 'date-time' },
        createdAt: { format: 'date-time' },
      },
    });
    const schema = doc.components?.schemas?.NotificationDto;
    expect(schema && 'properties' in schema && Object.keys(schema.properties ?? {})).toEqual([
      'id',
      'kind',
      'resourceId',
      'classroomId',
      'studentId',
      'readAt',
      'createdAt',
    ]);
  });

  it('registers the protected, complete desk-map contract without directory data', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);
    const operation = doc.paths['/classrooms/{id}/desks']?.get;
    expect(operation?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(['200', '401', '403', '404']);
    expect(operation?.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    ]);
    expect(operation?.responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ClassroomDeskMapDto' } },
      },
    });
    const desk = doc.components?.schemas?.ClassroomDeskDto;
    expect(desk).toMatchObject({
      required: ['id', 'deskIndex', 'membershipId', 'userId'],
      properties: {
        membershipId: { type: 'string', format: 'uuid', nullable: true },
        userId: { type: 'string', format: 'uuid', nullable: true },
      },
    });
    expect(desk && 'properties' in desk && Object.keys(desk.properties ?? {})).toEqual([
      'id',
      'deskIndex',
      'membershipId',
      'userId',
    ]);
  });

  it('publishes the classroom shop catalog, purchase history, and idempotent purchase contracts', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);

    const itemsOp = doc.paths['/classrooms/{id}/shop/items']?.get;
    expect(itemsOp?.security).toEqual([{ bearer: [] }]);
    expect(itemsOp?.responses?.['200']).toBeDefined();

    const purchasesOp = doc.paths['/classrooms/{id}/shop/purchases']?.get;
    expect(purchasesOp?.security).toEqual([{ bearer: [] }]);
    expect(purchasesOp?.responses?.['200']).toBeDefined();

    const purchaseOp = doc.paths['/classrooms/{id}/shop/purchase']?.post;
    expect(purchaseOp?.security).toEqual([{ bearer: [] }]);
    expect(purchaseOp?.responses?.['201']).toBeDefined();
    expect(purchaseOp?.responses?.['200']).toBeDefined();
    expect(purchaseOp?.responses?.['409']).toBeDefined();
    expect(purchaseOp?.responses?.['429']).toBeDefined();
    expect(purchaseOp?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
      ]),
    );

    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'ShopCatalogItemDto',
        'StudentPurchaseDto',
        'ClassroomItemDto',
        'PurchaseResponseDto',
        'ShopItemKind',
        'ClassroomItemState',
      ]),
    );
  });

  it('publishes submission grading, regrading, grade read, and staff queue contracts without type: object primitives or dangling refs', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);

    const postOp = doc.paths['/submissions/{submissionId}/grade']?.post;
    expect(postOp?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(postOp?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '401', '403', '404', '409']),
    );

    const patchOp = doc.paths['/submissions/{submissionId}/grade']?.patch;
    expect(patchOp?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(patchOp?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404', '409']),
    );

    const getGradeOp = doc.paths['/submissions/{submissionId}/grade']?.get;
    expect(getGradeOp?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(getGradeOp?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401', '403', '404']),
    );

    const queueOp = doc.paths['/classrooms/{id}/submissions']?.get;
    expect(queueOp?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(queueOp?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '403', '404']),
    );

    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'GradeSubmissionDto',
        'RegradeSubmissionDto',
        'GradeResponseDto',
        'GradingQueueGradeDto',
        'GradingQueueItemDto',
        'SubmissionResponseDto',
      ]),
    );

    expect(schemas.SubmissionResponseDto).toMatchObject({
      properties: {
        status: { type: 'string', enum: ['submitted', 'graded'] },
      },
    });
    expect(schemas.GradeResponseDto).toMatchObject({
      properties: {
        pointTransactionId: { type: 'string', format: 'uuid', nullable: true },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        pointsAwarded: { type: 'integer', minimum: 0 },
        version: { type: 'integer', minimum: 1 },
      },
    });
    expect(schemas.GradingQueueItemDto).toMatchObject({
      properties: {
        status: { type: 'string', enum: ['submitted', 'graded'] },
        grade: {
          nullable: true,
          allOf: [{ $ref: '#/components/schemas/GradingQueueGradeDto' }],
        },
      },
    });

    // Verify zero dangling $refs in the generated OpenAPI document.
    const serialized = JSON.stringify(doc);
    const refs = [...serialized.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)].map(
      (match) => match[1],
    );
    for (const refName of refs) {
      expect(schemas[refName]).toBeDefined();
    }
  });

  it('adds panel availability only to the classroom GET context', async () => {
    app = await createApp('test');
    const doc = buildOpenApiDocument(app);
    const operation = doc.paths['/classrooms/{id}']?.get;
    expect(operation?.security).toEqual([{ bearer: [] }]);
    expect(Object.keys(operation?.responses ?? {})).toEqual(['200', '401', '404']);
    const contextRef = '#/components/schemas/ClassroomContextResponseDto';
    expect(operation?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: contextRef } } },
    });
    const schemas = doc.components?.schemas ?? {};
    const panelRef = '#/components/schemas/ClassroomPanelKey';
    expect(schemas.ClassroomContextResponseDto).toMatchObject({
      required: expect.arrayContaining(['myRole', 'capabilities', 'availablePanels']),
      properties: {
        availablePanels: {
          type: 'array',
          description: expect.stringContaining('not action permissions'),
          items: { $ref: panelRef },
        },
      },
    });
    expect(schemas.ClassroomPanelKey).toMatchObject({
      enum: [
        'activities',
        'material',
        'grades',
        'chat',
        'notices',
        'shop',
        'bot',
        'members',
        'settings',
        'pet',
      ],
    });
    expect(schemas.ClassroomPanelKey).not.toHaveProperty('description');
    for (const name of ['ClassroomListItemDto', 'ClassroomDetailResponseDto']) {
      const schema = schemas[name];
      const properties = schema && 'properties' in schema && schema.properties;
      expect(properties).not.toHaveProperty('availablePanels');
    }
    const unchangedOperations = [
      ['/classrooms', 'post', '201'],
      ['/classrooms/{id}', 'patch', '200'],
    ] as const;
    for (const [path, method, status] of unchangedOperations) {
      const detailRef = '#/components/schemas/ClassroomDetailResponseDto';
      expect(doc.paths[path]?.[method]?.responses[status]).toMatchObject({
        content: { 'application/json': { schema: { $ref: detailRef } } },
      });
    }
  });

  it('serves the JSON document and the Scalar UI outside production', async () => {
    app = await createApp('development');

    const json = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);
    expect(json.body.paths['/health']).toBeDefined();

    const ui = await request(app.getHttpServer()).get('/docs').expect(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.text).toContain('/docs/openapi.json');
  });

  it('exposes nothing in production: both routes return the 404 envelope', async () => {
    app = await createApp('production');

    for (const path of ['/docs', '/docs/openapi.json']) {
      const res = await request(app.getHttpServer()).get(path).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('openapi export', () => {
  it('is deterministic across runs', async () => {
    expect(await renderOpenApiJson()).toBe(await renderOpenApiJson());
  });

  it('matches the committed apps/api/openapi.json (run `pnpm openapi:export` if stale)', async () => {
    // Normalize CRLF so a Windows checkout without eol=lf cannot fake staleness.
    const committed = readFileSync(OPENAPI_FILE_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(await renderOpenApiJson()).toBe(committed);
    expect(committed.endsWith('\n')).toBe(true);
  });
});
