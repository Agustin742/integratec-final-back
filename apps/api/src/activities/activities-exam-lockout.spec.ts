import { randomUUID } from 'node:crypto';
import { ActivityState, ActivityType, ClassroomRole, MembershipState } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import type { NotificationRecorder } from '../notifications/notification-recorder.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from './activities.service';

describe('ActivitiesService.hasExamInProgress', () => {
  const studentId = randomUUID();

  function createService(foundExam: { id: string } | null) {
    const findFirst = vi.fn(async () => foundExam);
    const prisma = {
      activity: { findFirst },
    } as unknown as PrismaService;
    const access = {} as AccessVerificationService;
    const notifications = {} as NotificationRecorder;
    return {
      service: new ActivitiesService(prisma, access, notifications),
      findFirst,
    };
  }

  it('returns true when an active published exam window is open for the student and passes the authoritative filter', async () => {
    const { service, findFirst } = createService({ id: randomUUID() });

    await expect(service.hasExamInProgress(studentId)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        type: ActivityType.EXAM,
        state: ActivityState.PUBLISHED,
        deletedAt: null,
        dueAt: { gte: expect.any(Date) },
        OR: [{ opensAt: { lte: expect.any(Date) } }, { opensAt: null }],
        classroom: {
          deletedAt: null,
          memberships: {
            some: {
              userId: studentId,
              role: ClassroomRole.STUDENT,
              state: MembershipState.ACTIVE,
              deletedAt: null,
            },
          },
        },
      },
      select: { id: true },
    });
  });

  it('returns false when no matching active exam is in progress', async () => {
    const { service } = createService(null);

    await expect(service.hasExamInProgress(studentId)).resolves.toBe(false);
  });
});
