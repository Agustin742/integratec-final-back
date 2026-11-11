import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClassroomRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccessVerificationService,
  ClassroomAccessResult,
} from '../../access/access-verification.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_AVATAR } from '../../users/avatar.dto';
import { ClassroomDirectoryController } from './directory.controller';
import { ClassroomDirectoryService } from './directory.service';

const classroomId = '11111111-1111-4111-8111-111111111111';
const independentTeacherId = '22222222-2222-4222-8222-222222222222';
const studentId1 = '33333333-3333-4333-8333-333333333333';
const studentId2 = '44444444-4444-4444-8444-444444444444';
const parentId = '55555555-5555-4555-8555-555555555555';
const strangerId = '66666666-6666-4666-8666-666666666666';

describe('ClassroomDirectoryService & Controller (Issue #52 - HU-AUL-005, D12)', () => {
  let service: ClassroomDirectoryService;
  let controller: ClassroomDirectoryController;
  let access: { verifyClassroomAccess: ReturnType<typeof vi.fn> };
  let prisma: {
    classroomMembership: { findMany: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };

  const defaultAccessResult: ClassroomAccessResult = {
    classroom: {
      id: classroomId,
      schoolId: null,
      independentTeacherId,
      name: 'Math 101',
      adultMode: false,
    },
    myRole: 'STUDENT',
    capabilities: [
      'view_metrics',
      'participate_activities',
      'chat_classmates',
      'list_directory',
      'message_teacher',
    ],
  };

  beforeEach(() => {
    access = {
      verifyClassroomAccess: vi.fn().mockResolvedValue(defaultAccessResult),
    };
    prisma = {
      classroomMembership: {
        findMany: vi.fn().mockResolvedValue([
          {
            role: ClassroomRole.STUDENT,
            user: {
              id: studentId1,
              displayName: 'Alice Johnson',
              avatarConfig: {
                appearance: {
                  bodyId: 'female',
                  hairId: 'original',
                  topId: 'tshirt',
                  hairColor: '#353849',
                  clothingColor: '#75B7DA',
                },
              },
            },
          },
          {
            role: ClassroomRole.STUDENT,
            user: {
              id: studentId2,
              displayName: 'Bob Smith',
              avatarConfig: null,
            },
          },
        ]),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: independentTeacherId,
          displayName: 'Charles Xavier',
          avatarConfig: {
            appearance: {
              bodyId: 'male',
              hairId: 'afro',
              topId: 'hoodie',
              hairColor: '#6C4D48',
              clothingColor: '#5B4F96',
            },
          },
        }),
      },
    };

    service = new ClassroomDirectoryService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
    );
    controller = new ClassroomDirectoryController(service);
  });

  describe('Authorization & Role Matrix', () => {
    it('allows enrolled student with list_directory capability', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({
        ...defaultAccessResult,
        myRole: 'STUDENT',
        capabilities: ['list_directory', 'chat_classmates'],
      });

      const result = await controller.list(studentId1, classroomId, { page: 1, pageSize: 20 });
      expect(result).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);
      expect(access.verifyClassroomAccess).toHaveBeenCalledWith(studentId1, classroomId, {
        requiredRole: 'ANY',
      });
    });

    it('allows classroom teacher with list_directory capability', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({
        ...defaultAccessResult,
        myRole: 'TEACHER',
        capabilities: ['list_directory', 'moderate_chat'],
      });

      const result = await service.list(independentTeacherId, classroomId, {
        page: 1,
        pageSize: 20,
      });
      expect(result).toBeDefined();
      expect(result.total).toBe(3);
    });

    it('allows school OWNER and school ADMIN with list_directory capability', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({
        ...defaultAccessResult,
        classroom: {
          ...defaultAccessResult.classroom,
          schoolId: 'school-1',
          independentTeacherId: null,
        },
        myRole: 'OWNER',
        capabilities: ['list_directory', 'manage_school'],
      });

      const resultOwner = await service.list('owner-id', classroomId, { page: 1, pageSize: 20 });
      expect(resultOwner).toBeDefined();

      access.verifyClassroomAccess.mockResolvedValueOnce({
        ...defaultAccessResult,
        classroom: {
          ...defaultAccessResult.classroom,
          schoolId: 'school-1',
          independentTeacherId: null,
        },
        myRole: 'ADMIN',
        capabilities: ['list_directory', 'configure_classroom'],
      });

      const resultAdmin = await service.list('admin-id', classroomId, { page: 1, pageSize: 20 });
      expect(resultAdmin).toBeDefined();
    });

    it('forbids linked PARENT (missing list_directory capability) with 403 Forbidden', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({
        ...defaultAccessResult,
        myRole: 'PARENT',
        capabilities: ['view_metrics', 'message_teacher'], // no list_directory
      });

      await expect(service.list(parentId, classroomId, { page: 1, pageSize: 20 })).rejects.toThrow(
        new ForbiddenException(
          'Classroom member directory is only accessible to classroom members',
        ),
      );
    });

    it('throws 404 NotFound when access verification rejects stranger or removed student', async () => {
      access.verifyClassroomAccess.mockRejectedValueOnce(
        new NotFoundException('Classroom not found'),
      );

      await expect(
        service.list(strangerId, classroomId, { page: 1, pageSize: 20 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 404 NotFound for invalid classroom UUID format', async () => {
      access.verifyClassroomAccess.mockRejectedValueOnce(
        new NotFoundException('Classroom not found'),
      );

      await expect(
        service.list(studentId1, 'invalid-uuid', { page: 1, pageSize: 20 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Independent Teacher and School Classrooms', () => {
    it('includes independent teacher as role TEACHER when not in membership rows', async () => {
      const result = await service.list(studentId1, classroomId, { page: 1, pageSize: 20 });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: independentTeacherId },
        select: {
          id: true,
          displayName: true,
          avatarConfig: { select: { appearance: true } },
        },
      });

      const teacher = result.items.find((item) => item.userId === independentTeacherId);
      expect(teacher).toBeDefined();
      expect(teacher?.role).toBe('TEACHER');
      expect(teacher?.displayName).toBe('Charles Xavier');
      expect(teacher?.id).toBe(independentTeacherId);
      expect(teacher?.userId).toBe(independentTeacherId);
    });

    it('does not duplicate independent teacher if already present in membership rows', async () => {
      prisma.classroomMembership.findMany.mockResolvedValueOnce([
        {
          role: ClassroomRole.TEACHER,
          user: {
            id: independentTeacherId,
            displayName: 'Charles Xavier',
            avatarConfig: null,
          },
        },
        {
          role: ClassroomRole.STUDENT,
          user: {
            id: studentId1,
            displayName: 'Alice Johnson',
            avatarConfig: null,
          },
        },
      ]);

      const result = await service.list(studentId1, classroomId, { page: 1, pageSize: 20 });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      const teacherCount = result.items.filter(
        (item) => item.userId === independentTeacherId,
      ).length;
      expect(teacherCount).toBe(1);
    });

    it('does not query independent teacher when classroom.independentTeacherId is null', async () => {
      access.verifyClassroomAccess.mockResolvedValueOnce({
        ...defaultAccessResult,
        classroom: {
          ...defaultAccessResult.classroom,
          schoolId: 'school-1',
          independentTeacherId: null,
        },
      });

      const result = await service.list(studentId1, classroomId, { page: 1, pageSize: 20 });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(result.items.length).toBe(2);
    });
  });

  describe('Filtering with q (prefix search)', () => {
    it('filters members by case-insensitive display name prefix', async () => {
      const result = await service.list(studentId1, classroomId, {
        page: 1,
        pageSize: 20,
        q: 'al',
      });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].displayName).toBe('Alice Johnson');
    });

    it('filters independent teacher if matching q', async () => {
      const result = await service.list(studentId1, classroomId, {
        page: 1,
        pageSize: 20,
        q: 'char',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].displayName).toBe('Charles Xavier');
      expect(result.items[0].role).toBe('TEACHER');
    });

    it('matches literal characters and does not treat % or _ as SQL wildcards', async () => {
      prisma.classroomMembership.findMany.mockResolvedValueOnce([
        {
          role: ClassroomRole.STUDENT,
          user: { id: 'literal-1', displayName: 'Mi%_Literal', avatarConfig: null },
        },
        {
          role: ClassroomRole.STUDENT,
          user: { id: 'literal-2', displayName: 'Michael Decoy', avatarConfig: null },
        },
      ]);
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.list(studentId1, classroomId, {
        page: 1,
        pageSize: 20,
        q: 'Mi%',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].displayName).toBe('Mi%_Literal');
    });
  });

  describe('Ordering and Pagination', () => {
    it('orders by displayName asc, then id asc as tiebreaker', async () => {
      prisma.classroomMembership.findMany.mockResolvedValueOnce([
        {
          role: ClassroomRole.STUDENT,
          user: { id: 'uuid-b', displayName: 'Same Name', avatarConfig: null },
        },
        {
          role: ClassroomRole.STUDENT,
          user: { id: 'uuid-a', displayName: 'Same Name', avatarConfig: null },
        },
      ]);
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.list(studentId1, classroomId, { page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('uuid-a');
      expect(result.items[1].id).toBe('uuid-b');
    });

    it('correctly slices items for pagination with total metadata', async () => {
      const resultPage1 = await service.list(studentId1, classroomId, { page: 1, pageSize: 2 });
      expect(resultPage1.total).toBe(3);
      expect(resultPage1.page).toBe(1);
      expect(resultPage1.pageSize).toBe(2);
      expect(resultPage1.items).toHaveLength(2);
      expect(resultPage1.items[0].displayName).toBe('Alice Johnson');
      expect(resultPage1.items[1].displayName).toBe('Bob Smith');

      const resultPage2 = await service.list(studentId1, classroomId, { page: 2, pageSize: 2 });
      expect(resultPage2.total).toBe(3);
      expect(resultPage2.page).toBe(2);
      expect(resultPage2.pageSize).toBe(2);
      expect(resultPage2.items).toHaveLength(1);
      expect(resultPage2.items[0].displayName).toBe('Charles Xavier');
    });
  });

  describe('Avatar Normalization & Privacy', () => {
    it('returns custom avatar when appearance is valid', async () => {
      const result = await service.list(studentId1, classroomId, {
        page: 1,
        pageSize: 20,
        q: 'Alice',
      });
      expect(result.items[0].avatar).toEqual({
        bodyId: 'female',
        hairId: 'original',
        topId: 'tshirt',
        hairColor: '#353849',
        clothingColor: '#75B7DA',
      });
    });

    it('falls back to DEFAULT_AVATAR when appearance is null, invalid or corrupted', async () => {
      prisma.classroomMembership.findMany.mockResolvedValueOnce([
        {
          role: ClassroomRole.STUDENT,
          user: {
            id: 'corrupt-avatar-id',
            displayName: 'Corrupt User',
            avatarConfig: { appearance: { invalidKey: 'unsupported', bodyId: 'alien' } },
          },
        },
      ]);
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.list(studentId1, classroomId, { page: 1, pageSize: 20 });
      expect(result.items[0].avatar).toEqual(DEFAULT_AVATAR);
    });

    it('ensures strict privacy: never exposes email, passwordHash, parent links or grades', async () => {
      const result = await service.list(studentId1, classroomId, { page: 1, pageSize: 20 });
      for (const item of result.items) {
        const record = item as unknown as Record<string, unknown>;
        expect(record.email).toBeUndefined();
        expect(record.passwordHash).toBeUndefined();
        expect(record.password).toBeUndefined();
        expect(record.parentLinks).toBeUndefined();
        expect(record.guardians).toBeUndefined();
        expect(record.grades).toBeUndefined();
        expect(record.points).toBeUndefined();
        expect(Object.keys(item).sort()).toEqual(
          ['avatar', 'displayName', 'id', 'role', 'userId'].sort(),
        );
      }
    });
  });
});
