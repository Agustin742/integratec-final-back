import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessModule } from '../../access/access.module';
import { AuthModule } from '../../auth/auth.module';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { INTERNAL_SERVICE_SECRET_HEADER } from './internal-service.guard';
import { RealtimeJoinModule } from './realtime-join.module';

const ROUTE = '/internal/realtime/connected-time';

describe('POST /internal/realtime/connected-time (#25)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const config = authTestConfig();
  const ts = Date.now();
  const userIds: string[] = [];
  const classroomIds: string[] = [];

  let userId: string;
  let otherUserId: string;
  let classroomId: string;

  const post = (body: object, secret: string | null = config.internalServiceSecret) => {
    const req = request(app.getHttpServer()).post(ROUTE);
    return (secret === null ? req : req.set(INTERNAL_SERVICE_SECRET_HEADER, secret)).send(body);
  };
  const report = (overrides: object = {}) => ({
    userId,
    classroomId,
    connectedSeconds: 90,
    endedAt: '2026-11-10T15:30:00.000Z',
    ...overrides,
  });
  const rowsFor = (id: string) =>
    prisma.activityMetric.findMany({
      where: { userId: id, classroomId },
      orderBy: { day: 'asc' },
    });

  const makeUser = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        email: `${label}.${ts}@example.com`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: label,
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userIds.push(user.id);
    return user.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(config),
        PrismaModule,
        AuthModule,
        AccessModule,
        RealtimeJoinModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);

    userId = await makeUser('ct-user');
    otherUserId = await makeUser('ct-other');
    const classroom = await prisma.classroom.create({
      data: { name: `CT Classroom ${ts}`, independentTeacherId: userId },
    });
    classroomId = classroom.id;
    classroomIds.push(classroom.id);
  });

  afterAll(async () => {
    await prisma?.activityMetric.deleteMany({ where: { classroomId: { in: classroomIds } } });
    await prisma?.classroom.deleteMany({ where: { id: { in: classroomIds } } });
    await prisma?.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
  });

  it('stores the aggregate in one row per user, classroom and UTC day and answers 204', async () => {
    await post(report()).expect(204);

    const rows = await rowsFor(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ connectedSeconds: 90 });
    expect(rows[0].day.toISOString()).toBe('2026-11-10T00:00:00.000Z');
  });

  it('adds later reports of the same day to the same row instead of creating rows', async () => {
    await post(report({ userId: otherUserId, connectedSeconds: 60 })).expect(204);
    await post(report({ userId: otherUserId, connectedSeconds: 30 })).expect(204);
    await post(report({ userId: otherUserId, connectedSeconds: 10 })).expect(204);

    const rows = await rowsFor(otherUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0].connectedSeconds).toBe(100);
  });

  it('keeps a row per UTC day, assigning the day by the end of the session', async () => {
    const day = (iso: string) => report({ endedAt: iso, connectedSeconds: 5 });
    await post(day('2026-10-11T00:00:00.000Z')).expect(204);
    await post(day('2026-10-11T23:59:59.999Z')).expect(204);
    await post(day('2026-10-12T00:00:00.000Z')).expect(204);

    const rows = await rowsFor(userId);
    expect(rows.map((row) => [row.day.toISOString().slice(0, 10), row.connectedSeconds])).toEqual([
      ['2026-10-11', 10],
      ['2026-10-12', 5],
      ['2026-11-10', 90],
    ]);
  });

  it('adds up concurrent reports without losing any', async () => {
    const racing = await makeUser('ct-racing');
    await Promise.all(
      Array.from({ length: 8 }, () =>
        post(report({ userId: racing, connectedSeconds: 7 })).expect(204),
      ),
    );

    const rows = await rowsFor(racing);
    expect(rows).toHaveLength(1);
    expect(rows[0].connectedSeconds).toBe(56);
  });

  describe('service authentication', () => {
    it('rejects a missing secret with 401 and stores nothing', async () => {
      const before = await prisma.activityMetric.count();
      await post(report(), null).expect(401);
      await post(report(), 'x'.repeat(config.internalServiceSecret.length)).expect(401);
      expect(await prisma.activityMetric.count()).toBe(before);
    });
  });

  describe('validation', () => {
    it.each([
      ['zero seconds', { connectedSeconds: 0 }],
      ['negative seconds', { connectedSeconds: -5 }],
      ['fractional seconds', { connectedSeconds: 1.5 }],
      ['seconds as a string', { connectedSeconds: '90' }],
      ['more than a week of seconds', { connectedSeconds: 604801 }],
      ['a malformed userId', { userId: 'x' }],
      ['a malformed classroomId', { classroomId: 'x' }],
      ['a malformed endedAt', { endedAt: 'yesterday' }],
      ['a date without a time', { endedAt: '2026-11-10' }],
      ['an unexpected field', { role: 'STUDENT' }],
    ])('answers 400 for %s and stores nothing', async (_label, override) => {
      const before = await prisma.activityMetric.count();
      await post(report(override)).expect(400);
      expect(await prisma.activityMetric.count()).toBe(before);
    });

    it('answers 400 for an end more than an hour in the future', async () => {
      const future = new Date(Date.now() + 2 * 3_600_000).toISOString();
      await post(report({ endedAt: future })).expect(400);
    });

    it('answers 400 for an empty body', async () => {
      await post({}).expect(400);
    });
  });

  describe('unknown references', () => {
    it('answers 404 for an unknown user', async () => {
      await post(report({ userId: '99999999-9999-4999-8999-999999999999' })).expect(404);
    });

    it('answers 404 for an unknown classroom', async () => {
      await post(report({ classroomId: '99999999-9999-4999-8999-999999999999' })).expect(404);
    });
  });
});
