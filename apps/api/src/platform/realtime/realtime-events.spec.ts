import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../../auth/auth.module';
import { AuthService } from '../../auth/auth.service';
import { hashOpaqueToken } from '../../auth/session-tokens';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
} from './realtime-events';
import { RealtimeEventsRecorder } from './realtime-events.recorder';

describe('Realtime eviction events (#25)', () => {
  let app: INestApplication;
  let strictApp: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const password = 'correctHorseBattery1';
  const email = `evict.${Date.now()}@example.com`;
  let userId: string;
  let classroomId: string;

  const sessionEvents = (id = userId) =>
    prisma.outboxEvent.findMany({
      where: { type: REALTIME_SESSIONS_REVOKED_EVENT, payload: { path: ['userId'], equals: id } },
      orderBy: { occurredAt: 'asc' },
    });

  const login = async (server = app) => {
    const res = await request(server.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    const { accessToken, refreshToken } = res.body as { accessToken: string; refreshToken: string };
    return { accessToken, refreshToken, sid: jwt.decode<{ sid: string }>(accessToken).sid };
  };

  const build = async (overrides = {}) => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(authTestConfig(overrides)), PrismaModule, AuthModule],
    }).compile();
    const nest = moduleRef.createNestApplication();
    configureHttp(nest, { logSink: () => undefined });
    await nest.init();
    return nest;
  };

  beforeAll(async () => {
    app = await build();
    strictApp = await build({ refreshReuseGraceSeconds: 0 });
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 4),
        displayName: 'Evict Tester',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userId = user.id;
    const classroom = await prisma.classroom.create({
      data: { name: `Evict ${Date.now()}`, independentTeacherId: userId },
    });
    classroomId = classroom.id;
  });

  afterAll(async () => {
    await prisma?.outboxEvent.deleteMany({
      where: { payload: { path: ['userId'], equals: userId } },
    });
    await prisma?.classroom.deleteMany({ where: { id: classroomId } });
    await prisma?.passwordResetToken.deleteMany({ where: { userId } });
    await prisma?.session.deleteMany({ where: { userId } });
    await prisma?.user.deleteMany({ where: { id: userId } });
    await app?.close();
    await strictApp?.close();
  });

  describe('membership removal', () => {
    it('records one classroom-access event inside the caller transaction', async () => {
      const recorder = app.get(RealtimeEventsRecorder);

      await prisma.$transaction((tx) =>
        recorder.recordClassroomAccessRevoked(tx, { userId, classroomId }),
      );

      const events = await prisma.outboxEvent.findMany({
        where: {
          type: REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
          payload: { path: ['classroomId'], equals: classroomId },
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ userId, classroomId });
    });

    it('records nothing when the caller transaction rolls back', async () => {
      const recorder = app.get(RealtimeEventsRecorder);
      const before = await prisma.outboxEvent.count({
        where: { type: REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT },
      });

      await expect(
        prisma.$transaction(async (tx) => {
          await recorder.recordClassroomAccessRevoked(tx, { userId, classroomId });
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');

      expect(
        await prisma.outboxEvent.count({
          where: { type: REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT },
        }),
      ).toBe(before);
    });
  });

  describe('logout', () => {
    it('records a session-revoked event carrying the user and the session', async () => {
      const { accessToken, sid } = await login();
      const before = (await sessionEvents()).length;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const events = await sessionEvents();
      expect(events).toHaveLength(before + 1);
      expect(events[events.length - 1].payload).toEqual({ userId, sessionId: sid });
    });

    it('records nothing for a session that was already revoked', async () => {
      const { accessToken, sid } = await login();
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
      const before = (await sessionEvents()).length;

      await app.get(AuthService).logout(sid);

      expect(await sessionEvents()).toHaveLength(before);
    });

    it('records nothing for an unknown session', async () => {
      const before = (await sessionEvents()).length;

      await app.get(AuthService).logout('99999999-9999-4999-8999-999999999999');

      expect(await sessionEvents()).toHaveLength(before);
    });
  });

  describe('refresh token reuse', () => {
    it('records a session-revoked event when reuse revokes the session', async () => {
      const first = await login(strictApp);
      const send = (refreshToken: string) =>
        request(strictApp.getHttpServer()).post('/auth/refresh').send({ refreshToken });
      await send(first.refreshToken).expect(200);
      const before = (await sessionEvents()).length;

      await send(first.refreshToken).expect(401);

      const events = await sessionEvents();
      expect(events).toHaveLength(before + 1);
      expect(events[events.length - 1].payload).toEqual({ userId, sessionId: first.sid });
    });
  });

  describe('password reset', () => {
    it('records one event for the whole account, without a session id', async () => {
      await login();
      await login();
      const raw = `raw-reset-token-${Date.now()}`;
      await prisma.passwordResetToken.create({
        data: { userId, tokenHash: hashOpaqueToken(raw), expiresAt: new Date(Date.now() + 60_000) },
      });
      const before = (await sessionEvents()).length;

      await request(app.getHttpServer())
        .post('/auth/password-reset/confirm')
        .send({ token: raw, newPassword: 'brandNewPassword42' })
        .expect(204);

      const events = await sessionEvents();
      expect(events).toHaveLength(before + 1);
      expect(events[events.length - 1].payload).toEqual({ userId });
    });
  });
});
