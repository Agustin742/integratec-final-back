import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
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
import { SessionVerifier } from './session-verifier.service';
import { authTestConfig } from './testing/auth-test-config';

describe('Auth / Logout (HU-AUT-002)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: SessionVerifier;
  let jwt: JwtService;
  const config = authTestConfig();
  const password = 'correctHorseBattery1';
  const email = `logout.${Date.now()}@example.com`;
  let userId: string;

  const login = async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const { accessToken, refreshToken } = res.body as {
      accessToken: string;
      refreshToken: string;
    };
    return { accessToken, refreshToken, sid: jwt.decode<{ sid: string }>(accessToken).sid };
  };

  const logout = (header?: string) => {
    const req = request(app.getHttpServer()).post('/auth/logout');
    return header === undefined ? req : req.set('Authorization', header);
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
        displayName: 'Logout Tester',
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

  it('answers 204 with no body and revokes the session', async () => {
    const { accessToken, sid } = await login();
    const res = await logout(`Bearer ${accessToken}`).expect(204);
    expect(res.text).toBe('');
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(session.revokedAt).not.toBeNull();
  });

  it('invalidates the access token and the refresh token', async () => {
    const { accessToken, refreshToken } = await login();
    await logout(`Bearer ${accessToken}`).expect(204);

    await expect(verifier.verifyToken(accessToken)).rejects.toBeInstanceOf(UnauthorizedException);
    // Logging out again with the now-dead token is a generic 401.
    await logout(`Bearer ${accessToken}`).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('keeps other sessions of the same user alive', async () => {
    const a = await login();
    const b = await login();
    await logout(`Bearer ${a.accessToken}`).expect(204);
    await expect(verifier.verifyToken(b.accessToken)).resolves.toEqual({
      userId,
      sessionId: b.sid,
    });
  });

  it('does not overwrite the revocation time of an already revoked session', async () => {
    const { accessToken, sid } = await login();
    await logout(`Bearer ${accessToken}`).expect(204);
    const earlier = new Date(Date.now() - 60_000);
    await prisma.session.update({ where: { id: sid }, data: { revokedAt: earlier } });
    await logout(`Bearer ${accessToken}`).expect(401);
    const session = await prisma.session.findUniqueOrThrow({ where: { id: sid } });
    expect(session.revokedAt?.getTime()).toBe(earlier.getTime());
  });

  it.each([[undefined], [''], ['Bearer'], ['Bearer not-a-jwt'], ['Basic dXNlcjpwYXNz']])(
    'answers 401 UNAUTHENTICATED for the Authorization header %j',
    async (header) => {
      const res = await logout(header).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    },
  );
});
