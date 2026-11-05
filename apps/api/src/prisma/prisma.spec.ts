import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('Prisma Baseline Relational Constraints Integration Tests', () => {
  let prisma: PrismaClient;

  // Dedicated test fixtures created in beforeAll to guarantee self-contained execution
  let testSchool: { id: string };
  let testOwnerUser: { id: string; email: string };
  let testTeacherUser: { id: string; email: string };
  let testStudentUser: { id: string; email: string };
  let testParentUser: { id: string; email: string };
  let testClassroom: { id: string };

  beforeAll(async () => {
    // Read DATABASE_URL safely from node environment or standard localhost:5432
    const globalProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const dbUrl =
      globalProcess?.env?.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

    prisma = new PrismaClient({
      datasources: {
        db: { url: dbUrl },
      },
    });
    await prisma.$connect();

    // Create self-contained test fixtures so tests never fail on empty/unseeded databases
    const timestamp = Date.now();
    testOwnerUser = await prisma.user.create({
      data: {
        email: `test.owner.${timestamp}@example.edu.ar`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: 'Test Owner',
      },
    });

    testTeacherUser = await prisma.user.create({
      data: {
        email: `test.teacher.${timestamp}@example.edu.ar`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: 'Test Teacher',
      },
    });

    testStudentUser = await prisma.user.create({
      data: {
        email: `test.student.${timestamp}@example.edu.ar`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: 'Test Student',
      },
    });

    testParentUser = await prisma.user.create({
      data: {
        email: `test.parent.${timestamp}@example.edu.ar`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: 'Test Parent',
      },
    });

    testSchool = await prisma.school.create({
      data: {
        name: `Test School ${timestamp}`,
        slug: `test-school-${timestamp}`,
        members: {
          create: {
            userId: testOwnerUser.id,
            role: 'OWNER',
            state: 'ACTIVE',
          },
        },
      },
    });

    testClassroom = await prisma.classroom.create({
      data: {
        schoolId: testSchool.id,
        name: `Test Classroom ${timestamp}`,
        memberships: {
          create: [
            { userId: testTeacherUser.id, role: 'TEACHER', state: 'ACTIVE' },
            { userId: testStudentUser.id, role: 'STUDENT', state: 'ACTIVE' },
          ],
        },
      },
    });
  }, 15000);

  afterAll(async () => {
    if (prisma) {
      // Teardown test fixtures
      if (testClassroom?.id) {
        await prisma.joinCodeUsage.deleteMany({
          where: { invitation: { classroomId: testClassroom.id } },
        });
        await prisma.invitation.deleteMany({
          where: { classroomId: testClassroom.id },
        });
        await prisma.desk.deleteMany({
          where: { classroomId: testClassroom.id },
        });
        await prisma.classroomPet.deleteMany({
          where: { classroomId: testClassroom.id },
        });
        await prisma.parentLink.deleteMany({
          where: { classroomId: testClassroom.id },
        });
        await prisma.classroomMembership.deleteMany({
          where: { classroomId: testClassroom.id },
        });
        await prisma.classroom.delete({ where: { id: testClassroom.id } });
      }

      if (testSchool?.id) {
        await prisma.invitation.deleteMany({
          where: { schoolId: testSchool.id },
        });
        await prisma.schoolMember.deleteMany({
          where: { schoolId: testSchool.id },
        });
        await prisma.school.delete({ where: { id: testSchool.id } });
      }

      const userIds = [
        testOwnerUser?.id,
        testTeacherUser?.id,
        testStudentUser?.id,
        testParentUser?.id,
      ].filter(Boolean);

      if (userIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }

      await prisma.$disconnect();
    }
  }, 15000);

  // 1. Classroom Owner Exclusion Tests
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
    await expect(
      prisma.classroom.create({
        data: {
          name: 'Invalid Classroom Dual Owner',
          schoolId: testSchool.id,
          independentTeacherId: testTeacherUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('allows inserting a valid classroom with schoolId only (Happy Path)', async () => {
    const valid = await prisma.classroom.create({
      data: {
        name: 'Valid School Classroom',
        schoolId: testSchool.id,
      },
    });
    expect(valid.id).toBeDefined();
    await prisma.classroom.delete({ where: { id: valid.id } });
  });

  it('allows inserting a valid classroom with independentTeacherId only (Happy Path)', async () => {
    const valid = await prisma.classroom.create({
      data: {
        name: 'Valid Independent Classroom',
        independentTeacherId: testTeacherUser.id,
      },
    });
    expect(valid.id).toBeDefined();
    await prisma.classroom.delete({ where: { id: valid.id } });
  });

  // 2. Email Uniqueness Tests
  it('rejects duplicate email for User', async () => {
    await expect(
      prisma.user.create({
        data: {
          email: testOwnerUser.email,
          passwordHash: 'some-hash',
          displayName: 'Duplicate User',
        },
      }),
    ).rejects.toThrow();
  });

  // 3. School Owner Partial Unique Index Tests
  it('rejects having two active owners for the same school via partial index', async () => {
    // Create a NEW user with NO existing membership in testSchool
    const extraUser = await prisma.user.create({
      data: {
        email: `extra.owner.${Date.now()}@example.com`,
        passwordHash: 'dummy-hash',
        displayName: 'Extra Candidate',
      },
    });

    try {
      // testSchool ALREADY has testOwnerUser as active OWNER
      // Attempting to add extraUser as a second active OWNER MUST be rejected by the partial index
      await expect(
        prisma.schoolMember.create({
          data: {
            schoolId: testSchool.id,
            userId: extraUser.id,
            role: 'OWNER',
            state: 'ACTIVE',
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.user.delete({ where: { id: extraUser.id } });
    }
  });

  // 4. Unique (school_id, user_id) in SchoolMember
  it('rejects duplicate school membership for the same user', async () => {
    await expect(
      prisma.schoolMember.create({
        data: {
          schoolId: testSchool.id,
          userId: testOwnerUser.id,
          role: 'ADMIN',
          state: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });

  // 5. Unique (classroom_id, user_id) in ClassroomMembership
  it('rejects duplicate enrollment in the same classroom for a student', async () => {
    await expect(
      prisma.classroomMembership.create({
        data: {
          classroomId: testClassroom.id,
          userId: testStudentUser.id,
          role: 'STUDENT',
          state: 'ACTIVE',
        },
      }),
    ).rejects.toThrow();
  });

  // 6. Invitation Integrity Tests
  it('rejects an email invitation without target_email', async () => {
    await expect(
      prisma.invitation.create({
        data: {
          kind: 'EMAIL',
          secretHash: `test-hash-no-email-${Date.now()}`,
          targetEmail: null,
          schoolId: testSchool.id,
          role: 'TEACHER',
          expiresAt: new Date(Date.now() + 100000),
          createdById: testOwnerUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a join code with non-null target_email', async () => {
    await expect(
      prisma.invitation.create({
        data: {
          kind: 'JOIN_CODE',
          secretHash: `test-hash-email-join-code-${Date.now()}`,
          targetEmail: 'illegal.email@example.com',
          classroomId: testClassroom.id,
          role: 'STUDENT',
          expiresAt: new Date(Date.now() + 100000),
          createdById: testTeacherUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a join code with a non-student role', async () => {
    await expect(
      prisma.invitation.create({
        data: {
          kind: 'JOIN_CODE',
          secretHash: `test-hash-invalid-role-${Date.now()}`,
          targetEmail: null,
          classroomId: testClassroom.id,
          role: 'TEACHER', // Join code must strictly be student
          expiresAt: new Date(Date.now() + 100000),
          createdById: testTeacherUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a join code where use_count exceeds max_uses', async () => {
    await expect(
      prisma.invitation.create({
        data: {
          kind: 'JOIN_CODE',
          secretHash: `test-hash-exceeded-uses-${Date.now()}`,
          targetEmail: null,
          classroomId: testClassroom.id,
          role: 'STUDENT',
          maxUses: 5,
          useCount: 6, // Exceeds max uses
          expiresAt: new Date(Date.now() + 100000),
          createdById: testTeacherUser.id,
        },
      }),
    ).rejects.toThrow();
  });

  // 7. ParentLink Uniqueness Tests
  it('rejects duplicate parent link for (parent, child, classroom)', async () => {
    const parentLink = await prisma.parentLink.create({
      data: {
        parentId: testParentUser.id,
        childId: testStudentUser.id,
        classroomId: testClassroom.id,
      },
    });

    try {
      await expect(
        prisma.parentLink.create({
          data: {
            parentId: testParentUser.id,
            childId: testStudentUser.id,
            classroomId: testClassroom.id,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await prisma.parentLink.delete({ where: { id: parentLink.id } });
    }
  });

  // 8. Timezone Verification
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
