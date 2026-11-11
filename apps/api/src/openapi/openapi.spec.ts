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
