import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiConfigModule } from '../config/config.module';
import { configureHttp } from '../http/configure-http';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InMemoryEmailAdapter } from '../platform/email/in-memory-email.adapter';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { AuthModule } from './auth.module';
import { PASSWORD_RESET_REQUESTED_EVENT } from './password-reset-events';
import { PASSWORD_RESET_TOKEN_MAX_LENGTH } from './dto/password-reset-confirm-request.dto';
import { hashOpaqueToken } from './session-tokens';
import { SessionVerifier } from './session-verifier.service';
import { authTestConfig } from './testing/auth-test-config';

describe('Auth / Password reset (HU-AUT-002)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let verifier: SessionVerifier;
  let jwt: JwtService;
  let dispatcher: OutboxDispatcher;
  let mailbox: InMemoryEmailAdapter;
  const config = authTestConfig();
  const oldPassword = 'correctHorseBattery1';
  const newPassword = 'brandNewPassword42';
  const email = `reset.${Date.now()}@example.com`;
  let userId: string;

  const requestReset = (body: unknown) =>
    request(app.getHttpServer())
      .post('/auth/password-reset/request')
      .send(body as object);
  const confirm = (body: unknown) =>
    request(app.getHttpServer())
      .post('/auth/password-reset/confirm')
      .send(body as object);
  const login = (password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  /** Delivers pending reset events, as the polling dispatcher does in production. */
  const deliver = () =>
    dispatcher.dispatchPending(50, new Date(), [PASSWORD_RESET_REQUESTED_EVENT]);

  /** Requests a reset, delivers the event and returns the raw token found in the email. */
  const issueToken = async (): Promise<string> => {
    mailbox.clear();
    await requestReset({ email }).expect(202);
    await deliver();
    expect(mailbox.sent).toHaveLength(1);
    const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(mailbox.sent[0].text);
    expect(match).not.toBeNull();
    return (match as RegExpExecArray)[1];
  };

  const openSession = async () => {
    const res = await login(oldPassword).expect(200);
    const { accessToken, refreshToken } = res.body as { accessToken: string; refreshToken: string };
    return { accessToken, refreshToken, sid: jwt.decode<{ sid: string }>(accessToken).sid };
  };

  const isAccepted = (accessToken: string) =>
    verifier.verifyToken(accessToken).then(
      () => true,
      () => false,
    );

  const resetUserState = async () => {
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(oldPassword, 4) },
    });
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.outboxEvent.deleteMany({ where: { type: PASSWORD_RESET_REQUESTED_EVENT } });
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
    dispatcher = app.get(OutboxDispatcher, { strict: false });
    mailbox = app.get(InMemoryEmailAdapter, { strict: false });

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(oldPassword, 4),
        displayName: 'Reset Tester',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userId = user.id;
  });

  beforeEach(resetUserState);

  afterAll(async () => {
    await resetUserState();
    await prisma?.user.deleteMany({ where: { id: userId } });
    await app?.close();
  });

  describe('POST /auth/password-reset/request', () => {
    it('answers 202 with an identical body for a known and an unknown email', async () => {
      const known = await requestReset({ email }).expect(202);
      const unknown = await requestReset({ email: `nobody.${Date.now()}@example.com` }).expect(202);

      expect(known.body).toEqual(unknown.body);
      expect(known.headers['content-type']).toEqual(unknown.headers['content-type']);
    });

    it('records an outbox event with only the user id for a known email', async () => {
      await requestReset({ email }).expect(202);

      const events = await prisma.outboxEvent.findMany({
        where: { type: PASSWORD_RESET_REQUESTED_EVENT },
      });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toEqual({ userId });
    });

    it('records nothing for an unknown email', async () => {
      await requestReset({ email: `nobody.${Date.now()}@example.com` }).expect(202);

      expect(
        await prisma.outboxEvent.count({ where: { type: PASSWORD_RESET_REQUESTED_EVENT } }),
      ).toBe(0);
    });

    it('matches the email regardless of case and surrounding spaces', async () => {
      await requestReset({ email: `  ${email.toUpperCase()} ` }).expect(202);

      expect(
        await prisma.outboxEvent.count({ where: { type: PASSWORD_RESET_REQUESTED_EVENT } }),
      ).toBe(1);
    });

    it.each([
      [{}],
      [{ email: 'not-an-email' }],
      [{ email: 42 }],
      [{ email: `${'a'.repeat(250)}@x.io` }],
    ])('rejects %j with 400 VALIDATION_FAILED', async (body) => {
      const res = await requestReset(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('does not need a bearer credential', async () => {
      await requestReset({ email }).expect(202);
    });
  });

  describe('email delivery', () => {
    it('sends one email with a link and stores only the token hash', async () => {
      const token = await issueToken();

      expect(mailbox.sent[0].to).toBe(email);
      expect(mailbox.sent[0].text).toContain(`${config.passwordResetUrlBase}?token=${token}`);
      const rows = await prisma.passwordResetToken.findMany({ where: { userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(hashOpaqueToken(token));
      expect(rows[0].tokenHash).not.toContain(token);
      expect(rows[0].usedAt).toBeNull();
      const lifetimeMs = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime();
      expect(Math.abs(lifetimeMs - config.passwordResetTtlSeconds * 1000)).toBeLessThan(5_000);
    });

    it('never writes the raw token or the email into the outbox', async () => {
      const token = await issueToken();

      const events = await prisma.outboxEvent.findMany({
        where: { type: PASSWORD_RESET_REQUESTED_EVENT },
      });
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(token);
      expect(serialized).not.toContain(email);
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    it('changes the password: the new one logs in, the old one does not', async () => {
      const token = await issueToken();

      await confirm({ token, newPassword }).expect(204);

      await login(newPassword).expect(200);
      await login(oldPassword).expect(401);
    });

    it('is single-use: a second confirmation with the same token fails and changes nothing', async () => {
      const token = await issueToken();
      await confirm({ token, newPassword }).expect(204);

      const second = await confirm({ token, newPassword: 'anotherPassword99' }).expect(400);

      expect(second.body.error.code).toBe('BAD_REQUEST');
      await login(newPassword).expect(200);
      await login('anotherPassword99').expect(401);
    });

    it('lets only one of two concurrent confirmations win', async () => {
      const token = await issueToken();

      const results = await Promise.all([
        confirm({ token, newPassword }),
        confirm({ token, newPassword }),
      ]);

      expect(results.map((res) => res.status).sort()).toEqual([204, 400]);
    });

    it('revokes every previous session: access and refresh tokens stop working', async () => {
      const first = await openSession();
      const second = await openSession();
      const token = await issueToken();

      await confirm({ token, newPassword }).expect(204);

      expect(await isAccepted(first.accessToken)).toBe(false);
      expect(await isAccepted(second.accessToken)).toBe(false);
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
      const revoked = await prisma.session.findMany({ where: { userId } });
      expect(revoked.every((session) => session.revokedAt !== null)).toBe(true);
    });

    it('keeps sessions opened after the reset usable', async () => {
      const token = await issueToken();
      await confirm({ token, newPassword }).expect(204);

      const res = await login(newPassword).expect(200);

      expect(await isAccepted((res.body as { accessToken: string }).accessToken)).toBe(true);
    });

    it('rejects an expired token with the generic error and changes nothing', async () => {
      const token = await issueToken();
      await prisma.passwordResetToken.updateMany({
        where: { userId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await confirm({ token, newPassword }).expect(400);

      expect(res.body.error.code).toBe('BAD_REQUEST');
      await login(oldPassword).expect(200);
    });

    it('answers unknown, used and expired tokens with the same error body', async () => {
      const usedToken = await issueToken();
      await confirm({ token: usedToken, newPassword }).expect(204);
      const expiredToken = await issueToken();
      await prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const bodies = await Promise.all(
        [usedToken, expiredToken, 'unknown-token-value'].map(async (token) => {
          const res = await confirm({ token, newPassword }).expect(400);
          const stable = { ...(res.body.error as Record<string, unknown>) };
          delete stable.correlationId;
          return stable;
        }),
      );

      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
    });

    it('invalidates the other pending reset tokens of the user', async () => {
      const older = await issueToken();
      const newer = await issueToken();

      await confirm({ token: newer, newPassword }).expect(204);

      await confirm({ token: older, newPassword: 'anotherPassword99' }).expect(400);
      await login(newPassword).expect(200);
    });

    it('does not touch the password nor the sessions when the token is invalid', async () => {
      const session = await openSession();

      await confirm({ token: 'unknown-token-value', newPassword }).expect(400);

      expect(await isAccepted(session.accessToken)).toBe(true);
      await login(oldPassword).expect(200);
    });

    it('applies the registration password policy', async () => {
      const token = await issueToken();

      const tooShort = await confirm({ token, newPassword: 'short' }).expect(400);
      const tooLong = await confirm({ token, newPassword: 'a'.repeat(73) }).expect(400);
      const tooManyBytes = await confirm({ token, newPassword: 'ñ'.repeat(37) }).expect(400);

      for (const res of [tooShort, tooLong, tooManyBytes]) {
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field: 'newPassword' })]),
        );
      }
      // A rejected request must not burn the token.
      await confirm({ token, newPassword }).expect(204);
    });

    it.each([
      [{}],
      [{ token: 7, newPassword: 'longEnough1' }],
      [{ token: '', newPassword: 'longEnough1' }],
    ])('rejects %j with 400 VALIDATION_FAILED', async (body) => {
      const res = await confirm(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a token over the length limit with 400 VALIDATION_FAILED', async () => {
      const res = await confirm({
        token: 'a'.repeat(PASSWORD_RESET_TOKEN_MAX_LENGTH + 1),
        newPassword,
      }).expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'token' })]),
      );
    });
  });
});
