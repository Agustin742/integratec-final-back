import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuthDataCleanupService } from './auth-data-cleanup.service';
import { AuthModule } from './auth.module';
import { authTestConfig } from './testing/auth-test-config';

const DAY_MS = 86_400_000;

describe('Auth / Data cleanup (issue #70)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let service: AuthDataCleanupService;
  const config = authTestConfig({
    authDataRetentionSeconds: 30 * 86400,
    authCleanupBatchSize: 1000,
  });
  const email = `cleanup.${Date.now()}@example.com`;
  let userId: string;

  // A fixed instant far in the past: every row seeded here is older than anything another
  // spec creates, so counts stay exact even though the service prunes whole tables.
  const now = new Date('2020-06-01T00:00:00.000Z');
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY_MS);

  const seedSession = (expiresAt: Date) => prisma.session.create({ data: { userId, expiresAt } });

  const seedToken = (sessionId: string, rotatedAt: Date | null) =>
    prisma.refreshToken.create({
      data: { sessionId, tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'), rotatedAt },
    });

  const seedReset = (expiresAt: Date, usedAt: Date | null = null) =>
    prisma.passwordResetToken.create({
      data: {
        userId,
        expiresAt,
        usedAt,
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
      },
    });

  const existingIds = async () => ({
    sessions: new Set((await prisma.session.findMany({ where: { userId } })).map((r) => r.id)),
    tokens: new Set(
      (await prisma.refreshToken.findMany({ where: { session: { userId } } })).map((r) => r.id),
    ),
    resets: new Set(
      (await prisma.passwordResetToken.findMany({ where: { userId } })).map((r) => r.id),
    ),
  });

  const clean = async () => {
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    service = app.get(AuthDataCleanupService);

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: 'unused-hash',
        displayName: 'Cleanup Tester',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userId = user.id;
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await prisma?.user.deleteMany({ where: { id: userId } });
    await app?.close();
  });

  it('deletes sessions expired before the retention cutoff together with their tokens', async () => {
    const old = await seedSession(ago(31));
    const oldToken = await seedToken(old.id, null);
    const recentlyExpired = await seedSession(ago(5));
    const recentToken = await seedToken(recentlyExpired.id, null);
    const live = await seedSession(ahead(7));
    const liveToken = await seedToken(live.id, null);

    const result = await service.run(now);

    expect(result.sessions).toBe(1);
    const kept = await existingIds();
    expect(kept.sessions).toEqual(new Set([recentlyExpired.id, live.id]));
    expect(kept.tokens).toEqual(new Set([recentToken.id, liveToken.id]));
    expect(kept.tokens.has(oldToken.id)).toBe(false);
  });

  it('deletes tokens rotated before the cutoff and keeps recent and never-rotated ones', async () => {
    const live = await seedSession(ahead(7));
    const oldRotated = await seedToken(live.id, ago(31));
    const recentRotated = await seedToken(live.id, ago(2));
    const current = await seedToken(live.id, null);

    const result = await service.run(now);

    expect(result.refreshTokens).toBe(1);
    expect((await existingIds()).tokens).toEqual(new Set([recentRotated.id, current.id]));
    expect((await existingIds()).tokens.has(oldRotated.id)).toBe(false);
    expect((await existingIds()).sessions.has(live.id)).toBe(true);
  });

  it('deletes reset tokens used or expired before the cutoff and keeps the rest', async () => {
    const usedOld = await seedReset(ago(40), ago(35));
    const expiredOld = await seedReset(ago(31));
    const pending = await seedReset(ahead(1));
    const usedRecently = await seedReset(ahead(1), ago(3));
    const expiredRecently = await seedReset(ago(2));

    const result = await service.run(now);

    expect(result.passwordResetTokens).toBe(2);
    const { resets } = await existingIds();
    expect(resets).toEqual(new Set([pending.id, usedRecently.id, expiredRecently.id]));
    expect(resets.has(usedOld.id) || resets.has(expiredOld.id)).toBe(false);
  });

  it('still deletes everything when the batch size is smaller than the matching rows', async () => {
    const small = new AuthDataCleanupService(
      prisma,
      authTestConfig({ authDataRetentionSeconds: 30 * 86400, authCleanupBatchSize: 2 }),
    );
    const live = await seedSession(ahead(7));
    for (let i = 0; i < 5; i++) {
      await seedToken(live.id, ago(40));
      await seedSession(ago(40));
      await seedReset(ago(40));
    }
    const keptToken = await seedToken(live.id, null);

    const result = await small.run(now);

    expect(result).toEqual({ sessions: 5, refreshTokens: 5, passwordResetTokens: 5 });
    const kept = await existingIds();
    expect(kept.sessions).toEqual(new Set([live.id]));
    expect(kept.tokens).toEqual(new Set([keptToken.id]));
    expect(kept.resets.size).toBe(0);
  });

  it('is idempotent: a second run finds nothing to delete', async () => {
    const old = await seedSession(ago(60));
    await seedToken(old.id, ago(60));
    await seedReset(ago(60), ago(60));

    const first = await service.run(now);
    const second = await service.run(now);

    expect(first.sessions + first.refreshTokens + first.passwordResetTokens).toBeGreaterThan(0);
    expect(second).toEqual({ sessions: 0, refreshTokens: 0, passwordResetTokens: 0 });
  });
});
