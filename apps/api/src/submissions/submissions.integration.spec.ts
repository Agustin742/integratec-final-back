import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, Prisma, PrismaClient, RegistrationPath } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { STORAGE_PORT } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { docxBytes, exeBytes, jpegBytes, pdfBytes, pngBytes } from '../testing/file-fixtures';
import { InMemoryStorage } from '../testing/in-memory-storage';
import { futureInstant } from '../testing/relative-dates';
import { SubmissionsModule } from './submissions.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const HOUR_MS = 3_600_000;
const KEY_PATTERN = /^submissions\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

interface Upload {
  name: string;
  bytes: Uint8Array;
  declaredType?: string;
}

describe('POST /activities/:id/submissions PostgreSQL HTTP — activities-and-grading, classrooms-and-roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const storage = new InMemoryStorage();
  const [teacher, s1, s2, stranger, parent, sElsewhere, other, sLeaving] = Array.from(
    { length: 8 },
    () => randomUUID(),
  );
  const users = [teacher, s1, s2, stranger, parent, sElsewhere, other, sLeaving];
  const [classroomA, classroomB] = [randomUUID(), randomUUID()];
  let fixtureReady = false;
  const token = (actor: string) => `Bearer submissions-test:${actor}`;

  const publishedActivity = async (overrides: Partial<Prisma.ActivityUncheckedCreateInput> = {}) =>
    (
      await prisma.activity.create({
        data: {
          classroomId: classroomA,
          createdById: teacher,
          type: 'TP',
          format: 'FILE',
          state: 'PUBLISHED',
          publishedAt: new Date(Date.now() - HOUR_MS),
          title: `Submit ${randomUUID()}`,
          dueAt: futureInstant(7, 12),
          maxScore: 10,
          ...overrides,
        },
      })
    ).id;

  const submit = (
    activityId: string,
    options: { actor?: string; key?: string | null; files?: Upload[] } = {},
  ) => {
    const req = request(app.getHttpServer())
      .post(`/activities/${activityId}/submissions`)
      .set('Authorization', token(options.actor ?? s1));
    if (options.key !== null) req.set('Idempotency-Key', options.key ?? randomUUID());
    const files = options.files ?? [{ name: 'tarea.pdf', bytes: pdfBytes() }];
    if (files.length === 0) req.field('note', 'no files attached');
    for (const file of files) {
      req.attach('files', Buffer.from(file.bytes), {
        filename: file.name,
        contentType: file.declaredType ?? 'application/octet-stream',
      });
    }
    return req;
  };

  const rowsOf = (activityId: string, studentId = s1) =>
    prisma.submission.findMany({
      where: { activityId, studentId },
      include: { files: { orderBy: { position: 'asc' } } },
    });
  const putCalls = () => storage.calls.filter((call) => call.operation === 'put').length;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), SubmissionsModule],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer submissions-test:'))
                throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer submissions-test:'.length),
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
          displayName: `Submissions ${id}`,
          email: `submissions-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-submissions-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomA, name: `Submissions A ${classroomA}`, independentTeacherId: teacher },
          { id: classroomB, name: `Submissions B ${classroomB}`, independentTeacherId: other },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: s2, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: sLeaving, role: ClassroomRole.STUDENT },
          { classroomId: classroomB, userId: sElsewhere, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: s1, classroomId: classroomA },
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
        const classrooms = [classroomA, classroomB];
        await prisma.$transaction(async (tx) => {
          const activity = { classroomId: { in: classrooms } };
          await tx.submissionFile.deleteMany({ where: { submission: { activity } } });
          await tx.submission.deleteMany({ where: { activity } });
          await tx.activity.deleteMany({ where: activity });
          await tx.parentLink.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroomMembership.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroom.deleteMany({ where: { id: { in: classrooms } } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  describe('happy path', () => {
    it('stores several files with positions and detected types, and returns no storage details', async () => {
      const activityId = await publishedActivity();
      const before = Date.now();
      const key = randomUUID();
      const res = await submit(activityId, {
        key,
        files: [
          // The declared types are wrong on purpose: only the bytes count.
          { name: 'informe.pdf', bytes: pdfBytes(), declaredType: 'text/plain' },
          { name: 'foto.png', bytes: pngBytes(), declaredType: 'application/pdf' },
          { name: 'texto.docx', bytes: docxBytes() },
          { name: 'otra.jpg', bytes: jpegBytes() },
        ],
      }).expect(201);

      expect(res.body).toMatchObject({ activityId, isLate: false, status: 'submitted' });
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.submittedAt).toMatch(/Z$/);
      expect(res.body.files.map((f: { position: number }) => f.position)).toEqual([0, 1, 2, 3]);
      expect(res.body.files.map((f: { originalName: string }) => f.originalName)).toEqual([
        'informe.pdf',
        'foto.png',
        'texto.docx',
        'otra.jpg',
      ]);
      expect(res.body.files.map((f: { contentType: string }) => f.contentType)).toEqual([
        'application/pdf',
        'image/png',
        DOCX,
        'image/jpeg',
      ]);
      expect(res.body.files[0].sizeBytes).toBe(pdfBytes().byteLength);
      for (const file of res.body.files) {
        expect(Object.keys(file).sort()).toEqual([
          'contentType',
          'id',
          'originalName',
          'position',
          'sizeBytes',
        ]);
      }
      // Storage keys and signed URLs belong to the read endpoint, never to this response.
      expect(JSON.stringify(res.body)).not.toMatch(/submissions\/|https?:|storageKey/);

      const [row] = await rowsOf(activityId);
      expect(row.id).toBe(res.body.id);
      expect(row.idempotencyKey).toBe(key);
      expect(row.isLate).toBe(false);
      expect(row.submittedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.submittedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(row.files).toHaveLength(4);
      for (const file of row.files) {
        expect(file.storageKey).toMatch(KEY_PATTERN);
        expect(file.storageKey).toBe(`submissions/${classroomA}/${activityId}/${s1}/${file.id}`);
        expect(storage.peek(file.storageKey)?.contentType).toBe(file.contentType);
      }
      expect(Buffer.from(storage.peek(row.files[0].storageKey)!.body)).toEqual(
        Buffer.from(pdfBytes()),
      );
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(4);
    });

    it('keeps non-ASCII file names intact', async () => {
      const activityId = await publishedActivity();
      const res = await submit(activityId, {
        files: [{ name: 'Trabajo práctico ñandú.pdf', bytes: pdfBytes() }],
      }).expect(201);
      expect(res.body.files[0].originalName).toBe('Trabajo práctico ñandú.pdf');
    });

    it('lets different students submit to the same activity independently', async () => {
      const activityId = await publishedActivity();
      await submit(activityId, { actor: s1 }).expect(201);
      await submit(activityId, { actor: s2 }).expect(201);
      expect(await rowsOf(activityId, s1)).toHaveLength(1);
      expect(await rowsOf(activityId, s2)).toHaveLength(1);
    });
  });

  describe('request validation', () => {
    it('rejects a spoofed file type with 400 VALIDATION_FAILED and stores nothing', async () => {
      const activityId = await publishedActivity();
      const puts = putCalls();
      const res = await submit(activityId, {
        files: [
          { name: 'ok.pdf', bytes: pdfBytes() },
          { name: 'virus.pdf', bytes: exeBytes(), declaredType: 'application/pdf' },
        ],
      }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([
        { field: 'files[1]', messages: [expect.stringContaining('not allowed')] },
      ]);
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(putCalls()).toBe(puts);
    });

    it('rejects a request without files with 400 VALIDATION_FAILED', async () => {
      const activityId = await publishedActivity();
      const res = await submit(activityId, { files: [] }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details[0].field).toBe('files');
    });

    it('rejects an empty file with 400 VALIDATION_FAILED', async () => {
      const activityId = await publishedActivity();
      const res = await submit(activityId, {
        files: [{ name: 'vacio.pdf', bytes: new Uint8Array(0) }],
      }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it.each([
      ['missing', null],
      ['empty', ''],
      ['longer than 255 characters', 'k'.repeat(256)],
    ])('rejects a %s Idempotency-Key with 400 on the header', async (_label, key) => {
      const activityId = await publishedActivity();
      const req = request(app.getHttpServer())
        .post(`/activities/${activityId}/submissions`)
        .set('Authorization', token(s1))
        .attach('files', Buffer.from(pdfBytes()), { filename: 'a.pdf' });
      if (key !== null) req.set('Idempotency-Key', key);
      const res = await req.expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toEqual([
        { field: 'Idempotency-Key', messages: [expect.any(String)] },
      ]);
      expect(await rowsOf(activityId)).toHaveLength(0);
    });

    it('accepts a 255-character Idempotency-Key', async () => {
      const activityId = await publishedActivity();
      await submit(activityId, { key: 'k'.repeat(255) }).expect(201);
    });

    it('answers 401 without a session', async () => {
      const activityId = await publishedActivity();
      await request(app.getHttpServer())
        .post(`/activities/${activityId}/submissions`)
        .set('Idempotency-Key', randomUUID())
        .attach('files', Buffer.from(pdfBytes()), { filename: 'a.pdf' })
        .expect(401);
    });
  });

  describe('access: no existence leaks, role matrix', () => {
    it('answers 404 to a user who is not a member of the classroom', async () => {
      const activityId = await publishedActivity();
      for (const actor of [stranger, sElsewhere]) {
        const res = await submit(activityId, { actor }).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      expect(await rowsOf(activityId, stranger)).toHaveLength(0);
    });

    it('answers 403 to the teacher and to a linked parent: only students submit', async () => {
      const activityId = await publishedActivity();
      for (const actor of [teacher, parent]) {
        const res = await submit(activityId, { actor }).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('answers 404 for unknown, malformed, draft and deactivated activities', async () => {
      const draft = await publishedActivity({ state: 'DRAFT', publishedAt: null });
      const deactivated = await publishedActivity({ deletedAt: new Date() });
      for (const id of [randomUUID(), 'not-a-uuid', draft, deactivated]) {
        const res = await submit(id).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      expect(await rowsOf(draft)).toHaveLength(0);
    });
  });

  describe('activity state and window (server clock)', () => {
    it('rejects a multiple-choice activity with 409', async () => {
      const activityId = await publishedActivity({ format: 'MULTIPLE_CHOICE' });
      const res = await submit(activityId).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details).toEqual([
        { field: 'activity', messages: [expect.stringContaining('file submissions')] },
      ]);
      expect(await rowsOf(activityId)).toHaveLength(0);
    });

    it('rejects a submission before opensAt with 409 and uploads nothing', async () => {
      const activityId = await publishedActivity({
        type: 'EXAM',
        opensAt: futureInstant(1, 8),
        dueAt: futureInstant(1, 12),
      });
      const puts = putCalls();
      const res = await submit(activityId).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details[0].messages[0]).toMatch(/not open yet/i);
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(putCalls()).toBe(puts);
    });

    it('rejects a late submission with 409 when allowLate is false', async () => {
      const activityId = await publishedActivity({
        dueAt: new Date(Date.now() - HOUR_MS),
        allowLate: false,
      });
      const puts = putCalls();
      const res = await submit(activityId).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details[0].messages[0]).toMatch(/deadline has passed/i);
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(putCalls()).toBe(puts);
    });

    it('stores a late submission with isLate when allowLate is true', async () => {
      const activityId = await publishedActivity({
        dueAt: new Date(Date.now() - HOUR_MS),
        allowLate: true,
      });
      const res = await submit(activityId).expect(201);
      expect(res.body.isLate).toBe(true);
      const [row] = await rowsOf(activityId);
      expect(row.isLate).toBe(true);
    });

    it('accepts an exam submission inside its window as on time', async () => {
      const activityId = await publishedActivity({
        type: 'EXAM',
        opensAt: new Date(Date.now() - HOUR_MS),
        dueAt: futureInstant(2, 12),
      });
      const res = await submit(activityId).expect(201);
      expect(res.body.isLate).toBe(false);
    });
  });

  describe('single submission and idempotency', () => {
    it('replays the same Idempotency-Key as 200 with the same submission and stores nothing new', async () => {
      const activityId = await publishedActivity();
      const key = randomUUID();
      const first = await submit(activityId, { key }).expect(201);
      const objects = storage.keys().length;
      const puts = putCalls();

      const replay = await submit(activityId, {
        key,
        files: [{ name: 'otro.png', bytes: pngBytes() }],
      }).expect(200);
      expect(replay.body).toEqual(first.body);
      expect(await rowsOf(activityId)).toHaveLength(1);
      expect((await rowsOf(activityId))[0].files).toHaveLength(1);
      expect(storage.keys()).toHaveLength(objects);
      expect(putCalls()).toBe(puts);
    });

    it('still replays after the deadline has passed', async () => {
      const activityId = await publishedActivity();
      const key = randomUUID();
      const first = await submit(activityId, { key }).expect(201);
      await prisma.activity.update({
        where: { id: activityId },
        data: { dueAt: new Date(Date.now() - HOUR_MS) },
      });
      const replay = await submit(activityId, { key }).expect(200);
      expect(replay.body.id).toBe(first.body.id);
    });

    it('rejects a different key for the same student and activity with 409 already submitted', async () => {
      const activityId = await publishedActivity();
      await submit(activityId).expect(201);
      const objects = storage.keys().length;
      const puts = putCalls();

      const res = await submit(activityId).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.details[0].messages[0]).toMatch(/already submitted/i);
      expect(await rowsOf(activityId)).toHaveLength(1);
      expect(storage.keys()).toHaveLength(objects);
      expect(putCalls()).toBe(puts);
    });
  });

  describe('concurrent requests and the activity row lock', { timeout: 20_000 }, () => {
    /** Deterministic: hold the row lock, let both requests queue behind it, then release. */
    const holdRowLock = async (
      activityId: string,
      options: {
        mode?: 'UPDATE' | 'SHARE';
        beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
      } = {},
    ) => {
      const blocker = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: (pid: number) => void;
      const locked = new Promise<number>((resolve) => {
        ready = resolve;
      });
      const done = blocker.$transaction(
        async (tx) => {
          if (options.mode === 'SHARE') {
            await tx.$queryRaw`SELECT id FROM activities WHERE id = ${activityId}::uuid FOR SHARE`;
          } else {
            await tx.$queryRaw`SELECT id FROM activities WHERE id = ${activityId}::uuid FOR UPDATE`;
          }
          const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          ready(pid);
          await released;
          await options.beforeCommit?.(tx);
        },
        { timeout: 60_000 },
      );
      const pid = await locked;
      const queued = async () => {
        const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
          WITH RECURSIVE waiting(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE ${pid}::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid))
          )
          SELECT count(*)::int AS n FROM waiting`;
        return n;
      };
      let closed = false;
      return {
        async waitForQueue(count: number) {
          for (let i = 0; i < 200; i++) {
            if ((await queued()) >= count) return;
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          throw new Error(`expected ${count} queued writers`);
        },
        async release() {
          if (closed) return;
          closed = true;
          release();
          await done;
          await blocker.$disconnect();
        },
      };
    };

    it('submits by different students do not block each other (shared lock)', async () => {
      const activityId = await publishedActivity();
      const lock = await holdRowLock(activityId, { mode: 'SHARE' });
      try {
        const both = Promise.all([
          submit(activityId, { actor: s1 }).then((res) => res),
          submit(activityId, { actor: s2 }).then((res) => res),
        ]);
        const outcome = await Promise.race([
          both,
          new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 8_000)),
        ]);
        // Completed while another transaction still holds a shared lock on the activity row.
        expect(outcome).not.toBe('blocked');
        expect((outcome as { status: number }[]).map((r) => r.status)).toEqual([201, 201]);
      } finally {
        await lock.release();
      }
      expect(await rowsOf(activityId, s1)).toHaveLength(1);
      expect(await rowsOf(activityId, s2)).toHaveLength(1);
    });

    it('a teacher-style exclusive lock still blocks a submit until released', async () => {
      const activityId = await publishedActivity();
      const lock = await holdRowLock(activityId);
      try {
        let settled = false;
        const pending = submit(activityId).then((res) => {
          settled = true;
          return res;
        });
        await lock.waitForQueue(1);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(settled).toBe(false);
        await lock.release();
        expect((await pending).status).toBe(201);
      } finally {
        await lock.release();
      }
    });

    it('state changed by the lock holder is re-read after the lock: deactivated meanwhile is 404', async () => {
      const activityId = await publishedActivity();
      const lock = await holdRowLock(activityId, {
        beforeCommit: async (tx) => {
          await tx.activity.update({ where: { id: activityId }, data: { deletedAt: new Date() } });
        },
      });
      try {
        const pending = submit(activityId).then((res) => res);
        await lock.waitForQueue(1);
        await lock.release();
        expect((await pending).status).toBe(404);
      } finally {
        await lock.release();
      }
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
    });

    it('two simultaneous submits with the same key: 201 and 200, one row, no orphan objects', async () => {
      const activityId = await publishedActivity();
      const key = randomUUID();
      const lock = await holdRowLock(activityId);
      try {
        const pending = [submit(activityId, { key }), submit(activityId, { key })].map((req) =>
          req.then((res) => res),
        );
        await lock.waitForQueue(2);
        await lock.release();
        const results = await Promise.all(pending);
        expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
        expect(results[0].body.id).toBe(results[1].body.id);
      } finally {
        await lock.release();
      }
      const rows = await rowsOf(activityId);
      expect(rows).toHaveLength(1);
      const mine = storage.keys().filter((k) => k.includes(`/${activityId}/`));
      expect(mine.sort()).toEqual(rows[0].files.map((f) => f.storageKey).sort());
    });

    it('two simultaneous submits with different keys: 201 and 409, one row, no 500', async () => {
      const activityId = await publishedActivity();
      const lock = await holdRowLock(activityId);
      try {
        const pending = [submit(activityId), submit(activityId)].map((req) =>
          req.then((res) => res),
        );
        await lock.waitForQueue(2);
        await lock.release();
        const results = await Promise.all(pending);
        expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      } finally {
        await lock.release();
      }
      const rows = await rowsOf(activityId);
      expect(rows).toHaveLength(1);
      const mine = storage.keys().filter((k) => k.includes(`/${activityId}/`));
      expect(mine.sort()).toEqual(rows[0].files.map((f) => f.storageKey).sort());
    });

    it('a deadline that passes while queued is decided after the lock: 409, nothing stored', async () => {
      const activityId = await publishedActivity({ dueAt: new Date(Date.now() + HOUR_MS) });
      const lock = await holdRowLock(activityId);
      try {
        const pending = submit(activityId).then((res) => res);
        await lock.waitForQueue(1);
        // Only Date is faked (timers stay real): the server clock jumps past dueAt while queued.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 2 * HOUR_MS);
        await lock.release();
        const res = await pending;
        expect(res.status).toBe(409);
        expect(res.body.error.details[0].messages[0]).toMatch(/deadline has passed/i);
      } finally {
        vi.useRealTimers();
        await lock.release();
      }
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
    });

    const uniqueViolation = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
    const winnerWith = async (activityId: string, key: string) =>
      prisma.submission.create({
        data: { activityId, studentId: s1, submittedAt: new Date(), idempotencyKey: key },
      });

    it('a unique violation from a racing writer is resolved as a replay for the same key (200)', async () => {
      const activityId = await publishedActivity();
      const key = randomUUID();
      vi.spyOn(prisma, '$transaction').mockImplementationOnce(async () => {
        await winnerWith(activityId, key);
        throw uniqueViolation();
      });
      const res = await submit(activityId, { key }).expect(200);
      expect(res.body.activityId).toBe(activityId);
      expect(await rowsOf(activityId)).toHaveLength(1);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
    });

    it('a unique violation from a racing writer with another key is 409, never 500', async () => {
      const activityId = await publishedActivity();
      vi.spyOn(prisma, '$transaction').mockImplementationOnce(async () => {
        await winnerWith(activityId, randomUUID());
        throw uniqueViolation();
      });
      const res = await submit(activityId).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(await rowsOf(activityId)).toHaveLength(1);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
    });
  });

  describe('failure cleanup', () => {
    it('a storage failure mid-upload leaves no rows and deletes the objects already stored', async () => {
      const activityId = await publishedActivity();
      storage.failOn('put', { times: 1 });
      const files = [
        { name: 'a.pdf', bytes: pdfBytes() },
        { name: 'b.png', bytes: pngBytes() },
        { name: 'c.jpg', bytes: jpegBytes() },
      ];
      const res = await submit(activityId, { files }).expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
      const planned = storage.calls
        .filter((c) => c.operation === 'put' && c.key.includes(`/${activityId}/`))
        .map((c) => c.key);
      expect(planned).toHaveLength(3);
      for (const key of planned) {
        expect(storage.calls).toContainEqual({ operation: 'delete', key });
      }
    });

    it('a database failure after the upload leaves no rows and deletes the uploaded objects', async () => {
      const activityId = await publishedActivity();
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('simulated database loss'));
      const res = await submit(activityId, {
        files: [
          { name: 'a.pdf', bytes: pdfBytes() },
          { name: 'b.png', bytes: pngBytes() },
        ],
      }).expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
      expect(storage.calls.filter((c) => c.operation === 'delete')).not.toHaveLength(0);
    });

    const deletesFor = (activityId: string) =>
      storage.calls.filter((c) => c.operation === 'delete' && c.key.includes(`/${activityId}/`));

    it('re-checks the activity after the upload: deactivated meanwhile is 404 and objects are deleted', async () => {
      const activityId = await publishedActivity();
      storage.onPut(
        async () => {
          await prisma.activity.update({
            where: { id: activityId },
            data: { deletedAt: new Date() },
          });
        },
        { times: 1 },
      );
      const res = await submit(activityId, { actor: s1 }).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await rowsOf(activityId)).toHaveLength(0);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
      expect(deletesFor(activityId)).not.toHaveLength(0);
    });

    it('re-checks enrollment after the upload: removed meanwhile is 404 and objects are deleted', async () => {
      const activityId = await publishedActivity();
      storage.onPut(
        async () => {
          await prisma.classroomMembership.updateMany({
            where: { classroomId: classroomA, userId: sLeaving },
            data: { state: 'INACTIVE' },
          });
        },
        { times: 1 },
      );
      const res = await submit(activityId, { actor: sLeaving }).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await rowsOf(activityId, sLeaving)).toHaveLength(0);
      expect(storage.keys().filter((k) => k.includes(`/${activityId}/`))).toHaveLength(0);
      expect(deletesFor(activityId)).not.toHaveLength(0);
    });

    it('does not mask the original error when a cleanup delete also fails', async () => {
      const activityId = await publishedActivity();
      vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('simulated database loss'));
      storage.failOn('delete');
      const res = await submit(activityId).expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(await rowsOf(activityId)).toHaveLength(0);
    });
  });
});
