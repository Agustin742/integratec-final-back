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

const MISSING_ID = '00000000-0000-4000-8000-000000000000';

describe('SessionVerifier (HU-AUT-002)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: SessionVerifier;
  let jwt: JwtService;
  const config = authTestConfig();
  const password = 'correctHorseBattery1';
  const email = `verifier.${Date.now()}@example.com`;
  let userId: string;

  const login = async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const accessToken = res.body.accessToken as string;
    const { sid } = jwt.decode<{ sid: string }>(accessToken);
    return { accessToken, sid };
  };

  const expectRejected = async (header: string | undefined) => {
    await expect(verifier.verifyAuthorizationHeader(header)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
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
        displayName: 'Verifier Tester',
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

  it('accepts a fresh login token and returns the user and session ids', async () => {
    const { accessToken, sid } = await login();
    await expect(verifier.verifyAuthorizationHeader(`Bearer ${accessToken}`)).resolves.toEqual({
      userId,
      sessionId: sid,
    });
    await expect(verifier.verifyToken(accessToken)).resolves.toEqual({ userId, sessionId: sid });
  });

  it('rejects a missing Authorization header', async () => {
    await expectRejected(undefined);
    await expectRejected('');
  });

  it.each(['abc.def.ghi', 'Basic dXNlcjpwYXNz', 'Bearer', 'Bearer ', 'Bearer a b'])(
    'rejects the malformed header %j',
    async (header) => {
      await expectRejected(header);
    },
  );

  it('rejects a token that is not a JWT', async () => {
    await expectRejected('Bearer not-a-jwt');
  });

  it('rejects a token signed with another secret', async () => {
    const { sid } = await login();
    const forged = await jwt.signAsync(
      { sub: userId, sid },
      { secret: 'another-secret-that-is-long-enough-0000', expiresIn: 60 },
    );
    await expectRejected(`Bearer ${forged}`);
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const { accessToken } = await login();
    // The untouched token is accepted: it belongs to a live session.
    await expect(verifier.verifyToken(accessToken)).resolves.toBeDefined();

    // Same real `sub` and `sid` (live session), same expiry; only an extra claim is
    // added and the original signature kept. This fails solely because the signature
    // no longer matches the payload, so it proves the signature check runs.
    const [header, encodedPayload, signature] = accessToken.split('.');
    const original = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as object;
    const altered = Buffer.from(JSON.stringify({ ...original, role: 'admin' })).toString(
      'base64url',
    );
    await expectRejected(`Bearer ${header}.${altered}.${signature}`);
  });

  it('rejects an unsigned (alg none) token', async () => {
    const { sid } = await login();
    const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({
      sub: userId,
      sid,
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    await expectRejected(`Bearer ${unsigned}`);
  });

  it('rejects an expired access token', async () => {
    const { sid } = await login();
    const expired = await jwt.signAsync(
      { sub: userId, sid },
      { secret: config.jwtSecret, expiresIn: -10 },
    );
    await expectRejected(`Bearer ${expired}`);
  });

  it('rejects a token for a session that does not exist', async () => {
    const orphan = await jwt.signAsync(
      { sub: userId, sid: MISSING_ID },
      { secret: config.jwtSecret, expiresIn: 60 },
    );
    await expectRejected(`Bearer ${orphan}`);
  });

  it('rejects a valid token once its session is revoked', async () => {
    const { accessToken, sid } = await login();
    await prisma.session.update({ where: { id: sid }, data: { revokedAt: new Date() } });
    await expectRejected(`Bearer ${accessToken}`);
  });

  it('rejects a valid token once its session has expired', async () => {
    const { accessToken, sid } = await login();
    await prisma.session.update({
      where: { id: sid },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expectRejected(`Bearer ${accessToken}`);
  });

  it('rejects a token whose subject does not own the session', async () => {
    const { sid } = await login();
    const other = await jwt.signAsync(
      { sub: '00000000-0000-4000-8000-000000000001', sid },
      { secret: config.jwtSecret, expiresIn: 60 },
    );
    await expectRejected(`Bearer ${other}`);
  });
});
