import { createHash } from 'node:crypto';
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
import { authTestConfig } from './testing/auth-test-config';

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('Auth / Login (HU-AUT-002)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const config = authTestConfig();
  const password = 'correctHorseBattery1';
  const email = `login.${Date.now()}@example.com`;
  let userId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        displayName: 'Login Tester',
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
    it.each([
      [{ password: 'correctHorseBattery1' }, 'email'],
      [{ email: 'not-an-email', password: 'correctHorseBattery1' }, 'email'],
      [{ email: 'someone@example.com' }, 'password'],
      [{ email: 'someone@example.com', password: 123 }, 'password'],
      [{ email: 'someone@example.com', password: '🔒'.repeat(25) }, 'password'],
    ])('returns 400 VALIDATION_FAILED for %j', async (body, field) => {
      const res = await request(app.getHttpServer()).post('/auth/login').send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field })]),
      );
    });
  });

  describe('successful login', () => {
    it('returns Bearer tokens and persists a session with a hashed refresh token only', async () => {
      const before = Date.now();
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `  ${email.toUpperCase()} `, password })
        .expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: config.accessTokenTtlSeconds,
      });
      const { accessToken, refreshToken } = res.body as {
        accessToken: string;
        refreshToken: string;
      };

      const claims = await app
        .get(JwtService)
        .verifyAsync<{ sub: string; sid: string }>(accessToken, { secret: config.jwtSecret });
      expect(claims.sub).toBe(userId);

      const session = await prisma.session.findUniqueOrThrow({
        where: { id: claims.sid },
        include: { refreshTokens: true },
      });
      expect(session.userId).toBe(userId);
      expect(session.revokedAt).toBeNull();
      const expectedExpiry = before + config.refreshTokenTtlSeconds * 1000;
      expect(Math.abs(session.expiresAt.getTime() - expectedExpiry)).toBeLessThan(10_000);

      expect(session.refreshTokens).toHaveLength(1);
      expect(session.refreshTokens[0].tokenHash).toBe(sha256Hex(refreshToken));
      expect(session.refreshTokens[0].rotatedAt).toBeNull();

      // The raw refresh token never reaches the database.
      expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(await prisma.refreshToken.count({ where: { tokenHash: refreshToken } })).toBe(0);
    });

    it('issues an independent session and refresh token on every login', async () => {
      const login = () =>
        request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(200);
      const [a, b] = await Promise.all([login(), login()]);
      expect(a.body.refreshToken).not.toBe(b.body.refreshToken);
      expect(a.body.accessToken).not.toBe(b.body.accessToken);
    });
  });

  describe('failed login', () => {
    it('answers wrong password and unknown email with the identical generic 401', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'definitelyWrongPassword' })
        .expect(401);
      const unknownEmail = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `nobody.${Date.now()}@example.com`, password })
        .expect(401);

      expect(wrongPassword.body.error.code).toBe('UNAUTHENTICATED');
      const strip = (body: { error: Record<string, unknown> }) => ({
        error: { ...body.error, correlationId: undefined },
      });
      expect(strip(unknownEmail.body)).toEqual(strip(wrongPassword.body));
      expect(JSON.stringify(wrongPassword.body)).not.toContain(email);
    });

    it('does not create a session when authentication fails', async () => {
      const before = await prisma.session.count({ where: { userId } });
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'definitelyWrongPassword' })
        .expect(401);
      expect(await prisma.session.count({ where: { userId } })).toBe(before);
    });
  });
});
