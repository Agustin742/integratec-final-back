import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActivityFormat, ActivityType, Prisma } from '@prisma/client';
import {
  AccessVerificationService,
  type ClassroomAccessResult,
  UUID_PATTERN,
} from '../access/access-verification.service';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { conflict } from '../http/conflict';
import { toIsoString } from '../http/iso-string';
import { RequestValidationException } from '../http/validation';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import { parseSort } from '../http/pagination/sort';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../prisma/unique-violation';
import {
  calculateWeightedGradePoints,
  resolveActivityTypeWeight,
  SUBMISSION_GRADE_SOURCE_TYPE,
} from './grade-points';
import {
  type GradeResponseDto,
  type GradeSubmissionDto,
  GRADING_QUEUE_SORT_OPTIONS,
  type GradingQueueItemDto,
  type ListGradingQueueQueryDto,
  type RegradeSubmissionDto,
} from './grades.dto';

const MAX_LEDGER_REASON_LENGTH = 240;

type LockedActivityRow = {
  id: string;
  type: ActivityType | string;
  format: ActivityFormat | string;
  title: string;
  maxScore: number;
  weightMultiplier: Prisma.Decimal | number | string;
};

type LockedGradeRow = {
  id: string;
  submissionId: string;
  graderId: string;
  score: number;
  feedback: string;
  pointsAwarded: number;
  typeWeight: Prisma.Decimal | number | string;
  weightMultiplier: Prisma.Decimal | number | string;
  pointTransactionId: string | null;
  version: number;
  gradedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const QUEUE_SELECT = {
  id: true,
  activityId: true,
  studentId: true,
  submittedAt: true,
  isLate: true,
  activity: {
    select: {
      title: true,
      type: true,
    },
  },
  student: {
    select: {
      displayName: true,
    },
  },
  _count: {
    select: {
      files: true,
    },
  },
  grade: {
    select: {
      id: true,
      graderId: true,
      score: true,
      feedback: true,
      pointsAwarded: true,
      version: true,
      gradedAt: true,
    },
  },
} satisfies Prisma.SubmissionSelect;

type QueueRow = Prisma.SubmissionGetPayload<{ select: typeof QUEUE_SELECT }>;

function mapActivityType(raw: ActivityType | string): ActivityType {
  switch (raw) {
    case ActivityType.TP:
    case 'tp':
      return ActivityType.TP;
    case ActivityType.EXAM:
    case 'exam':
      return ActivityType.EXAM;
    default:
      throw new Error(`Unsupported activity type: ${String(raw)}`);
  }
}

function mapActivityFormat(raw: ActivityFormat | string): ActivityFormat {
  switch (raw) {
    case ActivityFormat.FILE:
    case 'file':
      return ActivityFormat.FILE;
    case ActivityFormat.MULTIPLE_CHOICE:
    case 'multiple_choice':
      return ActivityFormat.MULTIPLE_CHOICE;
    default:
      throw new Error(`Unsupported activity format: ${String(raw)}`);
  }
}

function assertScoreWithinMaxScore(score: number, maxScore: number): void {
  if (score > maxScore) {
    throw new RequestValidationException([
      { field: 'score', messages: [`score must not exceed the activity maxScore (${maxScore})`] },
    ]);
  }
}

function buildLedgerReason(prefix: string, activityTitle: string, score: number): string {
  const full = `${prefix}: ${activityTitle} (${score}/100)`;
  return full.length <= MAX_LEDGER_REASON_LENGTH
    ? full
    : full.slice(0, MAX_LEDGER_REASON_LENGTH).trimEnd();
}

function toGradeResponseDto(
  row: {
    id: string;
    submissionId: string;
    graderId: string;
    score: number;
    feedback: string;
    pointsAwarded: number;
    pointTransactionId: string | null;
    version: number;
    gradedAt: Date | string;
    createdAt: Date | string;
    updatedAt: Date | string;
  },
  activityId: string,
  studentId: string,
): GradeResponseDto {
  return {
    id: row.id,
    submissionId: row.submissionId,
    activityId,
    studentId,
    graderId: row.graderId,
    score: row.score,
    feedback: row.feedback,
    pointsAwarded: row.pointsAwarded,
    pointTransactionId: row.pointTransactionId,
    version: row.version,
    gradedAt: toIsoString(row.gradedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toQueueItemDto(row: QueueRow): GradingQueueItemDto {
  return {
    id: row.id,
    activityId: row.activityId,
    activityTitle: row.activity.title,
    activityType: row.activity.type,
    studentId: row.studentId,
    studentDisplayName: row.student.displayName,
    submittedAt: row.submittedAt.toISOString(),
    isLate: row.isLate,
    status: row.grade !== null ? 'graded' : 'submitted',
    fileCount: row._count.files,
    grade:
      row.grade === null
        ? null
        : {
            id: row.grade.id,
            graderId: row.grade.graderId,
            score: row.grade.score,
            feedback: row.grade.feedback,
            pointsAwarded: row.grade.pointsAwarded,
            version: row.grade.version,
            gradedAt: row.grade.gradedAt.toISOString(),
          },
  };
}

@Injectable()
export class GradesService {
  private readonly logger = new Logger(GradesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly pointsLedger: PointsLedgerService,
    private readonly notifications: NotificationRecorder,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /**
   * Grades an ungraded FILE submission once (`version = 1`), computes weighted points on the
   * server, appends an earning entry to the points ledger when `pointsAwarded > 0`, and records
   * a student-only `grade_posted` notification in the same transaction.
   */
  async gradeSubmission(
    actorId: string,
    submissionId: string,
    dto: GradeSubmissionDto,
  ): Promise<GradeResponseDto> {
    if (!UUID_PATTERN.test(submissionId)) {
      throw new NotFoundException('Submission not found');
    }

    const context = await this.loadSubmissionContext(submissionId);
    await this.assertStaffAccess(actorId, context.activity.classroomId, context.studentId);

    let result: GradeResponseDto;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const activity = await this.lockActiveActivity(
          tx,
          context.activityId,
          context.activity.classroomId,
        );
        const submission = await this.lockSubmission(tx, submissionId, activity.id);

        if (mapActivityFormat(activity.format) !== ActivityFormat.FILE) {
          throw conflict('activity', 'Only file submissions can be graded manually');
        }
        await this.assertStudentStillActive(tx, context.activity.classroomId, submission.studentId);

        const existingGrade = await tx.grade.findUnique({
          where: { submissionId: submission.id },
          select: { id: true },
        });
        if (existingGrade) {
          throw conflict('submission', 'Submission has already been graded');
        }
        assertScoreWithinMaxScore(dto.score, activity.maxScore);

        const typeWeight = resolveActivityTypeWeight(mapActivityType(activity.type), this.config);
        const pointsAwarded = calculateWeightedGradePoints(
          dto.score,
          typeWeight,
          activity.weightMultiplier,
        );

        const gradeId = randomUUID();
        let pointTransactionId: string | null = null;
        if (pointsAwarded > 0) {
          const creditResult = await this.pointsLedger.credit(
            {
              classroomId: context.activity.classroomId,
              studentId: submission.studentId,
              actorId,
              amount: pointsAwarded,
              sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
              sourceId: gradeId,
              reason: buildLedgerReason('Grade', activity.title, dto.score),
            },
            tx,
          );
          pointTransactionId = creditResult.entry.id;
        }

        const now = new Date();
        const created = await tx.grade.create({
          data: {
            id: gradeId,
            submissionId: submission.id,
            graderId: actorId,
            score: dto.score,
            feedback: dto.feedback,
            pointsAwarded,
            typeWeight: new Prisma.Decimal(typeWeight.toFixed(2)),
            weightMultiplier: new Prisma.Decimal(activity.weightMultiplier.toString()),
            pointTransactionId,
            version: 1,
            gradedAt: now,
          },
        });

        await tx.gradeRevision.create({
          data: {
            gradeId: created.id,
            graderId: actorId,
            version: 1,
            score: dto.score,
            feedback: dto.feedback,
            pointsDelta: pointsAwarded,
            pointTransactionId,
          },
        });

        await this.notifications.record(tx, {
          kind: 'grade_posted',
          classroomId: context.activity.classroomId,
          resourceId: created.id,
          recipientId: submission.studentId,
          studentId: submission.studentId,
        });

        return toGradeResponseDto(created, activity.id, submission.studentId);
      });
    } catch (error) {
      // Catch P2002 strictly outside $transaction so we never query an aborted Postgres tx (25P02).
      if (isUniqueViolation(error)) {
        throw conflict('submission', 'Submission has already been graded');
      }
      throw error;
    }

    this.logger.log({
      event: 'submission_graded',
      classroomId: context.activity.classroomId,
      submissionId,
      gradeId: result.id,
      graderId: actorId,
      score: result.score,
      pointsAwarded: result.pointsAwarded,
      version: result.version,
    });

    return result;
  }

  /**
   * Regrades an existing grade using optimistic concurrency (`dto.version`), appends a new
   * `GradeRevision`, compensates points atomically when the rounded weighted points change, and
   * records a student-only `grade_posted` notification.
   */
  async regradeSubmission(
    actorId: string,
    submissionId: string,
    dto: RegradeSubmissionDto,
  ): Promise<GradeResponseDto> {
    if (!UUID_PATTERN.test(submissionId)) {
      throw new NotFoundException('Submission not found');
    }

    const context = await this.loadSubmissionContext(submissionId);
    await this.assertStaffAccess(actorId, context.activity.classroomId, context.studentId);

    const { response, pointsDelta } = await this.prisma.$transaction(async (tx) => {
      const activity = await this.lockActiveActivity(
        tx,
        context.activityId,
        context.activity.classroomId,
      );
      const submission = await this.lockSubmission(tx, submissionId, activity.id);

      if (mapActivityFormat(activity.format) !== ActivityFormat.FILE) {
        throw conflict('activity', 'Only file submissions can be graded manually');
      }
      await this.assertStudentStillActive(tx, context.activity.classroomId, submission.studentId);

      const currentGrade = await this.lockGradeBySubmission(tx, submission.id);
      if (!currentGrade) {
        throw new NotFoundException('Grade not found');
      }
      if (currentGrade.version !== dto.version) {
        throw conflict(
          'version',
          'Grade has been modified by another request; reload the latest version and retry',
        );
      }

      // Only a changed score is checked: a feedback-only regrade survives a lowered maxScore.
      if (dto.score !== currentGrade.score) {
        assertScoreWithinMaxScore(dto.score, activity.maxScore);
      }

      // Regrades reuse the weights snapshotted at the initial grade, never current activity/config.
      const newPoints = calculateWeightedGradePoints(
        dto.score,
        currentGrade.typeWeight,
        currentGrade.weightMultiplier,
      );
      // `pointsAwarded` is the net credited and always >= the points of the stored score; the gap is
      // what a capped regrade previously waived. Waived points are never collected later:
      //  - target >= awarded: credit the positive difference;
      //  - prevPoints <= target < awarded (includes the same score): no ledger movement;
      //  - target < prevPoints: decrease by target - prevPoints, capped at the available balance.
      const prevPoints = calculateWeightedGradePoints(
        currentGrade.score,
        currentGrade.typeWeight,
        currentGrade.weightMultiplier,
      );
      let delta = 0;
      if (newPoints >= currentGrade.pointsAwarded) {
        delta = newPoints - currentGrade.pointsAwarded;
      } else if (newPoints < prevPoints) {
        delta = newPoints - prevPoints;
      }
      const nextVersion = currentGrade.version + 1;

      let nextGradePointTransactionId = currentGrade.pointTransactionId;
      let revisionPointTransactionId: string | null = null;
      // Ledger delta actually applied; a downward delta is capped at the available balance.
      let appliedDelta = delta;
      let pointsUnrecovered = 0;
      if (delta !== 0) {
        const reason = buildLedgerReason(`Regrade v${nextVersion}`, activity.title, dto.score);
        if (currentGrade.pointTransactionId === null && delta > 0) {
          const creditResult = await this.pointsLedger.credit(
            {
              classroomId: context.activity.classroomId,
              studentId: submission.studentId,
              actorId,
              amount: delta,
              sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
              sourceId: currentGrade.id,
              reason,
            },
            tx,
          );
          nextGradePointTransactionId = creditResult.entry.id;
          revisionPointTransactionId = creditResult.entry.id;
        } else if (delta > 0) {
          const compensateResult = await this.pointsLedger.compensate(
            {
              classroomId: context.activity.classroomId,
              studentId: submission.studentId,
              actorId,
              delta,
              sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
              sourceId: currentGrade.id,
              reason,
            },
            tx,
          );
          revisionPointTransactionId = compensateResult.entry.id;
        } else {
          // A regrade must always succeed: recover at most the balance still available.
          const capped = await this.pointsLedger.compensateCapped(
            {
              classroomId: context.activity.classroomId,
              studentId: submission.studentId,
              actorId,
              delta,
              sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
              sourceId: currentGrade.id,
              reason,
            },
            tx,
          );
          appliedDelta = capped.applied;
          pointsUnrecovered = capped.unrecovered;
          revisionPointTransactionId = capped.entry?.id ?? null;
        }
      }

      const now = new Date();
      const updated = await tx.grade.update({
        where: { id: currentGrade.id },
        data: {
          graderId: actorId,
          score: dto.score,
          feedback: dto.feedback,
          // Net actually credited, so later regrades compute their delta against it.
          pointsAwarded: currentGrade.pointsAwarded + appliedDelta,
          pointTransactionId: nextGradePointTransactionId,
          version: nextVersion,
          gradedAt: now,
        },
      });

      await tx.gradeRevision.create({
        data: {
          gradeId: currentGrade.id,
          graderId: actorId,
          version: nextVersion,
          score: dto.score,
          feedback: dto.feedback,
          pointsDelta: appliedDelta,
          pointsUnrecovered,
          pointTransactionId: revisionPointTransactionId,
        },
      });

      await this.notifications.record(tx, {
        kind: 'grade_posted',
        classroomId: context.activity.classroomId,
        resourceId: currentGrade.id,
        recipientId: submission.studentId,
        studentId: submission.studentId,
      });

      return {
        response: toGradeResponseDto(updated, activity.id, submission.studentId),
        pointsDelta: appliedDelta,
      };
    });

    this.logger.log({
      event: 'submission_regraded',
      classroomId: context.activity.classroomId,
      submissionId,
      gradeId: response.id,
      graderId: actorId,
      score: response.score,
      pointsAwarded: response.pointsAwarded,
      pointsDelta,
      version: response.version,
    });

    return response;
  }

  /**
   * Reads a grade by submission id without leaking foreign resource existence:
   * - Staff (`OWNER|ADMIN|TEACHER`) keep read access even after the student leaves the classroom.
   * - Active owning student and active linked parent outside adult mode may read it.
   * - Classmate student receives `403`.
   * - Ungraded, deleted activity, out-of-scope actor, unlinked parent, or adult-mode parent gets `404`.
   */
  async getGrade(actorId: string, submissionId: string): Promise<GradeResponseDto> {
    if (!UUID_PATTERN.test(submissionId)) {
      throw new NotFoundException('Grade not found');
    }

    const row = await this.prisma.submission.findFirst({
      where: { id: submissionId, activity: { deletedAt: null } },
      select: {
        id: true,
        activityId: true,
        studentId: true,
        activity: { select: { classroomId: true } },
        grade: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Grade not found');
    }

    let access: ClassroomAccessResult;
    try {
      access = await this.access.verifyClassroomAccess(actorId, row.activity.classroomId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Grade not found');
      }
      throw error;
    }

    if (access.myRole === 'STUDENT') {
      if (actorId !== row.studentId) {
        throw new ForbiddenException('Cannot access another student grade');
      }
    } else if (access.myRole === 'PARENT') {
      if (
        access.classroom.adultMode ||
        !access.linkedChildIds?.includes(row.studentId) ||
        !(await this.access.isActiveStudent(row.activity.classroomId, row.studentId))
      ) {
        throw new NotFoundException('Grade not found');
      }
    }

    if (!row.grade) {
      throw new NotFoundException('Grade not found');
    }

    return toGradeResponseDto(row.grade, row.activityId, row.studentId);
  }

  /**
   * Paginated grading queue for classroom staff (`OWNER|ADMIN|TEACHER`) with optional `activityId`,
   * derived `state` (`submitted | graded`), and `submittedAt` / `gradedAt` sorting inside a
   * `RepeatableRead` snapshot.
   */
  async listGradingQueue(
    actorId: string,
    classroomId: string,
    query: ListGradingQueueQueryDto,
  ): Promise<Paginated<GradingQueueItemDto>> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });
    const sort = parseSort(query.sort, GRADING_QUEUE_SORT_OPTIONS);

    const buildWhere = (activeStudentIds: string[]): Prisma.SubmissionWhereInput => ({
      activity: {
        classroomId,
        deletedAt: null,
      },
      // Students who left the classroom can no longer be graded, so they are not queued.
      studentId: { in: activeStudentIds },
      ...(query.activityId !== undefined ? { activityId: query.activityId } : {}),
      ...(query.state === 'submitted'
        ? { grade: { is: null } }
        : query.state === 'graded'
          ? { grade: { isNot: null } }
          : {}),
    });

    const orderBy: Prisma.SubmissionOrderByWithRelationInput[] =
      sort.field === 'gradedAt'
        ? [{ grade: { gradedAt: sort.direction } }, { id: 'asc' }]
        : [{ submittedAt: sort.direction }, { id: 'asc' }];

    const { total, rows } = await this.prisma.$transaction(
      async (tx) => {
        if (query.activityId !== undefined) {
          const activity = await tx.activity.findFirst({
            where: { id: query.activityId, classroomId, deletedAt: null },
            select: { id: true },
          });
          if (!activity) {
            throw new NotFoundException('Activity not found');
          }
        }
        const activeStudentIds = await this.access.listActiveStudentIds(classroomId, {
          client: tx,
        });
        const where = buildWhere(activeStudentIds);
        const total = await tx.submission.count({ where });
        const rows = await tx.submission.findMany({
          where,
          orderBy,
          ...toSkipTake(query),
          select: QUEUE_SELECT,
        });
        return { total, rows };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return paginated(rows.map(toQueueItemDto), total, query);
  }

  /**
   * Grading and regrading require a student who is still enrolled. Checked inside the grading
   * transaction through the access module (non-locking read, so the lock order is unchanged); the
   * points ledger still locks the membership row when points move.
   */
  private async assertStudentStillActive(
    tx: Prisma.TransactionClient,
    classroomId: string,
    studentId: string,
  ): Promise<void> {
    if (!(await this.access.isActiveStudent(classroomId, studentId, { client: tx }))) {
      throw conflict('submission', 'Student is no longer active in this classroom');
    }
  }

  private async loadSubmissionContext(submissionId: string) {
    const row = await this.prisma.submission.findFirst({
      where: { id: submissionId, activity: { deletedAt: null } },
      select: {
        id: true,
        activityId: true,
        studentId: true,
        activity: { select: { classroomId: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Submission not found');
    }
    return row;
  }

  private async assertStaffAccess(
    actorId: string,
    classroomId: string,
    targetStudentId: string,
  ): Promise<ClassroomAccessResult> {
    let access: ClassroomAccessResult;
    try {
      access = await this.access.verifyClassroomAccess(actorId, classroomId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Submission not found');
      }
      throw error;
    }
    if (access.myRole === 'OWNER' || access.myRole === 'ADMIN' || access.myRole === 'TEACHER') {
      return access;
    }
    if (
      access.myRole === 'PARENT' &&
      (!access.linkedChildIds?.includes(targetStudentId) ||
        !(await this.access.isActiveStudent(classroomId, targetStudentId)))
    ) {
      throw new NotFoundException('Submission not found');
    }
    throw new ForbiddenException('Teacher authority required to grade submissions');
  }

  private async lockActiveActivity(
    tx: Prisma.TransactionClient,
    activityId: string,
    classroomId: string,
  ): Promise<LockedActivityRow> {
    const rows = await tx.$queryRaw<LockedActivityRow[]>`
      SELECT
        a."id",
        a."type"::text AS "type",
        a."format"::text AS "format",
        a."title",
        a."max_score" AS "maxScore",
        a."weight_multiplier" AS "weightMultiplier"
      FROM "activities" a
      INNER JOIN "classrooms" c ON c."id" = a."classroom_id"
      LEFT JOIN "schools" s ON s."id" = c."school_id"
      WHERE a."id" = ${activityId}::uuid
        AND a."classroom_id" = ${classroomId}::uuid
        AND a."deleted_at" IS NULL
        AND c."deleted_at" IS NULL
        AND (c."school_id" IS NULL OR s."deleted_at" IS NULL)
      FOR SHARE OF a
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Submission not found');
    }
    return row;
  }

  private async lockSubmission(
    tx: Prisma.TransactionClient,
    submissionId: string,
    activityId: string,
  ): Promise<{ id: string; studentId: string }> {
    const rows = await tx.$queryRaw<Array<{ id: string; studentId: string }>>`
      SELECT "id", "student_id" AS "studentId"
      FROM "submissions"
      WHERE "id" = ${submissionId}::uuid AND "activity_id" = ${activityId}::uuid
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new NotFoundException('Submission not found');
    }
    return row;
  }

  private async lockGradeBySubmission(
    tx: Prisma.TransactionClient,
    submissionId: string,
  ): Promise<LockedGradeRow | null> {
    const rows = await tx.$queryRaw<LockedGradeRow[]>`
      SELECT
        "id",
        "submission_id" AS "submissionId",
        "grader_id" AS "graderId",
        "score",
        "feedback",
        "points_awarded" AS "pointsAwarded",
        "type_weight" AS "typeWeight",
        "weight_multiplier" AS "weightMultiplier",
        "point_transaction_id" AS "pointTransactionId",
        "version",
        "graded_at" AS "gradedAt",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
      FROM "grades"
      WHERE "submission_id" = ${submissionId}::uuid
      FOR UPDATE
    `;
    return rows[0] ?? null;
  }
}
