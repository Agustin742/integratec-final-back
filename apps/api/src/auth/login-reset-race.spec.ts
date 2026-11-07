import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from './auth.module';
import { hashOpaqueToken } from './session-tokens';
import { SessionVerifier } from './session-verifier.service';
import { authTestConfig } from './testing/auth-test-config';

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('Auth / Login serialized against password reset', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: SessionVerifier;
  let userId: string;
  let email: string;
  let resetToken: string;
  const oldPassword = 'oldSyntheticPassword1';
  const newPassword = 'newSyntheticPassword2';

  let afterUserRead: (() => Promise<void>) | undefined;
  let afterTokenRead: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    prisma = new PrismaService(authTestConfig());
    const instrumented = prisma.$extends({
      query: {
        user: {
          async findUnique({ args, query }) {
            const user = await query(args);
            const hold = afterUserRead;
            afterUserRead = undefined;
            await hold?.();
            return user;
          },
        },
        passwordResetToken: {
          async findUnique({ args, query }) {
            const token = await query(args);
            const hold = afterTokenRead;
            afterTokenRead = undefined;
            await hold?.();
            return token;
          },
        },
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(authTestConfig()), PrismaModule, AuthModule],
    })
      .overrideProvider(PrismaService)
      .useValue(instrumented)
      .compile();
    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    verifier = app.get(SessionVerifier);
  });

  beforeEach(async () => {
    email = `race.${randomUUID()}@example.test`;
    resetToken = randomUUID();
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(oldPassword, 4),
        displayName: 'Credential Race Tester',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userId = user.id;
    await prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashOpaqueToken(resetToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
  });

  afterEach(async () => {
    if (!userId) return;
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });
  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const login = (password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });
  const reset = () =>
    request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send({ token: resetToken, newPassword });
  const counts = async () => ({
    sessions: await prisma.session.count({ where: { userId } }),
    refreshTokens: await prisma.refreshToken.count({ where: { session: { userId } } }),
  });
  const assertUsable = async (body: { accessToken: string; refreshToken: string }) => {
    await expect(verifier.verifyToken(body.accessToken)).resolves.toBeDefined();
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(200);
  };

  it('rejects an old credential snapshot resumed after reset commits without creating tokens', async () => {
    const snapshotRead = barrier();
    const resumeLogin = barrier();
    // Preserve the real database snapshot, but hold it before bcrypt comparison.
    afterUserRead = async () => {
      snapshotRead.release();
      await resumeLogin.promise;
    };
    const pendingLogin = login(oldPassword).then((response) => response);
    try {
      await snapshotRead.promise;
      await reset().expect(204);
      const before = await counts();
      resumeLogin.release();
      const stale = await pendingLogin;
      expect(stale.status).toBe(401);
      expect(stale.body.error.code).toBe('UNAUTHENTICATED');
      expect(await counts()).toEqual(before);
      await login(oldPassword).expect(401);
      expect(await counts()).toEqual(before);
      const current = await login(newPassword).expect(200);
      await assertUsable(current.body);
    } finally {
      resumeLogin.release();
      await pendingLogin;
      afterUserRead = undefined;
    }
  });

  it('revokes independent logins committed before a pending reset and accepts new credentials', async () => {
    const tokenRead = barrier();
    const resumeReset = barrier();
    afterTokenRead = async () => {
      tokenRead.release();
      await resumeReset.promise;
    };
    const pendingReset = reset().then((response) => response);
    try {
      await tokenRead.promise;
      const first = await login(oldPassword).expect(200);
      const second = await login(oldPassword).expect(200);
      expect(first.body.refreshToken).not.toBe(second.body.refreshToken);
      await assertUsable(first.body);
      await assertUsable(second.body);
      resumeReset.release();
      expect((await pendingReset).status).toBe(204);
      for (const response of [first, second]) {
        await expect(verifier.verifyToken(response.body.accessToken)).rejects.toThrow();
        await request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refreshToken: response.body.refreshToken })
          .expect(401);
      }
      expect(await prisma.session.count({ where: { userId, revokedAt: null } })).toBe(0);
      const current = await login(newPassword).expect(200);
      await assertUsable(current.body);
    } finally {
      resumeReset.release();
      await pendingReset;
      afterTokenRead = undefined;
    }
  });
});
