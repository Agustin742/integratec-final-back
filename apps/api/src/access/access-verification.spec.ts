import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ClassroomRole, RegistrationPath, SchoolRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestValidationException } from '../http/validation';
import type { PrismaService } from '../prisma/prisma.service';
import {
  AccessVerificationService,
  computeClassroomCapabilities,
  computeClassroomPanels,
  type ClassroomAccessRole,
  deriveClassroomAccessRole,
  type ClassroomCapability,
  type ClassroomRoleFacts,
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
      parentLink: { findMany: vi.fn().mockResolvedValue([]) },
    };

    service = new AccessVerificationService(prismaMock as unknown as PrismaService);
  });

  describe('Panel projection (not operation authorization)', () => {
    const staff = [
      'activities',
      'material',
      'grades',
      'chat',
      'notices',
      'bot',
      'members',
      'settings',
    ];
    const student = [
      'activities',
      'material',
      'grades',
      'chat',
      'notices',
      'shop',
      'bot',
      'members',
    ];
    it.each<{ role: ClassroomAccessRole; expected: string[] }>([
      { role: 'OWNER', expected: staff },
      { role: 'ADMIN', expected: staff },
      { role: 'TEACHER', expected: staff },
      { role: 'STUDENT', expected: student },
      { role: 'PARENT', expected: ['grades'] },
    ])(
      'returns a stable, fresh, unique array for $role without reserved pet',
      ({ role, expected }) => {
        const panels = computeClassroomPanels(role);
        expect(panels).toEqual(expected);
        expect(new Set(panels).size).toBe(panels.length);
        expect(panels).not.toContain('pet');
        expect(computeClassroomPanels(role)).not.toBe(panels);
        panels.splice(0, panels.length);
        expect(computeClassroomPanels(role)).toEqual(expected);
      },
    );
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

    it('derives exact capability list for ADMIN', () => {
      const capabilities = computeClassroomCapabilities('ADMIN');
      expect(capabilities).not.toContain<ClassroomCapability>('manage_school');
      expect(capabilities).toContain<ClassroomCapability>('configure_classroom');
      expect(capabilities).toContain<ClassroomCapability>('invite_members');
      expect(capabilities).toContain<ClassroomCapability>('publish_content');
      expect(capabilities).toContain<ClassroomCapability>('moderate_chat');
      expect(capabilities).toContain<ClassroomCapability>('configure_bot');
      expect(capabilities).toContain<ClassroomCapability>('view_metrics');
      expect(capabilities).toContain<ClassroomCapability>('chat_classmates');
      expect(capabilities).toContain<ClassroomCapability>('list_directory');
      expect(capabilities).toContain<ClassroomCapability>('message_teacher');
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
    it('throws 404 immediately for malformed non-UUID actorUserId or schoolId without querying database', async () => {
      await expect(service.verifySchoolAccess('not-a-valid-uuid', SCHOOL_A_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.verifySchoolAccess(OWNER_USER_ID, 'not-a-valid-uuid')).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.school.findFirst).not.toHaveBeenCalled();
    });

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
    it('throws 404 immediately for malformed non-UUID actorUserId or classroomId without querying database', async () => {
      await expect(
        service.verifyClassroomAccess('not-a-valid-uuid', CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.verifyClassroomAccess(OWNER_USER_ID, 'not-a-valid-uuid'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.classroom.findFirst).not.toHaveBeenCalled();
    });

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

    it('throws 404 when Teacher has classroom membership but is INACTIVE or removed from the school', async () => {
      prismaMock.classroom.findFirst.mockResolvedValue({
        id: CLASSROOM_A1_ID,
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        name: 'Classroom 1',
        adultMode: false,
      });
      prismaMock.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      // Inactive/removed in school -> active member query returns null
      prismaMock.schoolMember.findFirst.mockResolvedValue(null);
      prismaMock.classroomMembership.findFirst.mockResolvedValue({
        id: 'mem-1',
        role: ClassroomRole.TEACHER,
      });
      prismaMock.parentLink.findMany.mockResolvedValue([]);

      await expect(
        service.verifyClassroomAccess(TEACHER_1_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
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

    it('throws 404 immediately for malformed non-UUID IDs without querying database', async () => {
      await expect(
        service.verifyStudentResourceAccess('not-a-uuid', STUDENT_1_USER_ID, CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.verifyStudentResourceAccess(STUDENT_1_USER_ID, 'not-a-uuid', CLASSROOM_A1_ID),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.verifyStudentResourceAccess(STUDENT_1_USER_ID, STUDENT_1_USER_ID, 'not-a-uuid'),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.classroom.findFirst).not.toHaveBeenCalled();
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
  describe('resolveClassroomCreationTarget', () => {
    let db: {
      user: { findUnique: ReturnType<typeof vi.fn> };
      school: { findFirst: ReturnType<typeof vi.fn> };
      schoolMember: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
      classroomMembership: { findFirst: ReturnType<typeof vi.fn> };
      parentLink: { findFirst: ReturnType<typeof vi.fn> };
    };
    let creation: AccessVerificationService;

    beforeEach(() => {
      db = {
        user: { findUnique: vi.fn() },
        school: { findFirst: vi.fn().mockResolvedValue(null) },
        schoolMember: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn() },
        classroomMembership: { findFirst: vi.fn().mockResolvedValue(null) },
        parentLink: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      creation = new AccessVerificationService(db as unknown as PrismaService);
    });

    it('answers a nonexistent school and an unrelated existing school identically with 404', async () => {
      db.school.findFirst.mockResolvedValueOnce(null);
      const missing = await creation
        .resolveClassroomCreationTarget(STUDENT_1_USER_ID, SCHOOL_B_ID)
        .catch((e: unknown) => e);

      db.school.findFirst.mockResolvedValueOnce({ id: SCHOOL_A_ID });
      db.schoolMember.findFirst.mockResolvedValueOnce(null);
      const unrelated = await creation
        .resolveClassroomCreationTarget(STUDENT_1_USER_ID, SCHOOL_A_ID)
        .catch((e: unknown) => e);

      expect(missing).toBeInstanceOf(NotFoundException);
      expect(unrelated).toBeInstanceOf(NotFoundException);
      expect((unrelated as NotFoundException).getResponse()).toEqual(
        (missing as NotFoundException).getResponse(),
      );
    });

    it('answers 403 only when the caller is an enrolled student or linked parent of that school', async () => {
      db.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      db.classroomMembership.findFirst.mockResolvedValueOnce({ id: 'enrollment' });
      await expect(
        creation.resolveClassroomCreationTarget(STUDENT_1_USER_ID, SCHOOL_A_ID),
      ).rejects.toThrow(ForbiddenException);

      db.parentLink.findFirst.mockResolvedValueOnce({ id: 'link' });
      await expect(
        creation.resolveClassroomCreationTarget(PARENT_1_USER_ID, SCHOOL_A_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('answers 404 for a malformed schoolId without touching the database', async () => {
      await expect(
        creation.resolveClassroomCreationTarget(OWNER_USER_ID, 'not-a-uuid'),
      ).rejects.toThrow(NotFoundException);
      expect(db.school.findFirst).not.toHaveBeenCalled();
      expect(db.classroomMembership.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      [SchoolRole.OWNER, 'OWNER'],
      [SchoolRole.ADMIN, 'ADMIN'],
      [SchoolRole.TEACHER, 'TEACHER'],
    ] as const)('resolves an explicit school target for a school %s', async (role, expected) => {
      db.school.findFirst.mockResolvedValue({ id: SCHOOL_A_ID });
      db.schoolMember.findFirst.mockResolvedValue({ role });

      const target = await creation.resolveClassroomCreationTarget(OWNER_USER_ID, SCHOOL_A_ID);

      expect(target).toMatchObject({
        schoolId: SCHOOL_A_ID,
        independentTeacherId: null,
        schoolRole: role,
        myRole: expected,
      });
      expect(target.capabilities).toEqual(computeClassroomCapabilities(expected));
    });

    it('denies staff of one school in another school with 404', async () => {
      db.school.findFirst.mockResolvedValue({ id: SCHOOL_B_ID });
      db.schoolMember.findFirst.mockResolvedValue(null);

      await expect(
        creation.resolveClassroomCreationTarget(OWNER_USER_ID, SCHOOL_B_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('lets an INDEPENDENT_TEACHER-path user create their own classroom even if enrolled as a student', async () => {
      db.user.findUnique.mockResolvedValue({
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      });
      db.classroomMembership.findFirst.mockResolvedValue({ id: 'enrollment' });

      const target = await creation.resolveClassroomCreationTarget(IND_TEACHER_USER_ID);

      expect(target).toMatchObject({
        schoolId: null,
        independentTeacherId: IND_TEACHER_USER_ID,
        schoolRole: null,
        myRole: 'TEACHER',
      });
    });

    it('uses the single active school membership of a SCHOOL-path user when schoolId is omitted', async () => {
      db.user.findUnique.mockResolvedValue({ registrationPath: RegistrationPath.SCHOOL });
      db.schoolMember.findMany.mockResolvedValue([
        { schoolId: SCHOOL_A_ID, role: SchoolRole.ADMIN },
      ]);

      const target = await creation.resolveClassroomCreationTarget(ADMIN_USER_ID);

      expect(target).toMatchObject({
        schoolId: SCHOOL_A_ID,
        schoolRole: 'ADMIN',
        myRole: 'ADMIN',
      });
    });

    it('requires an explicit schoolId (400 on schoolId) when a SCHOOL-path user has several memberships', async () => {
      db.user.findUnique.mockResolvedValue({ registrationPath: RegistrationPath.SCHOOL });
      db.schoolMember.findMany.mockResolvedValue([
        { schoolId: SCHOOL_A_ID, role: SchoolRole.TEACHER },
        { schoolId: SCHOOL_B_ID, role: SchoolRole.TEACHER },
      ]);

      const error = await creation
        .resolveClassroomCreationTarget(TEACHER_1_USER_ID)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RequestValidationException);
      expect((error as RequestValidationException).details).toEqual([
        { field: 'schoolId', messages: [expect.stringContaining('schoolId')] },
      ]);
    });

    it('answers a SCHOOL-path user with no active membership and no learner relation with 404', async () => {
      db.user.findUnique.mockResolvedValue({ registrationPath: RegistrationPath.SCHOOL });
      db.schoolMember.findMany.mockResolvedValue([]);

      await expect(creation.resolveClassroomCreationTarget(STRANGER_USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('answers a SCHOOL-path learner without school membership with 403', async () => {
      db.user.findUnique.mockResolvedValue({ registrationPath: RegistrationPath.SCHOOL });
      db.schoolMember.findMany.mockResolvedValue([]);
      db.classroomMembership.findFirst.mockResolvedValue({ id: 'enrollment' });

      await expect(creation.resolveClassroomCreationTarget(STUDENT_1_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('answers 401 for an unknown actor', async () => {
      db.user.findUnique.mockResolvedValue(null);

      await expect(creation.resolveClassroomCreationTarget(STRANGER_USER_ID)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('deriveClassroomAccessRole', () => {
    const facts = (over: Partial<ClassroomRoleFacts>): ClassroomRoleFacts => ({
      actorUserId: STUDENT_1_USER_ID,
      classroom: { schoolId: SCHOOL_A_ID, independentTeacherId: null, adultMode: false },
      schoolRole: null,
      membershipRole: null,
      hasActiveParentLink: false,
      ...over,
    });

    it('returns null when no relation resolves (fail closed, never defaults to STUDENT)', () => {
      expect(deriveClassroomAccessRole(facts({}))).toBeNull();
    });

    it('gives school Owner and Admin authority over the school classroom regardless of enrollment', () => {
      expect(
        deriveClassroomAccessRole(
          facts({ schoolRole: SchoolRole.OWNER, membershipRole: ClassroomRole.STUDENT }),
        ),
      ).toBe('OWNER');
      expect(deriveClassroomAccessRole(facts({ schoolRole: SchoolRole.ADMIN }))).toBe('ADMIN');
    });

    it('requires an active school membership for a school classroom teacher', () => {
      expect(
        deriveClassroomAccessRole(facts({ membershipRole: ClassroomRole.TEACHER })),
      ).toBeNull();
      expect(
        deriveClassroomAccessRole(
          facts({ membershipRole: ClassroomRole.TEACHER, schoolRole: SchoolRole.TEACHER }),
        ),
      ).toBe('TEACHER');
    });

    it('resolves independent teacher, student and parent, hiding the parent in adult mode', () => {
      const independent = {
        schoolId: null,
        independentTeacherId: STUDENT_1_USER_ID,
        adultMode: false,
      };
      expect(deriveClassroomAccessRole(facts({ classroom: independent }))).toBe('TEACHER');
      expect(deriveClassroomAccessRole(facts({ membershipRole: ClassroomRole.STUDENT }))).toBe(
        'STUDENT',
      );
      expect(deriveClassroomAccessRole(facts({ hasActiveParentLink: true }))).toBe('PARENT');
      expect(
        deriveClassroomAccessRole(
          facts({
            hasActiveParentLink: true,
            classroom: { schoolId: SCHOOL_A_ID, independentTeacherId: null, adultMode: true },
          }),
        ),
      ).toBeNull();
    });
  });

  describe('listAccessibleClassrooms', () => {
    const row = (over: Record<string, unknown>) => ({
      id: CLASSROOM_A1_ID,
      name: 'Aula',
      subject: null,
      schoolId: SCHOOL_A_ID,
      independentTeacherId: null,
      adultMode: false,
      chatMuted: false,
      collaborationLocked: false,
      gamesDisabled: false,
      deletedAt: null,
      createdAt: new Date('2026-11-07T20:00:00.000Z'),
      updatedAt: new Date('2026-11-07T20:00:00.000Z'),
      school: { deletedAt: null, members: [] },
      memberships: [],
      parentLinks: [],
      ...over,
    });

    it('derives role and capabilities per row with the same hierarchy as verifyClassroomAccess', async () => {
      const findMany = vi.fn().mockResolvedValue([
        row({
          id: CLASSROOM_A1_ID,
          school: { deletedAt: null, members: [{ role: SchoolRole.OWNER }] },
        }),
        row({ id: CLASSROOM_A2_ID, memberships: [{ role: ClassroomRole.STUDENT }] }),
        row({ id: CLASSROOM_IND_ID, schoolId: null, school: null, parentLinks: [{ id: 'link' }] }),
      ]);
      const db = { classroom: { findMany, count: vi.fn().mockResolvedValue(3) } };
      const listing = new AccessVerificationService(db as unknown as PrismaService);

      const result = await listing.listAccessibleClassrooms(STUDENT_1_USER_ID, {
        skip: 0,
        take: 20,
        sort: { field: 'createdAt', direction: 'desc' },
      });

      expect(result.total).toBe(3);
      expect(result.items.map((i) => [i.classroom.id, i.myRole])).toEqual([
        [CLASSROOM_A1_ID, 'OWNER'],
        [CLASSROOM_A2_ID, 'STUDENT'],
        [CLASSROOM_IND_ID, 'PARENT'],
      ]);
      expect(result.items[1].capabilities).toEqual(computeClassroomCapabilities('STUDENT'));
    });

    it.each([
      [{ field: 'createdAt', direction: 'desc' }, [{ createdAt: 'desc' }, { id: 'asc' }]],
      [{ field: 'createdAt', direction: 'asc' }, [{ createdAt: 'asc' }, { id: 'asc' }]],
      [{ field: 'name', direction: 'asc' }, [{ name: 'asc' }, { id: 'asc' }]],
      [{ field: 'name', direction: 'desc' }, [{ name: 'desc' }, { id: 'asc' }]],
    ] as const)('orders by %j with a stable id tiebreaker', async (sort, expectedOrderBy) => {
      const findMany = vi.fn().mockResolvedValue([]);
      const db = { classroom: { findMany, count: vi.fn().mockResolvedValue(0) } };
      const listing = new AccessVerificationService(db as unknown as PrismaService);

      await listing.listAccessibleClassrooms(STUDENT_1_USER_ID, { skip: 0, take: 20, sort });

      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: expectedOrderBy }));
    });

    it('excludes a row for which no role resolves instead of defaulting to STUDENT', async () => {
      const db = {
        classroom: {
          findMany: vi.fn().mockResolvedValue([row({})]),
          count: vi.fn().mockResolvedValue(1),
        },
      };
      const listing = new AccessVerificationService(db as unknown as PrismaService);

      const result = await listing.listAccessibleClassrooms(STUDENT_1_USER_ID, {
        skip: 0,
        take: 20,
        sort: { field: 'createdAt', direction: 'asc' },
      });

      expect(result.items).toEqual([]);
    });

    it('returns an empty page without querying for a malformed actor id', async () => {
      const db = { classroom: { findMany: vi.fn(), count: vi.fn() } };
      const listing = new AccessVerificationService(db as unknown as PrismaService);

      const result = await listing.listAccessibleClassrooms('nope', {
        skip: 0,
        take: 5,
        sort: { field: 'createdAt', direction: 'asc' },
      });

      expect(result).toEqual({ total: 0, items: [] });
      expect(db.classroom.findMany).not.toHaveBeenCalled();
    });
  });
});
