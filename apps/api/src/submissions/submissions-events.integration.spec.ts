import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, Prisma, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { STORAGE_PORT } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { pdfBytes } from '../testing/file-fixtures';
import { InMemoryStorage } from '../testing/in-memory-storage';
import { futureInstant } from '../testing/relative-dates';
import { SUBMISSION_ON_TIME_EVENT, type SubmissionOnTimePayload } from './submission-events';
import { SubmissionsModule } from './submissions.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();
const HOUR_MS = 3_600_000;

describe('submission outbox event PostgreSQL HTTP — activities-and-grading, platform outbox', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const storage = new InMemoryStorage();
  const [teacher, s1, s2] = Array.from({ length: 3 }, () => randomUUID());
  const users = [teacher, s1, s2];
  const classroomId = randomUUID();
  let fixtureReady = false;
  const token = (actor: string) => `Bearer submission-events-test:${actor}`;

  const publishedActivity = async (overrides: Partial<Prisma.ActivityUncheckedCreateInput> = {}) =>
    (
      await prisma.activity.create({
        data: {
          classroomId,
          createdById: teacher,
          type: 'TP',
          format: 'FILE',
          state: 'PUBLISHED',
          publishedAt: new Date(Date.now() - HOUR_MS),
          title: `Events ${randomUUID()}`,
          dueAt: futureInstant(7, 12),
          maxScore: 10,
          ...overrides,
        },
      })
    ).id;

  const submit = (activityId: string, options: { actor?: string; key?: string } = {}) =>
    request(app.getHttpServer())
      .post(`/activities/${activityId}/submissions`)
      .set('Authorization', token(options.actor ?? s1))
      .set('Idempotency-Key', options.key ?? randomUUID())
      .attach('files', Buffer.from(pdfBytes()), {
        filename: 'tarea.pdf',
        contentType: 'application/octet-stream',
      });

  const eventsOf = (activityId: string) =>
    prisma.outboxEvent.findMany({
      where: {
        type: SUBMISSION_ON_TIME_EVENT,
        payload: { path: ['activityId'], equals: activityId },
      },
    });
  const submissionsOf = (activityId: string) =>
    prisma.submission.findMany({ where: { activityId } });

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), SubmissionsModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer submission-events-test:'))
                throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer submission-events-test:'.length),
                sessionId: randomUUID(),
              };
            },
          },
        },
      ],
    })
      .overrideProvider(STORAGE_PORT)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id) => ({
          id,
          displayName: `Events ${id}`,
          email: `submission-events-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-events-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.create({
        data: { id: classroomId, name: `Events ${classroomId}`, independentTeacherId: teacher },
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId, userId: s2, role: ClassroomRole.STUDENT },
        ],
      });
    });
    fixtureReady = true;
  }, 30_000);

  afterEach(() => {
    vi.restoreAllMocks();
    storage.clearFailures();
    storage.clearHooks();
  });

  afterAll(async () => {
    try {
      if (fixtureReady) {
        await prisma.$transaction(async (tx) => {
          const activities = await tx.activity.findMany({
            where: { classroomId },
            select: { id: true },
          });
          const ids = activities.map((a) => a.id);
          await tx.outboxEvent.deleteMany({
            where: {
              type: SUBMISSION_ON_TIME_EVENT,
              OR: ids.map((id) => ({ payload: { path: ['activityId'], equals: id } })),
            },
          });
          await tx.submissionFile.deleteMany({
            where: { submission: { activityId: { in: ids } } },
          });
          await tx.submission.deleteMany({ where: { activityId: { in: ids } } });
          await tx.activity.deleteMany({ where: { classroomId } });
          await tx.classroomMembership.deleteMany({ where: { classroomId } });
          await tx.classroom.deleteMany({ where: { id: classroomId } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  it('records exactly one event with the minimal versioned payload on an on-time submission', async () => {
    const activityId = await publishedActivity();
    const before = Date.now();
    const res = await submit(activityId).expect(201);

    const events = await eventsOf(activityId);
    expect(events).toHaveLength(1);
    const [stored] = await submissionsOf(activityId);
    expect(events[0].payload).toEqual({
      version: 1,
      submissionId: res.body.id,
      activityId,
      classroomId,
      studentId: s1,
      submittedAt: stored.submittedAt.toISOString(),
    } satisfies SubmissionOnTimePayload);
    expect(res.body.submittedAt).toBe(stored.submittedAt.toISOString());
    expect(stored.submittedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(events[0].processedAt).toBeNull();
  });

  it('records no event for a late submission accepted by allowLate', async () => {
    const activityId = await publishedActivity({
      dueAt: new Date(Date.now() - HOUR_MS),
      allowLate: true,
    });
    const res = await submit(activityId).expect(201);
    expect(res.body.isLate).toBe(true);
    expect(await eventsOf(activityId)).toHaveLength(0);
  });

  it('records no event for a rejected submission', async () => {
    const activityId = await publishedActivity({
      dueAt: new Date(Date.now() - HOUR_MS),
      allowLate: false,
    });
    await submit(activityId).expect(409);
    expect(await eventsOf(activityId)).toHaveLength(0);
  });

  it('keeps exactly one event when the same Idempotency-Key is replayed', async () => {
    const activityId = await publishedActivity();
    const key = randomUUID();
    await submit(activityId, { key }).expect(201);
    await submit(activityId, { key }).expect(200);
    expect(await eventsOf(activityId)).toHaveLength(1);
  });

  it('keeps exactly one event when the same student submits concurrently and one request loses', async () => {
    const activityId = await publishedActivity();
    const results = await Promise.all([submit(activityId), submit(activityId)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await eventsOf(activityId)).toHaveLength(1);
  });

  it('records one event per student', async () => {
    const activityId = await publishedActivity();
    await submit(activityId, { actor: s1 }).expect(201);
    await submit(activityId, { actor: s2 }).expect(201);
    const events = await eventsOf(activityId);
    expect(
      events.map((e) => (e.payload as unknown as SubmissionOnTimePayload).studentId).sort(),
    ).toEqual([s1, s2].sort());
  });

  it('rolls the submission back when recording the event fails', async () => {
    const activityId = await publishedActivity();
    vi.spyOn(OutboxWriter.prototype, 'record').mockRejectedValueOnce(new Error('outbox down'));
    await submit(activityId).expect(500);
    expect(await submissionsOf(activityId)).toHaveLength(0);
    expect(await eventsOf(activityId)).toHaveLength(0);
    expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
  });

  it('leaves no event behind when the transaction fails after the event was recorded', async () => {
    const activityId = await publishedActivity();
    const original = OutboxWriter.prototype.record;
    vi.spyOn(OutboxWriter.prototype, 'record').mockImplementationOnce(async function (
      this: OutboxWriter,
      tx,
      event,
    ) {
      await original.call(this, tx, event);
      throw new Error('failure after the event was written');
    });
    await submit(activityId).expect(500);
    expect(await eventsOf(activityId)).toHaveLength(0);
    expect(await submissionsOf(activityId)).toHaveLength(0);
  });

  it('is delivered by the dispatcher without failing while no consumer exists yet', async () => {
    const activityId = await publishedActivity();
    await submit(activityId).expect(201);

    const dispatcher = app.get(OutboxDispatcher);
    const outcome = await dispatcher.dispatchPending(50, new Date(), [SUBMISSION_ON_TIME_EVENT]);
    expect(outcome.retried).toBe(0);
    expect(outcome.exhausted).toBe(0);
    const [event] = await eventsOf(activityId);
    expect(event.processedAt).not.toBeNull();
    expect(event.failedAt).toBeNull();
    expect(event.attempts).toBe(0);
    expect(event.lastError).toBeNull();
  });
});
