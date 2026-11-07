import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClassroomRole, SchoolRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AccessVerificationService,
  computeClassroomCapabilities,
  type ClassroomCapability,
} from './access-verification.service';

describe('AccessVerificationService (HU-AUL-005)', () => {
  let service: AccessVerificationService;
  let prismaMock: {
    school: { findFirst: ReturnType<typeof vi.fn> };
    schoolMember: { findFirst: ReturnType<typeof vi.fn> };
    classroom: { findFirst: ReturnType<typeof vi.fn> };
    classroomMembership: { findFirst: ReturnType<typeof vi.fn> };
    parentLink: { findMany: ReturnType<typeof vi.fn> };
  };

  const SCHOOL_A_ID = 'aaaaaaaa-1111-4000-8000-000000000001';
  const SCHOOL_B_ID = 'bbbbbbbb-1111-4000-8000-000000000002';
  const CLASSROOM_A1_ID = 'cccccccc-1111-4000-8000-000000000001';
  const CLASSROOM_A2_ID = 'cccccccc-2222-4000-8000-000000000002';
  const CLASSROOM_IND_ID = 'cccccccc-3333-4000-8000-000000000003';

  const OWNER_USER_ID = '11111111-0000-4000-8000-000000000001';
  const ADMIN_USER_ID = '22222222-0000-4000-8000-000000000002';
  const TEACHER_1_USER_ID = '33333333-0000-4000-8000-000000000003';
  const TEACHER_2_USER_ID = '44444444-0000-4000-8000-000000000004';
  const IND_TEACHER_USER_ID = '55555555-0000-4000-8000-000000000005';
  const STUDENT_1_USER_ID = '66666666-0000-4000-8000-000000000006';
  const STUDENT_2_USER_ID = '77777777-0000-4000-8000-000000000007';
  const PARENT_1_USER_ID = '88888888-0000-4000-8000-000000000008';
  const STRANGER_USER_ID = '99999999-0000-4000-8000-000000000009';

  beforeEach(() => {
    prismaMock = {
      school: { findFirst: vi.fn() },
      schoolMember: { findFirst: vi.fn() },
      classroom: { findFirst: vi.fn() },
      classroomMembership: { findFirst: vi.fn() },
      parentLink: { findMany: vi.fn() },
    };

    service = new AccessVerificationService(prismaMock as unknown as PrismaService);
  });

  describe('Capabilities calculation helper (Permission Matrix)', () => {
    it('derives exact capability list for OWNER', () => {
      const capabilities = computeClassroomCapabilities('OWNER');
      expect(capabilities).toContain<ClassroomCapability>('manage_school');
      expect(capabilities).toContain<ClassroomCapability>('configure_classroom');
      expect(capabilities).toContain<ClassroomCapability>('invite_members');
      expect(capabilities).toContain<ClassroomCapability>('publish_content');
      expect(capabilities).toContain<ClassroomCapability>('moderate_chat');
      expect(capabilities).toContain<ClassroomCapability>('configure_bot');
      expect(capabilities).toContain<ClassroomCapability>('view_metrics');
      expect(capabilities).not.toContain<ClassroomCapability>('participate_activities');
    });

    it('derives exact capability list for TEACHER', () => {
      const capabilities = computeClassroomCapabilities('TEACHER');
      expect(capabilities).not.toContain<ClassroomCapability>('manage_school');
      expect(capabilities).toContain<ClassroomCapability>('configure_classroom');
      expect(capabilities).toContain<ClassroomCapability>('publish_content');
      expect(capabilities).toContain<ClassroomCapability>('moderate_chat');
      expect(capabilities).not.toContain<ClassroomCapability>('participate_activities');
    });

    it('derives exact capability list for STUDENT', () => {
      const capabilities = computeClassroomCapabilities('STUDENT');
      expect(capabilities).not.toContain<ClassroomCapability>('manage_school');
      expect(capabilities).not.toContain<ClassroomCapability>('publish_content');
      expect(capabilities).not.toContain<ClassroomCapability>('moderate_chat');
      expect(capabilities).toContain<ClassroomCapability>('participate_activities');
      expect(capabilities).toContain<ClassroomCapability>('chat_classmates');
      expect(capabilities).toContain<ClassroomCapability>('list_directory');
    });

    it('derives exact capability list for PARENT', () => {
      const capabilities = computeClassroomCapabilities('PARENT');
      expect(capabilities).toEqual(['view_metrics', 'message_teacher']);
    });
  });

  describe('verifySchoolAccess', () => {
    it('throws 404 when school is not found or soft-deleted', async () => {
      prismaMock.school.findFirst.mockResolvedValue(null);

      await expect(service.verifySchoolAccess(OWNER_USER_ID, SCHOOL_A_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws 404 when user is not an active member of the school (stranger)', async () => {
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);

      await expect(service.verifySchoolAccess(STRANGER_USER_ID, SCHOOL_A_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns school details and role for active member', async () => {
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.OWNER });

      const result = await service.verifySchoolAccess(OWNER_USER_ID, SCHOOL_A_ID);
      expect(result).toEqual({
        schoolId: SCHOOL_A_ID,
        userId: OWNER_USER_ID,
        role: SchoolRole.OWNER,
      });
    });

    it('throws 403 when member lacks required OWNER role', async () => {
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.TEACHER });

      await expect(
        service.verifySchoolAccess(TEACHER_1_USER_ID, SCHOOL_A_ID, { requiredRole: 'OWNER' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows OWNER when ADMIN role is required', async () => {
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.OWNER });

      const result = await service.verifySchoolAccess(OWNER_USER_ID, SCHOOL_A_ID, {
        requiredRole: 'ADMIN',
      });
      expect(result.role).toBe(SchoolRole.OWNER);
    });
  });

  describe('verifyClassroomAccess (Hierarchy & Isolation)', () => {
    it('throws 404 when classroom does not exist or is soft-deleted', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue(null);

      await expect(service.verifyClassroomAccess(OWNER_USER_ID, CLASSROOM_A1_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows School Owner teacher-level authority over ALL classrooms of their school', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.OWNER });

      const result = await service.verifyClassroomAccess(OWNER_USER_ID, CLASSROOM_A1_ID, {
        requiredRole: 'STAFF',
      });

      expect(result.myRole).toBe('OWNER');
      expect(result.capabilities).toContain('configure_classroom');
      expect(result.capabilities).toContain('manage_school');
    });

    it('allows School Admin teacher-level authority over classrooms of their school', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.ADMIN });

      const result = await service.verifyClassroomAccess(ADMIN_USER_ID, CLASSROOM_A1_ID, {
        requiredRole: 'TEACHER',
      });

      expect(result.myRole).toBe('ADMIN');
      expect(result.capabilities).toContain('configure_classroom');
    });

    it('throws 404 when a School Owner/Admin accesses a classroom of ANOTHER school', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_B_ID,
        independentTeacherId: null,
        name: 'Classroom in Other School',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_B_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(service.verifyClassroomAccess(OWNER_USER_ID, CLASSROOM_A1_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('allows Teacher on their own classroom', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      // In schoolMember, this teacher has TEACHER role (does not grant school-wide authority)
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.TEACHER });
      // Has teacher membership in CLASSROOM_A1
      prismaMock.classroomMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        role: ClassroomRole.TEACHER,
      });

      const result = await service.verifyClassroomAccess(TEACHER_1_USER_ID, CLASSROOM_A1_ID, {
        requiredRole: 'STAFF',
      });

      expect(result.myRole).toBe('TEACHER');
    });

    it('throws 404 when Teacher attempts to act on another teacher classroom in the SAME school', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A2_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 2',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.TEACHER });
      // Not a teacher or student in CLASSROOM_A2
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(
        service.verifyClassroomAccess(TEACHER_1_USER_ID, CLASSROOM_A2_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows Independent Teacher on their own classroom', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_IND_ID,
        schoolId: null,
        independentTeacherId: IND_TEACHER_USER_ID,
        name: 'Independent Classroom',
        adultMode: false,
      });

      const result = await service.verifyClassroomAccess(IND_TEACHER_USER_ID, CLASSROOM_IND_ID, {
        requiredRole: 'TEACHER',
      });

      expect(result.myRole).toBe('TEACHER');
    });

    it('throws 404 when Independent Teacher accesses another teacher classroom', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_IND_ID,
        schoolId: null,
        independentTeacherId: IND_TEACHER_USER_ID,
        name: 'Independent Classroom',
        adultMode: false,
      });
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(
        service.verifyClassroomAccess(TEACHER_2_USER_ID, CLASSROOM_IND_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows enrolled student on own classroom with STUDENT role', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue({
        id: 'mem-s1',
        role: ClassroomRole.STUDENT,
      });

      const result = await service.verifyClassroomAccess(STUDENT_1_USER_ID, CLASSROOM_A1_ID, {
        requiredRole: 'STUDENT',
      });

      expect(result.myRole).toBe('STUDENT');
      expect(result.capabilities).toContain('participate_activities');
    });

    it('throws 403 Forbidden when student attempts STAFF action in own classroom', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue({
        id: 'mem-s1',
        role: ClassroomRole.STUDENT,
      });

      await expect(
        service.verifyClassroomAccess(STUDENT_1_USER_ID, CLASSROOM_A1_ID, {
          requiredRole: 'STAFF',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when student is not enrolled in the classroom', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A2_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 2',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(
        service.verifyClassroomAccess(STUDENT_1_USER_ID, CLASSROOM_A2_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows linked Parent access when adult mode is OFF', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([{ childId: STUDENT_1_USER_ID }]);

      const result = await service.verifyClassroomAccess(PARENT_1_USER_ID, CLASSROOM_A1_ID);

      expect(result.myRole).toBe('PARENT');
      expect(result.linkedChildIds).toEqual([STUDENT_1_USER_ID]);
    });

    it('rejects Parent access with 404 when classroom has adultMode = true', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Adult Classroom',
        adultMode: true,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([{ childId: STUDENT_1_USER_ID }]);

      await expect(
        service.verifyClassroomAccess(PARENT_1_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 for complete stranger', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(
        service.verifyClassroomAccess(STRANGER_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('verifyStudentResourceAccess', () => {
    beforeEach(() => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
    });

    it('allows student to access their own resource', async () => {
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockImplementation(({ where }) => {
        if (where.userId === STUDENT_1_USER_ID) {
          return Promise.resolve({ id: 'mem-s1', role: ClassroomRole.STUDENT });
        }
        return Promise.resolve(null);
      });

      const result = await service.verifyStudentResourceAccess(
        STUDENT_1_USER_ID,
        STUDENT_1_USER_ID,
        CLASSROOM_A1_ID,
      );

      expect(result.myRole).toBe('STUDENT');
    });

    it('allows Staff (Owner / Admin / Teacher) to access student resource', async () => {
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.OWNER });
      prismaMock.classroomMembership.findFirst.mockImplementation(({ where }) => {
        if (where.userId === STUDENT_1_USER_ID) {
          return Promise.resolve({ id: 'mem-s1', role: ClassroomRole.STUDENT });
        }
        return Promise.resolve(null);
      });

      const result = await service.verifyStudentResourceAccess(
        OWNER_USER_ID,
        STUDENT_1_USER_ID,
        CLASSROOM_A1_ID,
      );

      expect(result.myRole).toBe('OWNER');
    });

    it('allows linked Parent to access child resource', async () => {
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockImplementation(({ where }) => {
        if (where.userId === STUDENT_1_USER_ID) {
          return Promise.resolve({ id: 'mem-s1', role: ClassroomRole.STUDENT });
        }
        return Promise.resolve(null);
      });
      prismaMock.parentLink.findMany.mockResolvedValue([{ childId: STUDENT_1_USER_ID }]);

      const result = await service.verifyStudentResourceAccess(
        PARENT_1_USER_ID,
        STUDENT_1_USER_ID,
        CLASSROOM_A1_ID,
      );

      expect(result.myRole).toBe('PARENT');
    });

    it('throws 403 Forbidden when a classmate tries to access another student resource', async () => {
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockImplementation(({ where }) => {
        if (where.userId === STUDENT_1_USER_ID) {
          return Promise.resolve({ id: 'mem-s1', role: ClassroomRole.STUDENT });
        }
        if (where.userId === STUDENT_2_USER_ID) {
          return Promise.resolve({ id: 'mem-s2', role: ClassroomRole.STUDENT });
        }
        return Promise.resolve(null);
      });

      await expect(
        service.verifyStudentResourceAccess(STUDENT_1_USER_ID, STUDENT_2_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws 404 when Parent tries to access unlinked child resource', async () => {
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockImplementation(({ where }) => {
        if (where.userId === STUDENT_2_USER_ID) {
          return Promise.resolve({ id: 'mem-s2', role: ClassroomRole.STUDENT });
        }
        return Promise.resolve(null);
      });
      prismaMock.parentLink.findMany.mockResolvedValue([{ childId: STUDENT_1_USER_ID }]);

      await expect(
        service.verifyStudentResourceAccess(PARENT_1_USER_ID, STUDENT_2_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 when stranger attempts to access student resource', async () => {
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue(null);
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(
        service.verifyStudentResourceAccess(STRANGER_USER_ID, STUDENT_1_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Concurrency & Idempotency', () => {
    it('handles concurrent verification requests cleanly without state corruption', async () => {
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.schoolMember.findFirst.mockResolvedValue({ role: SchoolRole.OWNER });

      const executions = await Promise.all([
        service.verifyClassroomAccess(OWNER_USER_ID, CLASSROOM_A1_ID),
        service.verifyClassroomAccess(OWNER_USER_ID, CLASSROOM_A1_ID),
        service.verifyClassroomAccess(OWNER_USER_ID, CLASSROOM_A1_ID),
      ]);

      expect(executions).toHaveLength(3);
      for (const res of executions) {
        expect(res.myRole).toBe('OWNER');
        expect(res.capabilities).toContain('manage_school');
      }
    });
  });
});
