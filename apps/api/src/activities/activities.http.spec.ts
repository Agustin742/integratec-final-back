import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesModule } from './activities.module';

const classroomId = '11111111-1111-4111-8111-111111111111';
const activityId = '66666666-6666-4666-8666-666666666666';
const base = `/classrooms/${classroomId}/activities`;
const body = {
  type: 'TP',
  format: 'FILE',
  title: 'Essay',
  dueAt: '2026-12-01T15:00:00.000Z',
  maxScore: 10,
};
type Method = 'get' | 'post' | 'patch' | 'delete';

// Contract-only stage (api-contracts D8/D9): handlers throw NotImplementedException until T3/T4.
// The global AllExceptionsFilter has no 501 mapping, so a stub surfaces as 500 INTERNAL_ERROR;
// what matters here is that the route is mounted (not 404) and behind authentication.
describe('activities contract stubs — API contracts', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(
          authTestConfig({ databaseUrl: 'postgresql://synthetic:synthetic@localhost:1/unused' }),
        ),
        PrismaModule,
        AuthModule,
        ActivitiesModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          if (header !== 'Bearer synthetic') throw new UnauthorizedException();
          return { userId: 'u', sessionId: 's' };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });

  const call = (method: Method, url: string) => request(app.getHttpServer())[method](url);
  const routes: [string, Method, string, object?][] = [
    ['create', 'post', base, body],
    ['list', 'get', base],
    ['get', 'get', `${base}/${activityId}`],
    ['update', 'patch', `${base}/${activityId}`, { title: 'New' }],
    ['publish', 'post', `${base}/${activityId}/publish`],
    ['deactivate', 'delete', `${base}/${activityId}`],
  ];

  it.each(routes)('%s is mounted: stub fails as INTERNAL_ERROR, not 404', async (_n, m, url, b) => {
    const res = await call(m, url).set('Authorization', 'Bearer synthetic').send(b);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
  it.each(routes)('%s requires authentication', async (_n, m, url, b) => {
    await call(m, url).send(b).expect(401);
  });
  it('rejects an invalid create body before reaching the handler', async () => {
    const res = await call('post', base)
      .set('Authorization', 'Bearer synthetic')
      .send({ ...body, maxScore: 101, secret: 'x' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
  it('rejects unknown list query parameters', async () => {
    await call('get', `${base}?secret=x`).set('Authorization', 'Bearer synthetic').expect(400);
  });

  it('rejects a sort field outside the allow-list with VALIDATION_FAILED on sort', async () => {
    const res = await call('get', `${base}?sort=password`)
      .set('Authorization', 'Bearer synthetic')
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toEqual([{ field: 'sort', messages: expect.any(Array) }]);
  });
  it.each(['dueAt', '-dueAt', 'createdAt', '-createdAt'])(
    'accepts sort=%s (reaches the stub, not 400)',
    async (sort) => {
      const res = await call('get', `${base}?sort=${sort}`).set(
        'Authorization',
        'Bearer synthetic',
      );
      expect(res.status).not.toBe(400);
    },
  );
  it('rejects an explicit null on PATCH before reaching the handler', async () => {
    const res = await call('patch', `${base}/${activityId}`)
      .set('Authorization', 'Bearer synthetic')
      .send({ title: null })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('OpenAPI: student option has no isCorrect, teacher option does; GET one is oneOf', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const schemas = doc.components?.schemas as Record<string, { properties?: object }>;
    expect(Object.keys(schemas.StudentOptionDto?.properties ?? {})).toEqual([
      'id',
      'position',
      'label',
    ]);
    expect(Object.keys(schemas.TeacherOptionDto?.properties ?? {})).toContain('isCorrect');
    const get = doc.paths[`/classrooms/{id}/activities/{activityId}`]?.get;
    const ok = get?.responses['200'] as {
      content: Record<string, { schema: { oneOf: unknown[] } }>;
    };
    expect(ok.content['application/json']?.schema.oneOf).toHaveLength(2);
  });
});
