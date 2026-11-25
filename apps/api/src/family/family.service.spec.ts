import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import type { ListReportCardQueryDto } from '../metrics/metrics.dto';
import { MetricsService } from '../metrics/metrics.service';
import type { PrismaService } from '../prisma/prisma.service';
import { FamilyController } from './family.controller';
import { FamilyService } from './family.service';

const parentId = '00000000-0000-4000-8000-000000000001';
const child1Id = '00000000-0000-4000-8000-000000000002';
const child2Id = '00000000-0000-4000-8000-000000000003';
const classroom1Id = '00000000-0000-4000-8000-000000000011';
const classroom2Id = '00000000-0000-4000-8000-000000000012';
const schoolId = '00000000-0000-4000-8000-000000000021';
const link1Id = '00000000-0000-4000-8000-000000000031';
const link2Id = '00000000-0000-4000-8000-000000000032';
const created1 = new Date('2026-11-20T10:00:00.000Z');
const created2 = new Date('2026-11-21T10:00:00.000Z');

describe('FamilyService (unit)', () => {
  let prisma: {
    parentLink: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
    classroomMembership: {
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let access: {
    isActiveStudent: ReturnType<typeof vi.fn>;
  };
  let metrics: {
    readStudentReportCard: ReturnType<typeof vi.fn>;
    readStudentActivitySummary: ReturnType<typeof vi.fn>;
  };
  let service: FamilyService;

  beforeEach(() => {
    prisma = {
      parentLink: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      classroomMembership: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    access = {
      isActiveStudent: vi.fn().mockResolvedValue(true),
    };
    metrics = {
      readStudentReportCard: vi.fn().mockResolvedValue({
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      }),
      readStudentActivitySummary: vi.fn().mockResolvedValue({
        connectedSeconds: 0,
        submissionCount: 0,
        messageCount: 0,
        gradedCount: 0,
        ungradedCount: 0,
        pendingCount: 0,
        averageScorePercent: null,
      }),
    };
    service = new FamilyService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
      metrics as unknown as MetricsService,
    );
  });

  describe('listMyParentLinks', () => {
    it('returns empty items when actor has invalid UUID or no active links', async () => {
      await expect(service.listMyParentLinks('not-a-uuid')).resolves.toEqual({ items: [] });
      expect(prisma.parentLink.findMany).not.toHaveBeenCalled();

      await expect(service.listMyParentLinks(parentId)).resolves.toEqual({ items: [] });
      expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
    });

    it('returns active links including adultMode: true and excludes removed students or deleted schools/classrooms', async () => {
      prisma.parentLink.findMany.mockResolvedValueOnce([
        {
          id: link1Id,
          classroomId: classroom1Id,
          childId: child1Id,
          createdAt: created1,
          classroom: {
            name: 'Math 101',
            subject: 'Algebra',
            schoolId,
            adultMode: false,
            deletedAt: null,
            school: { deletedAt: null },
          },
          child: { displayName: 'Ana' },
        },
        {
          id: link2Id,
          classroomId: classroom2Id,
          childId: child2Id,
          createdAt: created2,
          classroom: {
            name: 'Adult English',
            subject: null,
            schoolId: null,
            adultMode: true,
            deletedAt: null,
            school: null,
          },
          child: { displayName: 'Bruno' },
        },
        {
          id: '00000000-0000-4000-8000-000000000033',
          classroomId: classroom1Id,
          childId: child2Id,
          createdAt: created2,
          classroom: {
            name: 'Math 101',
            subject: 'Algebra',
            schoolId,
            adultMode: false,
            deletedAt: null,
            school: { deletedAt: null },
          },
          child: { displayName: 'Removed Child' },
        },
      ]);
      // Only (classroom1, child1) and (classroom2, child2) are still active students.
      prisma.classroomMembership.findMany.mockResolvedValueOnce([
        { classroomId: classroom1Id, userId: child1Id },
        { classroomId: classroom2Id, userId: child2Id },
      ]);

      const result = await service.listMyParentLinks(parentId);
      expect(result).toEqual({
        items: [
          {
            id: link1Id,
            classroomId: classroom1Id,
            classroomName: 'Math 101',
            classroomSubject: 'Algebra',
            schoolId,
            adultMode: false,
            childId: child1Id,
            childDisplayName: 'Ana',
            createdAt: created1.toISOString(),
          },
          {
            id: link2Id,
            classroomId: classroom2Id,
            classroomName: 'Adult English',
            classroomSubject: null,
            schoolId: null,
            adultMode: true,
            childId: child2Id,
            childDisplayName: 'Bruno',
            createdAt: created2.toISOString(),
          },
        ],
      });
    });
  });

  describe('getChildReportCard', () => {
    const query: ListReportCardQueryDto = { page: 1, pageSize: 20 };

    it('rejects malformed linkId with 404 without querying Prisma', async () => {
      await expect(service.getChildReportCard(parentId, 'not-a-uuid', query)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.parentLink.findFirst).not.toHaveBeenCalled();
    });

    it('rejects missing, foreign, inactive, or deleted-classroom links with 404', async () => {
      prisma.parentLink.findFirst.mockResolvedValueOnce(null);
      await expect(service.getChildReportCard(parentId, link1Id, query)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects link when child is no longer an active student in the classroom with 404', async () => {
      prisma.parentLink.findFirst.mockResolvedValueOnce({
        id: link1Id,
        classroomId: classroom1Id,
        childId: child1Id,
        createdAt: created1,
        classroom: {
          name: 'Math 101',
          subject: 'Algebra',
          schoolId,
          adultMode: false,
          deletedAt: null,
          school: { deletedAt: null },
        },
        child: { displayName: 'Ana' },
      });
      access.isActiveStudent.mockResolvedValueOnce(false);

      await expect(service.getChildReportCard(parentId, link1Id, query)).rejects.toThrow(
        NotFoundException,
      );
      expect(metrics.readStudentReportCard).not.toHaveBeenCalled();
    });

    it('returns 403 when classroom is in adult education mode', async () => {
      prisma.parentLink.findFirst.mockResolvedValueOnce({
        id: link2Id,
        classroomId: classroom2Id,
        childId: child2Id,
        createdAt: created2,
        classroom: {
          name: 'Adult English',
          subject: null,
          schoolId: null,
          adultMode: true,
          deletedAt: null,
          school: null,
        },
        child: { displayName: 'Bruno' },
      });
      access.isActiveStudent.mockResolvedValueOnce(true);

      await expect(service.getChildReportCard(parentId, link2Id, query)).rejects.toThrow(
        new ForbiddenException(
          'Parent viewing is disabled while the classroom is in adult education mode',
        ),
      );
      expect(metrics.readStudentReportCard).not.toHaveBeenCalled();
    });

    it('reuses MetricsService builders and returns link + paginated report card + metrics', async () => {
      prisma.parentLink.findFirst.mockResolvedValueOnce({
        id: link1Id,
        classroomId: classroom1Id,
        childId: child1Id,
        createdAt: created1,
        classroom: {
          name: 'Math 101',
          subject: 'Algebra',
          schoolId,
          adultMode: false,
          deletedAt: null,
          school: { deletedAt: null },
        },
        child: { displayName: 'Ana' },
      });
      access.isActiveStudent.mockResolvedValueOnce(true);
      const item = {
        activityId: '00000000-0000-4000-8000-000000000041',
        activityTitle: 'TP 1',
        activityType: 'TP' as const,
        maxScore: 100,
        score: 92,
        feedback: 'Great job',
        pointsAwarded: 92,
        isLate: false,
        submittedAt: created1.toISOString(),
        gradedAt: created2.toISOString(),
      };
      metrics.readStudentReportCard.mockResolvedValueOnce({
        items: [item],
        page: 1,
        pageSize: 20,
        total: 1,
      });
      metrics.readStudentActivitySummary.mockResolvedValueOnce({
        connectedSeconds: 1800,
        submissionCount: 2,
        messageCount: 5,
        gradedCount: 1,
        ungradedCount: 1,
        pendingCount: 1,
        averageScorePercent: 92,
      });

      const result = await service.getChildReportCard(parentId, link1Id, query);
      expect(metrics.readStudentReportCard).toHaveBeenCalledWith(classroom1Id, child1Id, query);
      expect(metrics.readStudentActivitySummary).toHaveBeenCalledWith(classroom1Id, child1Id);
      expect(result).toEqual({
        link: {
          id: link1Id,
          classroomId: classroom1Id,
          classroomName: 'Math 101',
          classroomSubject: 'Algebra',
          schoolId,
          adultMode: false,
          childId: child1Id,
          childDisplayName: 'Ana',
          createdAt: created1.toISOString(),
        },
        items: [item],
        page: 1,
        pageSize: 20,
        total: 1,
        metrics: {
          connectedSeconds: 1800,
          submissionCount: 2,
          messageCount: 5,
          gradedCount: 1,
          ungradedCount: 1,
          pendingCount: 1,
          averageScorePercent: 92,
        },
      });
    });
  });
});

describe('MetricsService.readStudentActivitySummary (unit)', () => {
  it('computes activity counts, connected time, and rounded averageScorePercent', async () => {
    const prismaStub = {
      activityMetric: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { connectedSeconds: 3600, submissionCount: 4, messageCount: 9 },
        }),
      },
      activity: {
        count: vi.fn().mockResolvedValue(5),
      },
      submission: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue([
          { grade: { score: 8, maxScore: 10 } }, // 80%
          { grade: { score: 2, maxScore: 3 } }, // 66.666...%
        ]),
      },
    };
    const metricsService = new MetricsService(
      prismaStub as unknown as PrismaService,
      {} as AccessVerificationService,
    );

    const summary = await metricsService.readStudentActivitySummary(classroom1Id, child1Id);
    expect(summary).toEqual({
      connectedSeconds: 3600,
      submissionCount: 4,
      messageCount: 9,
      gradedCount: 2,
      ungradedCount: 1,
      pendingCount: 2,
      averageScorePercent: 73.33,
    });
  });

  it('returns null averageScorePercent and zeroes when student has no activity yet', async () => {
    const prismaStub = {
      activityMetric: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { connectedSeconds: null, submissionCount: null, messageCount: null },
        }),
      },
      activity: {
        count: vi.fn().mockResolvedValue(2),
      },
      submission: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const metricsService = new MetricsService(
      prismaStub as unknown as PrismaService,
      {} as AccessVerificationService,
    );

    const summary = await metricsService.readStudentActivitySummary(classroom1Id, child1Id);
    expect(summary).toEqual({
      connectedSeconds: 0,
      submissionCount: 0,
      messageCount: 0,
      gradedCount: 0,
      ungradedCount: 0,
      pendingCount: 2,
      averageScorePercent: null,
    });
  });
});

describe('FamilyController (unit adapter delegation)', () => {
  it('delegates listMyParentLinks and getChildReportCard to FamilyService', async () => {
    const stub = {
      listMyParentLinks: vi.fn().mockResolvedValue({ items: [] }),
      getChildReportCard: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const controller = new FamilyController(stub as unknown as FamilyService);
    const query: ListReportCardQueryDto = { page: 2, pageSize: 10 };

    await controller.listMyParentLinks(parentId);
    expect(stub.listMyParentLinks).toHaveBeenCalledWith(parentId);

    await controller.getChildReportCard(parentId, link1Id, query);
    expect(stub.getChildReportCard).toHaveBeenCalledWith(parentId, link1Id, query);
  });
});
