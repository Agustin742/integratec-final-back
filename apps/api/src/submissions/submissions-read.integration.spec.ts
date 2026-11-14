import { randomUUID } from 'node:crypto';
import { type INestApplication, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ClassroomRole, RegistrationPath, SchoolRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { STORAGE_PORT } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
import { pdfBytes, pngBytes } from '../testing/file-fixtures';
import { InMemoryStorage } from '../testing/in-memory-storage';
import { futureInstant } from '../testing/relative-dates';
import { SubmissionsModule } from './submissions.module';

const databaseUrl = loadIsolatedTestDatabaseUrl();
const HOUR_MS = 3_600_000;
// Not the default of the in-memory storage (300), so the test proves the configured TTL is used.
const TTL_SECONDS = 120;

describe('GET submissions PostgreSQL HTTP — activities-and-grading (signed URLs), classrooms-and-roles', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const storage = new InMemoryStorage();
  const [
    teacher,
    s1,
    s2,
    stranger,
    parent,
    other,
    sElsewhere,
    owner,
    admin,
    schoolTeacher,
    sSchool,
  ] = Array.from({ length: 11 }, () => randomUUID());
  const users = [
    teacher,
    s1,
    s2,
    stranger,
    parent,
    other,
    sElsewhere,
    owner,
    admin,
    schoolTeacher,
    sSchool,
  ];
  const school = randomUUID();
  const [classroomA, classroomB, classroomC] = [randomUUID(), randomUUID(), randomUUID()];
  let fixtureReady = false;
  const token = (actor: string) => `Bearer submissions-read-test:${actor}`;

  const activityOf = async (state: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED', classroomId = classroomA) =>
    (
      await prisma.activity.create({
        data: {
          classroomId,
          createdById: classroomId === classroomA ? teacher : other,
          type: 'TP',
          format: 'FILE',
          state,
          publishedAt: state === 'PUBLISHED' ? new Date(Date.now() - HOUR_MS) : null,
          title: `Read ${randomUUID()}`,
          dueAt: futureInstant(7, 12),
          maxScore: 10,
        },
      })
    ).id;

  /** A stored submission with two files whose objects exist in the fake storage. */
  const submissionOf = async (activityId: string, studentId: string, classroomId = classroomA) => {
    const submission = await prisma.submission.create({
      data: {
        activityId,
        studentId,
        submittedAt: new Date(),
        isLate: false,
        idempotencyKey: randomUUID(),
      },
    });
    const fileSpecs = [
      { name: 'informe.pdf', contentType: 'application/pdf', bytes: pdfBytes() },
      { name: 'foto.png', contentType: 'image/png', bytes: pngBytes() },
    ];
    const keys: string[] = [];
    for (const [position, spec] of fileSpecs.entries()) {
      const id = randomUUID();
      const storageKey = `submissions/${classroomId}/${activityId}/${studentId}/${id}`;
      await storage.put(storageKey, spec.bytes, { contentType: spec.contentType });
      await prisma.submissionFile.create({
        data: {
          id,
          submissionId: submission.id,
          storageKey,
          originalName: spec.name,
          contentType: spec.contentType,
          sizeBytes: spec.bytes.byteLength,
          position,
        },
      });
      keys.push(storageKey);
    }
    return { id: submission.id, keys };
  };

  const getMine = (activityId: string, actor = s1) =>
    request(app.getHttpServer())
      .get(`/activities/${activityId}/submissions/me`)
      .set('Authorization', token(actor));
  const getById = (submissionId: string, actor = s1) =>
    request(app.getHttpServer())
      .get(`/submissions/${submissionId}`)
      .set('Authorization', token(actor));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({
          ...authTestConfig(),
          databaseUrl,
          storageSignedUrlTtlSeconds: TTL_SECONDS,
        }),
        SubmissionsModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: SessionAuthGuard },
        {
          provide: SessionVerifier,
          useValue: {
            verifyAuthorizationHeader: async (header?: string) => {
              if (!header?.startsWith('Bearer submissions-read-test:'))
                throw new UnauthorizedException();
              return {
                userId: header.slice('Bearer submissions-read-test:'.length),
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
          displayName: `Submissions read ${id}`,
          email: `submissions-read-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-submissions-read-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.school.create({
        data: { id: school, name: `Read ${school}`, slug: `read-${school}` },
      });
      await tx.schoolMember.createMany({
        data: [
          { schoolId: school, userId: owner, role: SchoolRole.OWNER },
          { schoolId: school, userId: admin, role: SchoolRole.ADMIN },
          // A school teacher who is not a member of classroom C: no authority over it.
          { schoolId: school, userId: schoolTeacher, role: SchoolRole.TEACHER },
        ],
      });
      await tx.classroom.createMany({
        data: [
          { id: classroomC, name: `Read C ${classroomC}`, schoolId: school },
          { id: classroomA, name: `Read A ${classroomA}`, independentTeacherId: teacher },
          { id: classroomB, name: `Read B ${classroomB}`, independentTeacherId: other },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          { classroomId: classroomA, userId: s1, role: ClassroomRole.STUDENT },
          { classroomId: classroomA, userId: s2, role: ClassroomRole.STUDENT },
          { classroomId: classroomB, userId: sElsewhere, role: ClassroomRole.STUDENT },
          { classroomId: classroomC, userId: sSchool, role: ClassroomRole.STUDENT },
        ],
      });
      await tx.parentLink.create({
        data: { parentId: parent, childId: s1, classroomId: classroomA },
      });
    });
    fixtureReady = true;
  }, 30_000);

  afterEach(() => {
    storage.clearFailures();
  });

  afterAll(async () => {
    try {
      if (fixtureReady) {
        const classrooms = [classroomA, classroomB, classroomC];
        await prisma.$transaction(async (tx) => {
          const activity = { classroomId: { in: classrooms } };
          await tx.submissionFile.deleteMany({ where: { submission: { activity } } });
          await tx.submission.deleteMany({ where: { activity } });
          await tx.activity.deleteMany({ where: activity });
          await tx.parentLink.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroomMembership.deleteMany({ where: { classroomId: { in: classrooms } } });
          await tx.classroom.deleteMany({ where: { id: { in: classrooms } } });
          await tx.schoolMember.deleteMany({ where: { schoolId: school } });
          await tx.school.deleteMany({ where: { id: school } });
          await tx.user.deleteMany({ where: { id: { in: users } } });
        });
      }
    } finally {
      await app?.close();
    }
  }, 30_000);

  describe('GET /activities/:activityId/submissions/me', () => {
    it('returns the own submission with a signed URL and an expiry per file, from the configured TTL', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      const before = Date.now();
      const res = await getMine(activityId).expect(200);
      const after = Date.now();

      expect(res.body).toMatchObject({
        id: stored.id,
        activityId,
        isLate: false,
        status: 'submitted',
      });
      expect(res.body.submittedAt).toMatch(/Z$/);
      expect(res.body.files).toHaveLength(2);
      expect(res.body.files.map((f: { position: number }) => f.position)).toEqual([0, 1]);
      expect(res.body.files.map((f: { originalName: string }) => f.originalName)).toEqual([
        'informe.pdf',
        'foto.png',
      ]);
      res.body.files.forEach((file: Record<string, unknown>, index: number) => {
        // The URL is whatever the storage port signed for that key, with the configured lifetime.
        expect(file.downloadUrl).toBe(
          `https://storage.test/${stored.keys[index]}?expiresIn=${TTL_SECONDS}`,
        );
        const expiresAt = new Date(file.downloadUrlExpiresAt as string).getTime();
        expect(file.downloadUrlExpiresAt).toMatch(/Z$/);
        expect(expiresAt).toBeGreaterThanOrEqual(before + TTL_SECONDS * 1000 - 1000);
        expect(expiresAt).toBeLessThanOrEqual(after + TTL_SECONDS * 1000);
        expect(Object.keys(file).sort()).toEqual([
          'contentType',
          'downloadUrl',
          'downloadUrlExpiresAt',
          'id',
          'originalName',
          'position',
          'sizeBytes',
        ]);
      });
    });

    it('never exposes storage keys or the idempotency key, and is not cacheable', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      const row = await prisma.submission.findUniqueOrThrow({ where: { id: stored.id } });
      const res = await getMine(activityId).expect(200);
      // The key is part of the signed URL by construction; it must appear nowhere else.
      const text = JSON.stringify(res.body, (name, value) =>
        name === 'downloadUrl' ? undefined : value,
      );
      expect(text).not.toContain('storageKey');
      expect(text).not.toContain('idempotencyKey');
      expect(text).not.toContain(row.idempotencyKey);
      expect(text).not.toContain(`submissions/${classroomA}`);
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('answers 404 Submission not found when the student has not submitted yet', async () => {
      const activityId = await activityOf();
      const res = await getMine(activityId).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('does not return another student’s submission through /me', async () => {
      const activityId = await activityOf();
      await submissionOf(activityId, s2);
      const res = await getMine(activityId, s1).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('answers 403 to the teacher and to a linked parent (only students submit)', async () => {
      const activityId = await activityOf();
      await getMine(activityId, teacher).expect(403);
      await getMine(activityId, parent).expect(403);
    });

    it('answers 404 Activity not found to non-members, malformed, unknown, draft and deleted activities', async () => {
      const activityId = await activityOf();
      const draft = await activityOf('DRAFT');
      const deleted = await activityOf();
      await submissionOf(deleted, s1);
      await prisma.activity.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
      for (const [id, actor] of [
        [activityId, stranger],
        [activityId, sElsewhere],
        ['not-a-uuid', s1],
        [randomUUID(), s1],
        [draft, s1],
        [deleted, s1],
      ] as const) {
        const res = await getMine(id, actor).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('fails with a server error, not a partial body, when a URL cannot be signed', async () => {
      const activityId = await activityOf();
      await submissionOf(activityId, s1);
      storage.failOn('getSignedDownloadUrl');
      const res = await getMine(activityId).expect(500);
      expect(res.body.files).toBeUndefined();
      expect(res.body.id).toBeUndefined();
    });

    it('requires authentication', async () => {
      const activityId = await activityOf();
      await request(app.getHttpServer())
        .get(`/activities/${activityId}/submissions/me`)
        .expect(401);
    });
  });

  describe('GET /submissions/:submissionId', () => {
    it('lets the owner read it with signed URLs and no cache', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      const res = await getById(stored.id, s1).expect(200);
      expect(res.body.id).toBe(stored.id);
      expect(res.body.files.map((f: { downloadUrl: string }) => f.downloadUrl)).toEqual(
        stored.keys.map((key) => `https://storage.test/${key}?expiresIn=${TTL_SECONDS}`),
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toMatch(/storageKey|idempotencyKey/);
    });

    it('lets the teacher of the classroom read a student’s submission', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      const res = await getById(stored.id, teacher).expect(200);
      expect(res.body.id).toBe(stored.id);
      expect(res.body.files).toHaveLength(2);
      expect(res.body.files[0].downloadUrl).toContain(stored.keys[0]);
    });

    it('answers 404 Submission not found to another student of the same classroom', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      const res = await getById(stored.id, s2).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('answers 404 to a student, the teacher and a non-member of another classroom', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      for (const actor of [other, sElsewhere, stranger]) {
        const res = await getById(stored.id, actor).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('lets the school Owner and Admin of the classroom read it (teacher-level authority)', async () => {
      const activityId = await activityOf('PUBLISHED', classroomC);
      const stored = await submissionOf(activityId, sSchool, classroomC);
      for (const actor of [owner, admin]) {
        const res = await getById(stored.id, actor).expect(200);
        expect(res.body.id).toBe(stored.id);
        expect(res.body.files.map((f: { downloadUrl: string }) => f.downloadUrl)).toEqual(
          stored.keys.map((key) => `https://storage.test/${key}?expiresIn=${TTL_SECONDS}`),
        );
      }
    });

    it('answers 404 to a school teacher who does not teach the classroom (the only other staff-like role)', async () => {
      const activityId = await activityOf('PUBLISHED', classroomC);
      const stored = await submissionOf(activityId, sSchool, classroomC);
      const res = await getById(stored.id, schoolTeacher).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('answers 404 to a linked parent: parents see the grade of the child, never the files', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      const res = await getById(stored.id, parent).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('answers 404 to a student who left the classroom', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s2);
      await prisma.classroomMembership.updateMany({
        where: { classroomId: classroomA, userId: s2 },
        data: { state: 'INACTIVE' },
      });
      try {
        await getById(stored.id, s2).expect(404);
        await getById(stored.id, teacher).expect(200);
      } finally {
        await prisma.classroomMembership.updateMany({
          where: { classroomId: classroomA, userId: s2 },
          data: { state: 'ACTIVE' },
        });
      }
    });

    it('answers 404 for a malformed id, an unknown id and a deleted activity, even to the teacher', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      await prisma.activity.update({ where: { id: activityId }, data: { deletedAt: new Date() } });
      for (const [id, actor] of [
        ['not-a-uuid', s1],
        [randomUUID(), s1],
        [stored.id, s1],
        [stored.id, teacher],
      ] as const) {
        const res = await getById(id, actor).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get(`/submissions/${randomUUID()}`).expect(401);
    });

    it('fails with a server error, not a partial body, when a URL cannot be signed', async () => {
      const activityId = await activityOf();
      const stored = await submissionOf(activityId, s1);
      storage.failOn('getSignedDownloadUrl');
      await getById(stored.id, s1).expect(500);
    });
  });
});
