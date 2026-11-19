import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BadgeConditionType, StreakQualifyingSource } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { PrismaService } from '../prisma/prisma.service';
import { StreakService } from './streak.service';

// Real PostgreSQL and the root module/global guard; only session identity is overridden.
// Append-only synthetic fixtures. The caller owns disposal of this isolated database.
const databaseUrl = loadIsolatedTestDatabaseUrl();
const makeIds = () => ({ student: randomUUID(), other: randomUUID() });

describe('gamification HTTP contract (own streak and badges)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let streaks: StreakService;
  let ids: ReturnType<typeof makeIds>;
  const get = (actor?: string) => {
    const req = request(app.getHttpServer()).get('/gamification/me');
    if (actor) req.set('Authorization', `Bearer ${actor}`);
    return req;
  };
  const envelope = (body: unknown, code: string) =>
    expect(body).toMatchObject({
      error: { code, message: expect.any(String), correlationId: expect.any(String) },
    });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ ...authTestConfig(), databaseUrl })],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header: string) => {
          const actor = header?.replace('Bearer ', '');
          if (!actor || actor === 'invalid') throw new UnauthorizedException();
          return { userId: actor, sessionId: randomUUID() };
        },
      })
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    streaks = app.get(StreakService);
  }, 20_000);
  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    ids = makeIds();
    // The database is append-only across tests: stale catalog entries from
    // earlier tests (or runs) must not be evaluated against new students.
    await prisma.badgeDefinition.updateMany({ data: { isActive: false } });
    await prisma.user.createMany({
      data: [ids.student, ids.other].map((id) => ({
        id,
        email: `gam-http-${id}@example.invalid`,
        displayName: 'Synthetic user',
        passwordHash: 'unused-synthetic-hash',
        registrationPath: 'INDEPENDENT_TEACHER',
      })),
    });
  });

  it('returns zeroed own data for a student without activity', async () => {
    const response = await get(ids.student).expect(200);
    expect(response.body).toEqual({
      streak: { currentStreak: 0, bestStreak: 0, lastQualifyingDay: null },
      badges: [],
    });
  });

  it('never exposes another user’s streak or badges: reads are strictly own-data', async () => {
    await prisma.badgeDefinition.create({
      data: {
        code: `http_own_${ids.student.slice(0, 8)}`,
        name: 'Own only',
        description: 'One qualifying day.',
        conditionType: BadgeConditionType.STREAK_REACHED,
        threshold: 1,
      },
    });
    await prisma.$transaction((tx) =>
      streaks.recordQualifying(tx, {
        studentId: ids.student,
        source: StreakQualifyingSource.ON_TIME_SUBMISSION,
        at: new Date(),
      }),
    );

    const other = await get(ids.other).expect(200);
    expect(other.body).toMatchObject({
      streak: { currentStreak: 0, bestStreak: 0 },
      badges: [],
    });
  });

  it('serves the own summary and lists the badge_awarded notice after a qualifying day', async () => {
    const badge = await prisma.badgeDefinition.create({
      data: {
        code: `http_first_${ids.student.slice(0, 8)}`,
        name: 'First day',
        description: 'One qualifying local day.',
        conditionType: BadgeConditionType.STREAK_REACHED,
        threshold: 1,
      },
    });
    await prisma.$transaction((tx) =>
      streaks.recordQualifying(tx, {
        studentId: ids.student,
        source: StreakQualifyingSource.ON_TIME_SUBMISSION,
        at: new Date(),
      }),
    );

    const summary = await get(ids.student).expect(200);
    expect(summary.body).toMatchObject({
      streak: {
        currentStreak: 1,
        bestStreak: 1,
        lastQualifyingDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      },
      badges: [
        {
          code: badge.code,
          name: 'First day',
          description: 'One qualifying local day.',
          awardedAt: expect.any(String),
        },
      ],
    });
    expect(summary.body.badges[0].id).toEqual(expect.any(String));

    // The classroom-free notice is materialized by the outbox and listed for the
    // recipient without any classroom context.
    const dispatcher = app.get(OutboxDispatcher);
    const events = await prisma.outboxEvent.findMany({
      where: {
        type: 'notification.requested',
        AND: [
          { payload: { path: ['kind'], equals: 'badge_awarded' } },
          { payload: { path: ['recipientId'], equals: ids.student } },
        ],
      },
    });
    const badgeEvents = events;
    await dispatcher.dispatchPending(
      100,
      new Date(),
      ['notification.requested'],
      badgeEvents.map((event) => event.id),
    );

    const listed = await request(app.getHttpServer())
      .get('/notifications')
      .set('Authorization', `Bearer ${ids.student}`)
      .expect(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toEqual({
      id: expect.any(String),
      kind: 'badge_awarded',
      classroomId: null,
      resourceId: expect.any(String),
      studentId: ids.student,
      readAt: null,
      createdAt: expect.any(String),
    });
  });

  it.each([undefined, 'Bearer invalid'])(
    'requires valid credentials at /gamification/me (%s)',
    async (header) => {
      const req = get();
      if (header) req.set('Authorization', header);
      envelope((await req.expect(401)).body, 'UNAUTHENTICATED');
    },
  );
});
