import { randomUUID } from 'node:crypto';
import { type Prisma, PrismaClient, RegistrationPath } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { futureInstant } from '../testing/relative-dates';

const databaseUrl = loadIsolatedTestDatabaseUrl();
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('submission PostgreSQL constraints — activities-and-grading and data', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const teacher = randomUUID();
  const student = randomUUID();
  const classroom = randomUUID();
  const activityIds: string[] = [];
  const userIds = [teacher, student];
  let fixtureReady = false;

  const createActivity = async () => {
    const row = await prisma.activity.create({
      data: {
        classroomId: classroom,
        createdById: teacher,
        type: 'TP',
        format: 'FILE',
        title: 'Submission fixture',
        dueAt: futureInstant(30, 12),
        maxScore: 10,
      },
    });
    activityIds.push(row.id);
    return row;
  };
  const createUser = async () => {
    const id = randomUUID();
    userIds.push(id);
    await prisma.user.create({
      data: {
        id,
        displayName: 'Submission constraints student',
        email: `submission-constraints-${id}@example.invalid`,
        passwordHash: 'synthetic-unused-hash',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    return id;
  };
  const submit = async (
    activityId: string,
    overrides: Partial<Prisma.SubmissionUncheckedCreateInput> = {},
  ) =>
    prisma.submission.create({
      data: {
        activityId,
        studentId: student,
        submittedAt: new Date('2026-11-13T12:00:00.000Z'),
        idempotencyKey: randomUUID(),
        ...overrides,
      },
    });
  const attach = async (
    submissionId: string,
    overrides: Partial<Prisma.SubmissionFileUncheckedCreateInput> = {},
  ) =>
    prisma.submissionFile.create({
      data: {
        submissionId,
        storageKey: `submissions/${randomUUID()}`,
        originalName: 'work.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024,
        position: 0,
        ...overrides,
      },
    });
  /** A fresh submission (own activity) to attach files to. */
  const freshSubmission = async () => submit((await createActivity()).id);

  beforeAll(async () => {
    for (const id of [teacher, student]) {
      await prisma.user.create({
        data: {
          id,
          displayName: 'Submission constraints user',
          email: `submission-constraints-${id}@example.invalid`,
          passwordHash: 'synthetic-unused-hash',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        },
      });
    }
    await prisma.classroom.create({
      data: {
        id: classroom,
        name: `Submission constraints ${classroom}`,
        independentTeacherId: teacher,
      },
    });
    fixtureReady = true;
  }, 20_000);

  afterAll(async () => {
    try {
      if (fixtureReady) {
        const submissions = { submission: { activityId: { in: activityIds } } };
        await prisma.submissionFile.deleteMany({ where: submissions });
        await prisma.submission.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
        await prisma.classroom.deleteMany({ where: { id: classroom } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 20_000);

  describe('one submission per activity and student', () => {
    it('rejects a second submission for the same pair, even with another key', async () => {
      const activity = await createActivity();
      await submit(activity.id);
      await expect(submit(activity.id)).rejects.toThrow(/Unique constraint/);
    });

    it('allows other students and other activities', async () => {
      const activity = await createActivity();
      await submit(activity.id);
      await expect(submit(activity.id, { studentId: await createUser() })).resolves.toBeTruthy();
      await expect(submit((await createActivity()).id)).resolves.toBeTruthy();
    });

    it('defaults is_late to false', async () => {
      const row = await submit((await createActivity()).id);
      expect(row.isLate).toBe(false);
    });
  });

  describe('submissions_idempotency_key_check', () => {
    it.each(['', 'k'.repeat(256)])('rejects a key of length %#', async (idempotencyKey) => {
      const activity = await createActivity();
      await expect(submit(activity.id, { idempotencyKey })).rejects.toThrow(
        /submissions_idempotency_key_check/,
      );
    });

    it.each([1, 255])('accepts a key of length %i', async (length) => {
      const activity = await createActivity();
      await expect(
        submit(activity.id, { idempotencyKey: 'k'.repeat(length) }),
      ).resolves.toBeTruthy();
    });
  });

  describe('submission_files_size_bytes_check', () => {
    it.each([0, -1, 10_485_761])('rejects size_bytes %i', async (sizeBytes) => {
      const submission = await freshSubmission();
      await expect(attach(submission.id, { sizeBytes })).rejects.toThrow(
        /submission_files_size_bytes_check/,
      );
    });

    it.each([1, 10_485_760])('accepts size_bytes %i', async (sizeBytes) => {
      const submission = await freshSubmission();
      await expect(attach(submission.id, { sizeBytes })).resolves.toMatchObject({ sizeBytes });
    });
  });

  describe('submission_files_position_check', () => {
    it.each([-1, 5])('rejects position %i', async (position) => {
      const submission = await freshSubmission();
      await expect(attach(submission.id, { position })).rejects.toThrow(
        /submission_files_position_check/,
      );
    });

    it.each([0, 4])('accepts position %i', async (position) => {
      const submission = await freshSubmission();
      await expect(attach(submission.id, { position })).resolves.toMatchObject({ position });
    });
  });

  describe('submission_files_original_name_check', () => {
    it.each(['', 'n'.repeat(256)])('rejects a name of length %#', async (originalName) => {
      const submission = await freshSubmission();
      await expect(attach(submission.id, { originalName })).rejects.toThrow(
        /submission_files_original_name_check/,
      );
    });

    it.each([1, 255])('accepts a name of length %i', async (length) => {
      const submission = await freshSubmission();
      await expect(
        attach(submission.id, { originalName: 'n'.repeat(length) }),
      ).resolves.toBeTruthy();
    });
  });

  describe('submission_files_content_type_check', () => {
    it.each(['text/plain', 'application/zip', 'image/gif', 'IMAGE/PNG', ''])(
      'rejects content type %j',
      async (contentType) => {
        const submission = await freshSubmission();
        await expect(attach(submission.id, { contentType })).rejects.toThrow(
          /submission_files_content_type_check/,
        );
      },
    );

    it.each(['application/pdf', 'image/png', 'image/jpeg', DOCX])(
      'accepts content type %s',
      async (contentType) => {
        const submission = await freshSubmission();
        await expect(attach(submission.id, { contentType })).resolves.toMatchObject({
          contentType,
        });
      },
    );
  });

  describe('file ordering, storage keys and restrictive foreign keys', () => {
    it('rejects a duplicate (submission_id, position)', async () => {
      const submission = await freshSubmission();
      await attach(submission.id, { position: 1 });
      await expect(attach(submission.id, { position: 1 })).rejects.toThrow(/Unique constraint/);
    });

    it('rejects a duplicate storage_key across submissions', async () => {
      const storageKey = `submissions/${randomUUID()}`;
      await attach((await freshSubmission()).id, { storageKey });
      await expect(attach((await freshSubmission()).id, { storageKey })).rejects.toThrow(
        /Unique constraint/,
      );
    });

    it('refuses to delete an activity that has submissions', async () => {
      const activity = await createActivity();
      await submit(activity.id);
      await expect(prisma.activity.delete({ where: { id: activity.id } })).rejects.toThrow(
        /foreign key/i,
      );
    });

    it('refuses to delete a student that has submissions', async () => {
      const activity = await createActivity();
      const other = await createUser();
      await submit(activity.id, { studentId: other });
      await expect(prisma.user.delete({ where: { id: other } })).rejects.toThrow(/foreign key/i);
    });

    it('refuses to delete a submission that has files', async () => {
      const submission = await freshSubmission();
      await attach(submission.id);
      await expect(prisma.submission.delete({ where: { id: submission.id } })).rejects.toThrow(
        /foreign key/i,
      );
    });
  });
});
