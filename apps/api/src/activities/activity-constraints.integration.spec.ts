import { randomUUID } from 'node:crypto';
import { type Prisma, PrismaClient, RegistrationPath } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';

const databaseUrl = loadIsolatedTestDatabaseUrl();

describe('activity PostgreSQL constraints — data and activities-and-grading', () => {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const teacher = randomUUID();
  const classroom = randomUUID();
  const activityIds: string[] = [];
  const dueAt = new Date('2026-12-01T12:00:00.000Z');
  let fixtureReady = false;

  const base = (): Prisma.ActivityUncheckedCreateInput => ({
    id: randomUUID(),
    classroomId: classroom,
    createdById: teacher,
    type: 'TP',
    format: 'FILE',
    title: 'Constraint fixture',
    dueAt,
    maxScore: 10,
  });
  const create = async (overrides: Partial<Prisma.ActivityUncheckedCreateInput> = {}) => {
    const data = { ...base(), ...overrides };
    const row = await prisma.activity.create({ data });
    activityIds.push(row.id);
    return row;
  };

  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: teacher,
        displayName: 'Activity constraints teacher',
        email: `activity-constraints-${teacher}@example.invalid`,
        passwordHash: 'synthetic-unused-hash',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    await prisma.classroom.create({
      data: {
        id: classroom,
        name: `Activity constraints ${classroom}`,
        independentTeacherId: teacher,
      },
    });
    fixtureReady = true;
  }, 20_000);

  afterAll(async () => {
    try {
      if (fixtureReady) {
        await prisma.option.deleteMany({
          where: { question: { activityId: { in: activityIds } } },
        });
        await prisma.question.deleteMany({ where: { activityId: { in: activityIds } } });
        await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
        await prisma.classroom.deleteMany({ where: { id: classroom } });
        await prisma.user.deleteMany({ where: { id: teacher } });
      }
    } finally {
      await prisma.$disconnect();
    }
  }, 20_000);

  describe('activities_max_score_check', () => {
    it.each([-1, 101])('rejects max_score %i', async (maxScore) => {
      await expect(create({ maxScore })).rejects.toThrow(/activities_max_score_check/);
    });

    it.each([0, 100])('accepts max_score %i', async (maxScore) => {
      await expect(create({ maxScore })).resolves.toMatchObject({ maxScore });
    });
  });

  describe('activities_weight_multiplier_check', () => {
    it.each(['0.4', '3.01'])('rejects weight_multiplier %s', async (weightMultiplier) => {
      await expect(create({ weightMultiplier })).rejects.toThrow(
        /activities_weight_multiplier_check/,
      );
    });

    it.each(['0.5', '3'])('accepts weight_multiplier %s', async (weightMultiplier) => {
      const row = await create({ weightMultiplier });
      expect(row.weightMultiplier.toString()).toBe(weightMultiplier);
    });
  });

  describe('activities_window_check', () => {
    it('rejects opens_at equal to or after due_at', async () => {
      await expect(create({ opensAt: dueAt })).rejects.toThrow(/activities_window_check/);
      await expect(create({ opensAt: new Date(dueAt.getTime() + 1000) })).rejects.toThrow(
        /activities_window_check/,
      );
    });

    it('accepts opens_at before due_at and a null opens_at', async () => {
      await expect(create({ opensAt: new Date(dueAt.getTime() - 1000) })).resolves.toBeTruthy();
      await expect(create({ opensAt: null })).resolves.toBeTruthy();
    });
  });

  describe('activities_published_at_check', () => {
    it('rejects a published activity without published_at', async () => {
      await expect(create({ state: 'PUBLISHED', publishedAt: null })).rejects.toThrow(
        /activities_published_at_check/,
      );
    });

    it('accepts a published activity with published_at and a draft without it', async () => {
      await expect(
        create({ state: 'PUBLISHED', publishedAt: new Date('2026-11-13T12:00:00.000Z') }),
      ).resolves.toMatchObject({ state: 'PUBLISHED' });
      await expect(create({ state: 'DRAFT', publishedAt: null })).resolves.toBeTruthy();
    });
  });

  describe('question ordering and restrictive foreign keys', () => {
    it('rejects a duplicate (activity_id, position) for questions', async () => {
      const activity = await create();
      await prisma.question.create({
        data: { activityId: activity.id, position: 1, prompt: 'First' },
      });
      await expect(
        prisma.question.create({ data: { activityId: activity.id, position: 1, prompt: 'Dup' } }),
      ).rejects.toThrow(/Unique constraint/);
      await expect(
        prisma.question.create({ data: { activityId: activity.id, position: 2, prompt: 'Next' } }),
      ).resolves.toBeTruthy();
    });

    it('restricts deleting an activity that still has questions', async () => {
      const activity = await create();
      await prisma.question.create({
        data: { activityId: activity.id, position: 1, prompt: 'Child' },
      });
      await expect(prisma.activity.delete({ where: { id: activity.id } })).rejects.toThrow(
        /foreign key/i,
      );
    });

    it('restricts deleting a classroom that still has activities', async () => {
      await create();
      await expect(prisma.classroom.delete({ where: { id: classroom } })).rejects.toThrow(
        /foreign key/i,
      );
    });
  });
});
