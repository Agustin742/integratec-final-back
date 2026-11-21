import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { configureHttp } from '../http/configure-http';
import { buildOpenApiDocument } from '../openapi/openapi-document';
import { PrismaService } from '../prisma/prisma.service';

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

describe('Study Guide Bot OpenAPI contract (issue #41 / HU-BOT-002)', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('publishes /classrooms/{id}/bot/status and /classrooms/{id}/bot/messages matching frontend contract', async () => {
    app = await createApp();
    const doc = buildOpenApiDocument(app);

    const statusOp = doc.paths['/classrooms/{id}/bot/status']?.get;
    expect(statusOp).toBeDefined();
    expect(statusOp?.security).toEqual([{ bearer: [] }]);
    for (const status of ['200', '401', '403', '404']) {
      expect(statusOp?.responses[status]).toBeDefined();
    }
    expect(statusOp?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/BotStatusDto' } } },
    });

    const askOp = doc.paths['/classrooms/{id}/bot/messages']?.post;
    expect(askOp).toBeDefined();
    expect(askOp?.security).toEqual([{ bearer: [] }]);
    for (const status of ['200', '400', '401', '403', '404', '409', '429', '503']) {
      expect(askOp?.responses[status]).toBeDefined();
    }
    expect(askOp?.requestBody).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/AskStudyGuideBotDto' } },
      },
    });
    expect(askOp?.responses['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/BotAnswerDto' } } },
    });

    const schemas = doc.components?.schemas ?? {};
    expect(schemas.BotStatusDto).toMatchObject({
      required: ['available', 'reason', 'message'],
      properties: {
        available: { type: 'boolean' },
        reason: { enum: ['exam_in_progress', 'no_materials', 'disabled'], nullable: true },
        message: { nullable: true },
      },
    });
    expect(schemas.AskStudyGuideBotDto).toMatchObject({
      required: ['question'],
      properties: { question: { type: 'string', minLength: 1, maxLength: 2000 } },
    });
    expect(schemas.BotAnswerDto).toMatchObject({
      required: ['id', 'answer', 'outcome', 'citations', 'createdAt'],
      properties: {
        id: { format: 'uuid' },
        outcome: { enum: ['answered', 'out_of_scope', 'guided_only'] },
        createdAt: { format: 'date-time' },
      },
    });
    expect(schemas.BotCitationDto).toMatchObject({
      required: ['materialId', 'filename', 'excerpt'],
      properties: {
        materialId: { format: 'uuid' },
        excerpt: { nullable: true },
      },
    });

    // Ensure answer-key fields never appear in any bot schema.
    const botSchemaJson = JSON.stringify({
      BotStatusDto: schemas.BotStatusDto,
      AskStudyGuideBotDto: schemas.AskStudyGuideBotDto,
      BotAnswerDto: schemas.BotAnswerDto,
      BotCitationDto: schemas.BotCitationDto,
    });
    expect(botSchemaJson).not.toContain('isCorrect');
  });
});
