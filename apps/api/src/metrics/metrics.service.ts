import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AccessVerificationService } from '../access/access-verification.service';
import { toIsoString } from '../http/iso-string';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import { PrismaService } from '../prisma/prisma.service';
import {
  type DailyMetricDto,
  type ListClassroomMetricsQueryDto,
  type ListDailyMetricsQueryDto,
  type ListReportCardQueryDto,
  type ReportCardItemDto,
  type StudentMetricSummaryDto,
} from './metrics.dto';

/** The UTC calendar date of a `@db.Date` column, as a `YYYY-MM-DD` string. */
function toIsoDate(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/**
 * Read side of HU-ACT-005: the student's report card, the student's own daily metrics, and the
 * teacher's classroom summary. Every value is raw (gap 17 keeps the composite formula open);
 * access goes through the shared authorization service (rules/data.md).
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  /**
   * The authenticated student's graded activities of one classroom: score, feedback and net
   * credited points per activity, latest grading first. Ungraded submissions are not listed.
   */
  async reportCard(
    actorId: string,
    classroomId: string,
    query: ListReportCardQueryDto,
  ): Promise<Paginated<ReportCardItemDto>> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'STUDENT' });

    const where = {
      studentId: actorId,
      grade: { isNot: null },
      // Published only, like every other student-facing classroom query: an unpublished
      // activity leaves the card (no unpublish exists yet; revisit with it).
      activity: { classroomId, deletedAt: null, state: 'PUBLISHED' },
    } satisfies Prisma.SubmissionWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.submission.findMany({
        where,
        orderBy: [{ grade: { gradedAt: 'desc' } }, { id: 'asc' }],
        ...toSkipTake(query),
        select: {
          activityId: true,
          submittedAt: true,
          isLate: true,
          activity: { select: { type: true } },
          grade: {
            select: {
              score: true,
              feedback: true,
              pointsAwarded: true,
              gradedAt: true,
              activityTitle: true,
              maxScore: true,
            },
          },
        },
      }),
      this.prisma.submission.count({ where }),
    ]);

    return paginated(
      rows.map((row) => ({
        activityId: row.activityId,
        // Frozen at grading time on the grade: later activity edits never rewrite the card.
        activityTitle: row.grade!.activityTitle,
        activityType: row.activity.type,
        maxScore: row.grade!.maxScore,
        score: row.grade!.score,
        feedback: row.grade!.feedback,
        pointsAwarded: row.grade!.pointsAwarded,
        isLate: row.isLate,
        submittedAt: toIsoString(row.submittedAt),
        gradedAt: toIsoString(row.grade!.gradedAt),
      })),
      total,
      query,
    );
  }

  /** The authenticated student's own daily metric rows, latest day first. */
  async myDailyMetrics(
    actorId: string,
    classroomId: string,
    query: ListDailyMetricsQueryDto,
  ): Promise<Paginated<DailyMetricDto>> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'STUDENT' });

    const where = { classroomId, userId: actorId } satisfies Prisma.ActivityMetricWhereInput;
    const [rows, total] = await Promise.all([
      this.prisma.activityMetric.findMany({
        where,
        orderBy: [{ day: 'desc' }],
        ...toSkipTake(query),
      }),
      this.prisma.activityMetric.count({ where }),
    ]);

    return paginated(
      rows.map((row) => ({
        day: toIsoDate(row.day),
        connectedSeconds: row.connectedSeconds,
        submissionCount: row.submissionCount,
        messageCount: row.messageCount,
      })),
      total,
      query,
    );
  }

  /**
   * Staff summary of raw per-student totals for every active enrolled student, display name
   * ascending. Students who left keep their history in the daily rows but no longer appear here.
   *
   * Known limit: the page is sliced in memory over all active student ids of the classroom, so
   * it is O(classroom size) per request, not O(page). Fine for course-sized classrooms; revisit
   * with database-side pagination if real classrooms grow past that.
   */
  async classroomMetrics(
    actorId: string,
    classroomId: string,
    query: ListClassroomMetricsQueryDto,
  ): Promise<Paginated<StudentMetricSummaryDto>> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });

    const studentIds = await this.access.listActiveStudentIds(classroomId);
    const students = await this.prisma.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, displayName: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
    });

    const { skip, take } = toSkipTake(query);
    const page = students.slice(skip, skip + take);
    if (page.length === 0) return paginated([], students.length, query);
    const pageIds = page.map((student) => student.id);

    const [sums, submissionCounts, gradedCounts] = await Promise.all([
      this.prisma.activityMetric.groupBy({
        by: ['userId'],
        where: { classroomId, userId: { in: pageIds } },
        _sum: { connectedSeconds: true, submissionCount: true, messageCount: true },
      }),
      this.prisma.submission.groupBy({
        by: ['studentId'],
        where: { activity: { classroomId, deletedAt: null }, studentId: { in: pageIds } },
        _count: { _all: true },
      }),
      this.prisma.submission.groupBy({
        by: ['studentId'],
        where: {
          activity: { classroomId, deletedAt: null },
          studentId: { in: pageIds },
          grade: { isNot: null },
        },
        _count: { _all: true },
      }),
    ]);

    const sumByUser = new Map(sums.map((row) => [row.userId, row]));
    const submissionsByUser = new Map(
      submissionCounts.map((row) => [row.studentId, row._count._all]),
    );
    const gradedByUser = new Map(gradedCounts.map((row) => [row.studentId, row._count._all]));

    return paginated(
      page.map((student) => {
        const sum = sumByUser.get(student.id);
        const submitted = submissionsByUser.get(student.id) ?? 0;
        const graded = gradedByUser.get(student.id) ?? 0;
        return {
          studentId: student.id,
          displayName: student.displayName,
          connectedSeconds: sum?._sum.connectedSeconds ?? 0,
          submissionCount: sum?._sum.submissionCount ?? 0,
          messageCount: sum?._sum.messageCount ?? 0,
          gradedCount: graded,
          ungradedCount: submitted - graded,
        };
      }),
      students.length,
      query,
    );
  }
}
