import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthModule } from './auth.module';
import { REFRESH_TOKEN_MAX_LENGTH } from './dto/refresh-request.dto';
import { hashRefreshToken } from './session-tokens';
import { SessionVerifier } from './session-verifier.service';
import { authTestConfig } from './testing/auth-test-config';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

describe('Auth / Refresh rotation (HU-AUT-002)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: SessionVerifier;
  let jwt: JwtService;
  const config = authTestConfig();
  const password = 'correctHorseBattery1';
  const email = `refresh.${Date.now()}@example.com`;
  let userId: string;

  const login = async (): Promise<TokenPair & { sid: string }> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const pair = res.body as TokenPair;
    return { ...pair, sid: jwt.decode<{ sid: string }>(pair.accessToken).sid };
  };

  const refresh = (refreshToken: unknown) =>
    request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken });

  const isAccepted = (accessToken: string) =>
    verifier.verifyToken(accessToken).then(
      () => true,
      () => false,
    );

  /** Moves a token's `rotatedAt` into the past, standing in for elapsed time. */
  const ageRotation = async (refreshToken: string, ageMs: number) => {
    await prisma.refreshToken.update({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      data: { rotatedAt: new Date(Date.now() - ageMs) },
    });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    verifier = app.get(SessionVerifier);
    jwt = app.get(JwtService);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        displayName: 'Refresh Tester',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma?.session.deleteMany({ where: { userId } });
    await prisma?.user.deleteMany({ where: { id: userId } });
    await app?.close();
  });

  describe('validation', () => {
    it.each([[{}], [{ refreshToken: 123 }], [{ refreshToken: '' }]])(
      'returns 400 VALIDATION_FAILED for %j',
      async (body) => {
        const res = await request(app.getHttpServer()).post('/auth/refresh').send(body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'refreshToken' })]),
        );
      },
    );
  });

  describe('refresh token length limit', () => {
    it('rejects a token over the limit with 400 VALIDATION_FAILED', async () => {
      const res = await refresh('a'.repeat(REFRESH_TOKEN_MAX_LENGTH + 1)).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'refreshToken' })]),
      );
    });

    it('passes validation at exactly the limit (unknown token: 401)', async () => {
      await refresh('a'.repeat(REFRESH_TOKEN_MAX_LENGTH)).expect(401);
    });
  });

  describe('successful rotation', () => {
    it('returns a new pair for the same session and rotates the presented token', async () => {
      const first = await login();
      const res = await refresh(first.refreshToken).expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: config.accessTokenTtlSeconds,
      });
      const second = res.body as TokenPair;
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // The new access token is bound to the same session.
      await expect(verifier.verifyToken(second.accessToken)).resolves.toEqual({
        userId,
        sessionId: first.sid,
      });

      const rows = await prisma.refreshToken.findMany({ where: { sessionId: first.sid } });
      expect(rows).toHaveLength(2);
      const old = rows.find((row) => row.tokenHash === hashRefreshToken(first.refreshToken));
      const fresh = rows.find((row) => row.tokenHash === hashRefreshToken(second.refreshToken));
      expect(old?.rotatedAt).not.toBeNull();
      expect(fresh?.rotatedAt).toBeNull();

      // The new refresh token keeps working (a chain of rotations).
      await refresh(second.refreshToken).expect(200);
    });

    it('does not extend the absolute session lifetime', async () => {
      const first = await login();
      const before = await prisma.session.findUniqueOrThrow({ where: { id: first.sid } });
      await refresh(first.refreshToken).expect(200);
      const after = await prisma.session.findUniqueOrThrow({ where: { id: first.sid } });
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    });
  });

  describe('invalid tokens', () => {
    it.each([['not-a-real-token'], ['x'.repeat(43)], ['é'.repeat(50)]])(
      'answers an unknown token %j with the generic 401',
      async (token) => {
        const res = await refresh(token).expect(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
        expect(JSON.stringify(res.body)).not.toContain(token);
      },
    );
  });

  describe('reuse detection', () => {
    it('revokes the whole session when a rotated token is presented after the grace window', async () => {
      const first = await login();
      const second = (await refresh(first.refreshToken).expect(200)).body as TokenPair;
      expect(await isAccepted(second.accessToken)).toBe(true);
      await ageRotation(first.refreshToken, config.refreshReuseGraceSeconds * 1000 + 1000);

      const reuse = await refresh(first.refreshToken).expect(401);
      expect(reuse.body.error.code).toBe('UNAUTHENTICATED');

      // The revocation persisted although the request failed.
      const session = await prisma.session.findUniqueOrThrow({ where: { id: first.sid } });
      expect(session.revokedAt).not.toBeNull();

      // The attacker and the legitimate holder are both locked out.
      await refresh(second.refreshToken).expect(401);
      expect(await isAccepted(second.accessToken)).toBe(false);
      expect(await isAccepted(first.accessToken)).toBe(false);
    });
  });

  describe('reuse grace window', () => {
    it('lets every concurrent refresh with the same token succeed and keeps the session alive', async () => {
      const first = await login();
      const results = await Promise.all([
        refresh(first.refreshToken),
        refresh(first.refreshToken),
        refresh(first.refreshToken),
      ]);
      expect(results.map((res) => res.status)).toEqual([200, 200, 200]);

      const session = await prisma.session.findUniqueOrThrow({ where: { id: first.sid } });
      expect(session.revokedAt).toBeNull();

      const pairs = results.map((res) => res.body as TokenPair);
      expect(new Set(pairs.map((pair) => pair.refreshToken)).size).toBe(3);
      for (const pair of pairs) {
        expect(await isAccepted(pair.accessToken)).toBe(true);
        await refresh(pair.refreshToken).expect(200);
      }
    });

    it('issues a new pair for the same session when a rotated token is retried within the window', async () => {
      const first = await login();
      const second = (await refresh(first.refreshToken).expect(200)).body as TokenPair;
      const before = await prisma.session.findUniqueOrThrow({ where: { id: first.sid } });

      const third = (await refresh(first.refreshToken).expect(200)).body as TokenPair;
      expect(third.refreshToken).not.toBe(second.refreshToken);
      expect(third.refreshToken).not.toBe(first.refreshToken);
      await expect(verifier.verifyToken(third.accessToken)).resolves.toEqual({
        userId,
        sessionId: first.sid,
      });

      // Nothing was revoked: the earlier successor keeps working and so does the new one.
      const after = await prisma.session.findUniqueOrThrow({ where: { id: first.sid } });
      expect(after.revokedAt).toBeNull();
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
      expect(await isAccepted(second.accessToken)).toBe(true);
      await refresh(second.refreshToken).expect(200);
      await refresh(third.refreshToken).expect(200);

      // Only digests are stored for every token issued.
      const rows = await prisma.refreshToken.findMany({ where: { sessionId: first.sid } });
      const hashes = rows.map((row) => row.tokenHash);
      expect(hashes).toContain(hashRefreshToken(third.refreshToken));
      expect(hashes).not.toContain(third.refreshToken);
    });

    it('answers 401 for a rotated token retried within the window on a revoked session', async () => {
      const first = await login();
      await refresh(first.refreshToken).expect(200);
      await prisma.session.update({ where: { id: first.sid }, data: { revokedAt: new Date() } });
      await refresh(first.refreshToken).expect(401);
    });

    it('answers 401 for a rotated token retried within the window on an expired session', async () => {
      const first = await login();
      await refresh(first.refreshToken).expect(200);
      await prisma.session.update({
        where: { id: first.sid },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await refresh(first.refreshToken).expect(401);
    });
  });

  describe('reuse grace window disabled', () => {
    let strictApp: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ApiConfigModule.forRoot(authTestConfig({ refreshReuseGraceSeconds: 0 })),
          PrismaModule,
          AuthModule,
        ],
      }).compile();
      strictApp = moduleRef.createNestApplication();
      configureHttp(strictApp, { logSink: () => undefined });
      await strictApp.init();
    });

    afterAll(async () => {
      await strictApp?.close();
    });

    it('treats any reuse of a rotated token as a breach and revokes the session', async () => {
      const server = strictApp.getHttpServer();
      const first = (await request(server).post('/auth/login').send({ email, password }))
        .body as TokenPair;
      const send = (refreshToken: string) =>
        request(server).post('/auth/refresh').send({ refreshToken });
      await send(first.refreshToken).expect(200);

      await send(first.refreshToken).expect(401);

      const sid = jwt.decode<{ sid: string }>(first.accessToken).sid;
      const session = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
      expect(session.revokedAt).not.toBeNull();
    });
  });

  describe('session state', () => {
    it('answers 401 for a revoked session', async () => {
      const first = await login();
      await prisma.session.update({ where: { id: first.sid }, data: { revokedAt: new Date() } });
      await refresh(first.refreshToken).expect(401);
      expect(await prisma.refreshToken.count({ where: { sessionId: first.sid } })).toBe(1);
    });

    it('answers 401 for an expired session', async () => {
      const first = await login();
      await prisma.session.update({
        where: { id: first.sid },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await refresh(first.refreshToken).expect(401);
      expect(await prisma.refreshToken.count({ where: { sessionId: first.sid } })).toBe(1);
    });
  });
});
