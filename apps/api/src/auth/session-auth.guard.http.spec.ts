import { Controller, Get, type INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from './auth.module';
import { Public } from './public.decorator';
import { SessionVerifier, type VerifiedSession } from './session-verifier.service';
import { authTestConfig } from './testing/auth-test-config';

@Controller('test')
class GuardTestController {
  @Get('protected')
  getProtected() {
    return { ok: true, access: 'protected' };
  }

  @Public()
  @Get('public')
  getPublic() {
    return { ok: true, access: 'public' };
  }
}

describe('SessionAuthGuard HTTP Integration (Protected by Default)', () => {
  let app: INestApplication;
  const mockVerifiedSession: VerifiedSession = {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
  };

  beforeAll(async () => {
    vi.spyOn(PrismaService.prototype, '$connect').mockImplementation(async () => {});
    vi.spyOn(PrismaService.prototype, '$disconnect').mockImplementation(async () => {});

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(authTestConfig()), PrismaModule, AuthModule],
      controllers: [GuardTestController],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: vi.fn(async (header?: string) => {
          if (header === 'Bearer valid-token') {
            return mockVerifiedSession;
          }
          throw new UnauthorizedException();
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /test/protected without header returns 401 Unauthorized (confirms APP_GUARD is active globally)', async () => {
    await request(app.getHttpServer()).get('/test/protected').expect(401);
  });

  it('GET /test/public without header returns 200 OK', async () => {
    const res = await request(app.getHttpServer()).get('/test/public').expect(200);

    expect(res.body).toEqual({ ok: true, access: 'public' });
  });

  it('GET /test/protected with valid token returns 200 OK', async () => {
    const res = await request(app.getHttpServer())
      .get('/test/protected')
      .set('Authorization', 'Bearer valid-token')
      .expect(200);

    expect(res.body).toEqual({ ok: true, access: 'protected' });
  });
});
