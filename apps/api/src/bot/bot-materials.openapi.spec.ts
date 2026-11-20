import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { buildOpenApiDocument } from '../openapi/openapi-document';

// Synthetic, clearly non-secret values: nothing here is read from the environment
// and no database connection is opened. Prisma is stubbed out like in
// src/openapi/openapi.spec.ts so the module graph is exercised without a database.
async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(authTestConfig({ nodeEnv: 'test' }))],
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
  await app.init();
  return app;
}

describe('bot materials OpenAPI contract', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('publishes the teacher bot material enable, list and disable contracts', async () => {
    app = await createApp();
    const doc = buildOpenApiDocument(app);
    const root = '/classrooms/{id}/bot/materials';
    expect(doc.paths[`${root}`]?.post).toBeDefined();
    expect(doc.paths[`${root}`]?.get).toBeDefined();
    expect(doc.paths[`${root}/{materialId}`]?.delete).toBeDefined();
    for (const [path, method, statuses] of [
      [root, 'post', ['201', '400', '401', '404']],
      [root, 'get', ['200', '400', '401', '404']],
      [`${root}/{materialId}`, 'delete', ['204', '401', '404', '503']],
    ] as const) {
      const operation = doc.paths[path]?.[method];
      expect(operation?.security).toEqual([{ bearer: [] }]);
      for (const status of statuses) {
        expect(operation?.responses[status]).toBeDefined();
      }
    }
    // Removal reports an uncertain index outcome without diagnostics.
    expect(doc.paths[`${root}/{materialId}`]?.delete?.responses['503']).toBeDefined();
    expect(doc.paths[root]?.post?.requestBody).toMatchObject({
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/EnableBotMaterialDto' },
        },
      },
    });
    expect(doc.components?.schemas?.EnableBotMaterialDto).toMatchObject({
      required: ['materialId'],
      properties: { materialId: { format: 'uuid' } },
    });
    // The list carries the standard paginated envelope.
    expect(doc.paths[root]?.get?.responses['200']).toMatchObject({
      content: {
        'application/json': {
          schema: {
            required: ['items', 'page', 'pageSize', 'total'],
            properties: { items: { type: 'array' } },
          },
        },
      },
    });
    const schema = doc.components?.schemas?.BotMaterialDto;
    expect(schema && 'properties' in schema && Object.keys(schema.properties ?? {})).toEqual([
      'id',
      'classroomId',
      'materialId',
      'filename',
      'contentType',
      'sizeBytes',
      'indexState',
      'failureReason',
      'createdAt',
    ]);
    expect(schema && 'properties' in schema && schema.properties).toMatchObject({
      indexState: { enum: ['PENDING', 'INDEXED', 'FAILED'] },
      failureReason: { nullable: true },
      createdAt: { format: 'date-time' },
    });
    expect(schema).toMatchObject({ required: expect.arrayContaining(['indexState']) });
  });
});
