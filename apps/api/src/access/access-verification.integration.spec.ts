import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ClassroomRole,
  MembershipState,
  PrismaClient,
  RegistrationPath,
  SchoolRole,
} from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { AccessVerificationService } from './access-verification.service';

describe('AccessVerificationService PostgreSQL Integration Tests (HU-AUL-005)', () => {
  let prisma: PrismaClient;
  let service: AccessVerificationService;

  // Track created entity IDs for clean teardown
  const createdUserIds: string[] = [];
  const createdClassroomIds: string[] = [];
  let createdSchoolId: string | undefined;

  let school: { id: string };
  let ownerUser: { id: string };
  let adminUser: { id: string };
  let teacher1User: { id: string };
  let teacher2User: { id: string };
  let inactiveTeacherUser: { id: string };
  let student1User: { id: string };
  let student2User: { id: string };
  let parentUser: { id: string };
  let strangerUser: { id: string };

  let classroom1: { id: string };
  let classroom2: { id: string };
  let adultClassroom: { id: string };

  beforeAll(async () => {
    const globalProcess = (
      globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const dbUrl =
      globalProcess?.env?.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

    prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
    });
    await prisma.$connect();

    service = new AccessVerificationService(prisma as unknown as PrismaService);

    const ts = Date.now();

    // 1. Create School
    const createdSchool = await prisma.school.create({
      data: {
        name: `Matrix Test School ${ts}`,
        slug: `matrix-school-${ts}`,
        timeZone: 'America/Argentina/Buenos_Aires',
      },
    });
    school = createdSchool;
    createdSchoolId = createdSchool.id;

    // 2. Create Users
    const createTestUser = async (rolePrefix: string, path: RegistrationPath) => {
      const u = await prisma.user.create({
        data: {
          email: `${rolePrefix}.${ts}@example.edu.ar`,
          passwordHash: 'dummy-hashed-secret-for-integration-tests',
          displayName: `${rolePrefix.toUpperCase()} User`,
          registrationPath: path,
        },
      });
      createdUserIds.push(u.id);
      return u;
    };

    ownerUser = await createTestUser(`owner.${ts}`, RegistrationPath.SCHOOL);
    adminUser = await createTestUser(`admin.${ts}`, RegistrationPath.SCHOOL);
    teacher1User = await createTestUser(`teacher1.${ts}`, RegistrationPath.SCHOOL);
    teacher2User = await createTestUser(`teacher2.${ts}`, RegistrationPath.SCHOOL);
    inactiveTeacherUser = await createTestUser(`inactive.teacher.${ts}`, RegistrationPath.SCHOOL);
    student1User = await createTestUser(`student1.${ts}`, RegistrationPath.INDEPENDENT_TEACHER);
    student2User = await createTestUser(`student2.${ts}`, RegistrationPath.INDEPENDENT_TEACHER);
    parentUser = await createTestUser(`parent.${ts}`, RegistrationPath.INDEPENDENT_TEACHER);
    strangerUser = await createTestUser(`stranger.${ts}`, RegistrationPath.INDEPENDENT_TEACHER);

    // 3. Create School Memberships
    await prisma.schoolMember.createMany({
      data: [
        {
          schoolId: school.id,
          userId: ownerUser.id,
          role: SchoolRole.OWNER,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: school.id,
          userId: adminUser.id,
          role: SchoolRole.ADMIN,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: school.id,
          userId: teacher1User.id,
          role: SchoolRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: school.id,
          userId: teacher2User.id,
          role: SchoolRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          schoolId: school.id,
          userId: inactiveTeacherUser.id,
          role: SchoolRole.TEACHER,
          state: MembershipState.INACTIVE,
        },
      ],
    });

    // 4. Create Classrooms
    const c1 = await prisma.classroom.create({
      data: {
        schoolId: school.id,
        name: `Classroom 1 ${ts}`,
        adultMode: false,
      },
    });
    classroom1 = c1;
    createdClassroomIds.push(c1.id);

    const c2 = await prisma.classroom.create({
      data: {
        schoolId: school.id,
        name: `Classroom 2 ${ts}`,
        adultMode: false,
      },
    });
    classroom2 = c2;
    createdClassroomIds.push(c2.id);

    const ac = await prisma.classroom.create({
      data: {
        schoolId: school.id,
        name: `Adult Classroom ${ts}`,
        adultMode: true,
      },
    });
    adultClassroom = ac;
    createdClassroomIds.push(ac.id);

    // 5. Create Classroom Memberships
    await prisma.classroomMembership.createMany({
      data: [
        {
          classroomId: classroom1.id,
          userId: teacher1User.id,
          role: ClassroomRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroom2.id,
          userId: teacher2User.id,
          role: ClassroomRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroom1.id,
          userId: inactiveTeacherUser.id,
          role: ClassroomRole.TEACHER,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroom1.id,
          userId: student1User.id,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: classroom1.id,
          userId: student2User.id,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
        {
          classroomId: adultClassroom.id,
          userId: student1User.id,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
      ],
    });

    // 6. Create Parent Links
    await prisma.parentLink.createMany({
      data: [
        {
          parentId: parentUser.id,
          childId: student1User.id,
          classroomId: classroom1.id,
          state: MembershipState.ACTIVE,
        },
        {
          parentId: parentUser.id,
          childId: student1User.id,
          classroomId: adultClassroom.id,
          state: MembershipState.ACTIVE,
        },
      ],
    });
  });

  afterAll(async () => {
    if (createdClassroomIds.length > 0) {
      await prisma.parentLink.deleteMany({
        where: { classroomId: { in: createdClassroomIds } },
      });
      await prisma.classroomMembership.deleteMany({
        where: { classroomId: { in: createdClassroomIds } },
      });
      await prisma.classroom.deleteMany({
        where: { id: { in: createdClassroomIds } },
      });
    }

    if (createdSchoolId) {
      await prisma.schoolMember.deleteMany({
        where: { schoolId: createdSchoolId },
      });
      await prisma.school.deleteMany({
        where: { id: createdSchoolId },
      });
    }

    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }

    await prisma.$disconnect();
  });

  describe('PostgreSQL UUID safety (Malformed non-UUID IDs)', () => {
    it('returns 404 and NOT 500 when schoolId is not a valid UUID', async () => {
      await expect(service.verifySchoolAccess(ownerUser.id, 'not-a-valid-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 and NOT 500 when actorUserId is not a valid UUID in verifySchoolAccess', async () => {
      await expect(service.verifySchoolAccess('not-a-valid-uuid', school.id)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 and NOT 500 when classroomId is not a valid UUID', async () => {
      await expect(service.verifyClassroomAccess(ownerUser.id, 'not-a-valid-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 and NOT 500 when actorUserId is not a valid UUID in verifyClassroomAccess', async () => {
      await expect(
        service.verifyClassroomAccess('not-a-valid-uuid', classroom1.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns 404 and NOT 500 when targetStudentId is not a valid UUID in verifyStudentResourceAccess', async () => {
      await expect(
        service.verifyStudentResourceAccess(ownerUser.id, 'not-a-valid-uuid', classroom1.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('School Owner & Admin authority over classrooms', () => {
    it('grants School Owner teacher-level authority over any classroom of their school', async () => {
      const res1 = await service.verifyClassroomAccess(ownerUser.id, classroom1.id, {
        requiredRole: 'STAFF',
      });
      expect(res1.myRole).toBe('OWNER');
      expect(res1.capabilities).toContain('manage_school');
      expect(res1.capabilities).toContain('configure_classroom');

      const res2 = await service.verifyClassroomAccess(ownerUser.id, classroom2.id, {
        requiredRole: 'TEACHER',
      });
      expect(res2.myRole).toBe('OWNER');
    });

    it('grants School Admin teacher-level authority over any classroom of their school', async () => {
      const res1 = await service.verifyClassroomAccess(adminUser.id, classroom1.id, {
        requiredRole: 'TEACHER',
      });
      expect(res1.myRole).toBe('ADMIN');
      expect(res1.capabilities).not.toContain('manage_school');
      expect(res1.capabilities).toContain('configure_classroom');

      const res2 = await service.verifyClassroomAccess(adminUser.id, classroom2.id);
      expect(res2.myRole).toBe('ADMIN');
    });
  });

  describe('Teacher isolation and active school status', () => {
    it('allows teacher to access their own classroom', async () => {
      const res = await service.verifyClassroomAccess(teacher1User.id, classroom1.id, {
        requiredRole: 'TEACHER',
      });
      expect(res.myRole).toBe('TEACHER');
      expect(res.capabilities).toContain('configure_classroom');
      expect(res.capabilities).not.toContain('manage_school');
    });

    it('rejects inactive school teacher with 404 even if ClassroomMembership row exists', async () => {
      await expect(
        service.verifyClassroomAccess(inactiveTeacherUser.id, classroom1.id),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects teacher attempting to act on another teacher classroom with 404', async () => {
      await expect(service.verifyClassroomAccess(teacher1User.id, classroom2.id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.verifyClassroomAccess(teacher2User.id, classroom1.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Student permissions and isolation', () => {
    it('allows student to access their enrolled classroom', async () => {
      const res = await service.verifyClassroomAccess(student1User.id, classroom1.id, {
        requiredRole: 'STUDENT',
      });
      expect(res.myRole).toBe('STUDENT');
      expect(res.capabilities).toContain('participate_activities');
    });

    it('throws 403 Forbidden when student attempts teacher or staff action', async () => {
      await expect(
        service.verifyClassroomAccess(student1User.id, classroom1.id, { requiredRole: 'TEACHER' }),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.verifyClassroomAccess(student1User.id, classroom1.id, { requiredRole: 'STAFF' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Parent link and Adult Mode', () => {
    it('allows linked parent when adultMode is false', async () => {
      const res = await service.verifyClassroomAccess(parentUser.id, classroom1.id);
      expect(res.myRole).toBe('PARENT');
      expect(res.linkedChildIds).toEqual([student1User.id]);
    });

    it('rejects parent link with 404 when classroom has adultMode = true', async () => {
      await expect(service.verifyClassroomAccess(parentUser.id, adultClassroom.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Student private resource access', () => {
    it('allows student to access their own resource', async () => {
      const res = await service.verifyStudentResourceAccess(
        student1User.id,
        student1User.id,
        classroom1.id,
      );
      expect(res.myRole).toBe('STUDENT');
    });

    it('allows staff (Owner, Admin, Teacher) to access student resource', async () => {
      const resOwner = await service.verifyStudentResourceAccess(
        ownerUser.id,
        student1User.id,
        classroom1.id,
      );
      expect(resOwner.myRole).toBe('OWNER');

      const resAdmin = await service.verifyStudentResourceAccess(
        adminUser.id,
        student1User.id,
        classroom1.id,
      );
      expect(resAdmin.myRole).toBe('ADMIN');

      const resTeacher = await service.verifyStudentResourceAccess(
        teacher1User.id,
        student1User.id,
        classroom1.id,
      );
      expect(resTeacher.myRole).toBe('TEACHER');
    });

    it('throws 403 Forbidden when classmate student attempts to access another student resource', async () => {
      await expect(
        service.verifyStudentResourceAccess(student1User.id, student2User.id, classroom1.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 NotFound when stranger attempts to access student resource', async () => {
      await expect(
        service.verifyStudentResourceAccess(strangerUser.id, student1User.id, classroom1.id),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
