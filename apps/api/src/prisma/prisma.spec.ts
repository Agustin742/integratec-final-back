import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('Prisma Baseline Relational Constraints Integration Tests', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Read from process env via global record or fallback to local container port 5433
    const envRecord = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    const dbUrl =
      envRecord?.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/aula_virtual?schema=public';

    prisma = new PrismaClient({
      datasources: {
        db: { url: dbUrl },
      },
    });
    await prisma.$connect();
  }, 15000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  }, 15000);

  it('rejects inserting a classroom with neither schoolId nor independentTeacherId', async () => {
    await expect(
      prisma.classroom.create({
        data: {
          name: 'Invalid Classroom No Owner',
          schoolId: null,
          independentTeacherId: null,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects inserting a classroom with BOTH schoolId and independentTeacherId', async () => {
    // Pick an existing user and school from seed or create temporary ones
    const teacher = await prisma.user.findFirstOrThrow();
    const school = await prisma.school.findFirstOrThrow();

    await expect(
      prisma.classroom.create({
        data: {
          name: 'Invalid Classroom Dual Owner',
          schoolId: school.id,
          independentTeacherId: teacher.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate normalized email for User', async () => {
    const existing = await prisma.user.findFirstOrThrow();

    await expect(
      prisma.user.create({
        data: {
          email: existing.email,
          passwordHash: 'some-hash',
          displayName: 'Duplicate User',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects having two active owners for the same school', async () => {
    const school = await prisma.school.findFirstOrThrow();
    const teacher = await prisma.user.findFirstOrThrow({
      where: {
        schoolMemberships: {
          some: { role: 'TEACHER' },
        },
      },
    });

    await expect(
      prisma.schoolMember.create({
        data: {
          schoolId: school.id,
          userId: teacher.id,
          role: 'OWNER',
          state: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate enrollment in the same classroom for a student', async () => {
    const membership = await prisma.classroomMembership.findFirstOrThrow();

    await expect(
      prisma.classroomMembership.create({
        data: {
          classroomId: membership.classroomId,
          userId: membership.userId,
          role: 'STUDENT',
          state: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects an email invitation without target_email', async () => {
    const owner = await prisma.user.findFirstOrThrow();
    const school = await prisma.school.findFirstOrThrow();

    await expect(
      prisma.invitation.create({
        data: {
          kind: 'EMAIL',
          secretHash: 'test-hash-no-email',
          targetEmail: null,
          schoolId: school.id,
          role: 'TEACHER',
          expiresAt: new Date(Date.now() + 100000),
          createdById: owner.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a join code with a non-student role', async () => {
    const teacher = await prisma.user.findFirstOrThrow();
    const classroom = await prisma.classroom.findFirstOrThrow();

    await expect(
      prisma.invitation.create({
        data: {
          kind: 'JOIN_CODE',
          secretHash: 'test-hash-invalid-role',
          targetEmail: null,
          classroomId: classroom.id,
          role: 'TEACHER', // Join code must strictly be student
          expiresAt: new Date(Date.now() + 100000),
          createdById: teacher.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a join code where use_count exceeds max_uses', async () => {
    const teacher = await prisma.user.findFirstOrThrow();
    const classroom = await prisma.classroom.findFirstOrThrow();

    await expect(
      prisma.invitation.create({
        data: {
          kind: 'JOIN_CODE',
          secretHash: 'test-hash-exceeded-uses',
          targetEmail: null,
          classroomId: classroom.id,
          role: 'STUDENT',
          maxUses: 5,
          useCount: 6, // Exceeds max uses
          expiresAt: new Date(Date.now() + 100000),
          createdById: teacher.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('verifies School default timeZone is America/Argentina/Buenos_Aires', async () => {
    const school = await prisma.school.create({
      data: {
        name: 'Escuela Zona Horaria Test',
        slug: `escuela-zona-horaria-${Date.now()}`,
      },
    });

    expect(school.timeZone).toBe('America/Argentina/Buenos_Aires');

    // Clean up
    await prisma.school.delete({ where: { id: school.id } });
  }, 10000);
});
