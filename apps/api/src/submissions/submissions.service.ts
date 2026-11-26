import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActivityFormat,
  ActivityState,
  ActivityType,
  Prisma,
  StreakQualifyingSource,
} from '@prisma/client';
import {
  AccessVerificationService,
  type ClassroomAccessRole,
  UUID_PATTERN,
} from '../access/access-verification.service';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import {
  AUTO_GRADED_MC_FEEDBACK,
  buildLedgerReason,
  calculateWeightedGradePoints,
  resolveActivityTypeWeight,
  SUBMISSION_GRADE_SOURCE_TYPE,
} from '../grades/grade-points';
import { conflict } from '../http/conflict';
import { RequestValidationException } from '../http/validation';
import { isExamPassed, StreakService } from '../gamification/streak.service';
import {
  NotificationRecorder,
  recordGradePostedNotifications,
} from '../notifications/notification-recorder.service';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../prisma/unique-violation';
import { MetricRecordingService } from '../metrics/metric-recording.service';
import { evaluateMcAnswers, parseMcAnswers, type McEvaluation } from './mc-evaluator';
import { SUBMISSION_ON_TIME_EVENT, type SubmissionOnTimePayload } from './submission-events';
import { submissionWindow, type SubmissionWindowRules } from './submission-window';
import {
  type AcceptedSubmissionFile,
  type SubmissionFileInput,
  buildSubmissionStorageKey,
  toErrorDetails,
  validateSubmissionFiles,
} from './submission-file-policy';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  type SubmissionDownloadResponseDto,
  type SubmissionResponseDto,
} from './submissions.dto';

const SUBMISSION_SELECT = {
  id: true,
  activityId: true,
  submittedAt: true,
  isLate: true,
  idempotencyKey: true,
  grade: { select: { id: true } },
  files: {
    orderBy: { position: 'asc' },
    select: { id: true, originalName: true, contentType: true, sizeBytes: true, position: true },
  },
  autoScore: true,
  answers: {
    orderBy: { position: 'asc' },
    select: { questionId: true, optionId: true, position: true },
  },
} satisfies Prisma.SubmissionSelect;

const READ_SELECT = {
  id: true,
  activityId: true,
  studentId: true,
  submittedAt: true,
  isLate: true,
  grade: { select: { id: true } },
  files: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      storageKey: true,
      originalName: true,
      contentType: true,
      sizeBytes: true,
      position: true,
    },
  },
  autoScore: true,
  answers: {
    orderBy: { position: 'asc' },
    select: { questionId: true, optionId: true, position: true },
  },
} satisfies Prisma.SubmissionSelect;

type ReadRow = Prisma.SubmissionGetPayload<{ select: typeof READ_SELECT }>;

type SubmissionRow = Prisma.SubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;

/** What the controller needs: the body and whether this call created it (201) or replayed it (200). */
export interface SubmitResult {
  submission: SubmissionResponseDto;
  created: boolean;
}

interface PlannedFile extends AcceptedSubmissionFile {
  id: string;
  storageKey: string;
  position: number;
}

type TransactionOutcome = { created: boolean; row: SubmissionRow };

function toResponse(row: SubmissionRow): SubmissionResponseDto {
  return {
    id: row.id,
    activityId: row.activityId,
    submittedAt: row.submittedAt.toISOString(),
    isLate: row.isLate,
    autoScore: row.autoScore,
    status: row.grade !== null ? 'graded' : 'submitted',
    files: row.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      position: file.position,
    })),
    answers: row.answers.map((answer) => ({
      questionId: answer.questionId,
      optionId: answer.optionId,
      position: answer.position,
    })),
  };
}

/**
 * Whether the activity takes a submission at `now` and whether it would be late (data-and-time
 * D10: the server decides on UTC instants). Rejections are 409 with a student-readable reason.
 * The payload shape (files versus answers) is checked by the caller against the format; the
 * window itself is format-agnostic so the submit endpoint and the student inbox agree.
 */
function assertAcceptsSubmission(activity: SubmissionWindowRules, now: Date): { isLate: boolean } {
  const window = submissionWindow(activity, now);
  if (window.open) {
    return { isLate: window.isLate };
  }
  switch (window.reason) {
    case 'not_open':
      throw conflict('activity', 'This activity is not open yet');
    case 'closed':
      throw conflict(
        'activity',
        'The deadline has passed and this activity does not accept late submissions',
      );
  }
}

function parseIdempotencyKey(raw: string | undefined): string {
  if (raw === undefined || raw.length < 1 || raw.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new RequestValidationException([
      {
        field: IDEMPOTENCY_KEY_HEADER,
        messages: [
          `${IDEMPOTENCY_KEY_HEADER} header is required and must be 1-${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
        ],
      },
    ]);
  }
  return raw;
}

@Injectable()
export class SubmissionsService {
  private readonly logger = new Logger(SubmissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly outbox: OutboxWriter,
    private readonly streaks: StreakService,
    private readonly metrics: MetricRecordingService,
    private readonly pointsLedger: PointsLedgerService,
    private readonly notifications: NotificationRecorder,
  ) {}

  /**
   * Stores a student's submission for a published activity, exactly once per (activity, student):
   * files for a FILE activity, or multiple-choice answers graded on the server for a
   * MULTIPLE_CHOICE activity (the score is computed inside the transaction and stored with the
   * row; correct answers never leave the server).
   *
   * Order: access (404/403) -> header (400) -> existing submission (replay 200 or 409) -> payload
   * and format (409/400) -> window (409) -> file content (400) -> upload -> ONE short transaction.
   * The transaction share-locks the activity row (blocking teacher edits, not other students),
   * then re-checks everything against committed state, validates the answers against the
   * committed questions, scores them, and stamps `submittedAt` from the server clock. Uploads happen outside any
   * transaction; cleanup requires evidence that the objects cannot belong to a committed submission.
   */
  async submit(
    actorId: string,
    activityId: string,
    rawIdempotencyKey: string | undefined,
    uploads: readonly SubmissionFileInput[],
    answersRaw: string | undefined,
  ): Promise<SubmitResult> {
    const activity = await this.loadSubmittableActivity(actorId, activityId);
    const key = parseIdempotencyKey(rawIdempotencyKey);

    // Cheap short-circuit before touching storage or scoring: a retry must not re-upload or
    // re-score anything.
    const prior = await this.findExisting(activity.id, actorId);
    if (prior) return this.resolveExisting(prior, key);

    // The payload must match the activity's format. Both rejections are 409 so a wrong-format
    // attempt never distinguishes "wrong shape" from "wrong activity".
    if (activity.format === ActivityFormat.MULTIPLE_CHOICE) {
      if (uploads.length > 0) {
        throw conflict('activity', 'This activity does not accept file submissions');
      }
    } else if (answersRaw !== undefined) {
      throw conflict('activity', 'This activity does not accept multiple-choice answers');
    }
    const mcAnswers =
      activity.format === ActivityFormat.MULTIPLE_CHOICE ? parseMcAnswers(answersRaw) : null;

    assertAcceptsSubmission(activity, new Date());

    // Files only exist on a FILE submission: a MULTIPLE_CHOICE submission carries answers.
    let planned: PlannedFile[] = [];
    if (activity.format === ActivityFormat.FILE) {
      const validation = await validateSubmissionFiles(uploads);
      if (!validation.ok) {
        throw new RequestValidationException(toErrorDetails(validation.violations));
      }
      planned = this.plan(activity.classroomId, activity.id, actorId, validation.files);
    }

    try {
      await this.uploadAll(planned);
    } catch (error) {
      // No transaction has started: none of these objects can be linked by this invocation.
      await this.discard(planned);
      throw error;
    }

    let outcome: TransactionOutcome;
    let callbackRejected = false;
    try {
      outcome = await this.persist(activity, actorId, key, planned, mcAnswers, () => {
        callbackRejected = true;
      });
    } catch (error) {
      let winner: SubmissionRow | null;
      try {
        winner = await this.findExisting(activity.id, actorId);
      } catch {
        // Preserve both the objects and the original error if reconciliation is unavailable.
        throw error;
      }
      if (winner) {
        const plannedIds = new Set(planned.map((file) => file.id));
        const ownsAllFiles =
          winner.files.length === planned.length &&
          winner.files.every((file) => plannedIds.has(file.id));
        if (ownsAllFiles && winner.idempotencyKey === key) {
          // COMMIT succeeded, but its response was lost. The event committed with this row.
          return { submission: toResponse(winner), created: true };
        }
        // A different winner rules out our commit via (activity, student) uniqueness. Never
        // discard even a partially overlapping set: linked objects must always survive.
        if (winner.files.some((file) => plannedIds.has(file.id))) throw error;
        await this.discard(planned);
        return this.resolveExisting(winner, key);
      }
      // An empty nonlocking read alone is NOT proof of rollback: COMMIT may still be in flight.
      // A rejected callback never requests COMMIT; P2002 definitively aborts the transaction.
      if (callbackRejected || isUniqueViolation(error)) await this.discard(planned);
      throw error;
    }

    if (!outcome.created) {
      // Lost the race after uploading: the winner owns its own objects, ours are orphans.
      await this.discard(planned);
      return this.resolveExisting(outcome.row, key);
    }
    return { submission: toResponse(outcome.row), created: true };
  }

  /**
   * The calling student's own submission to an activity, with fresh signed download URLs. The
   * activity resolves exactly as for submitting (404 hidden, 403 non-student member); a student
   * who has not submitted yet gets 404 `Submission not found`.
   */
  async readOwn(actorId: string, activityId: string): Promise<SubmissionDownloadResponseDto> {
    const activity = await this.loadSubmittableActivity(actorId, activityId);
    const row = await this.prisma.submission.findUnique({
      where: { activityId_studentId: { activityId: activity.id, studentId: actorId } },
      select: READ_SELECT,
    });
    if (!row) throw this.submissionNotFound();
    return this.withDownloadUrls(row);
  }

  /**
   * A submission by id for its own student or for teacher-level staff of the activity's
   * classroom (teacher, school Owner or Admin: the `TEACHER` level of `verifyClassroomAccess`).
   * Everyone else gets the same 404 as for an id that does not exist: another student, a linked
   * parent (parents see the grade of the child, never the files, per activities-and-grading),
   * a non-member, a malformed id, or a submission whose activity was deleted.
   */
  async readById(actorId: string, submissionId: string): Promise<SubmissionDownloadResponseDto> {
    if (!UUID_PATTERN.test(submissionId)) throw this.submissionNotFound();
    const row = await this.prisma.submission.findFirst({
      where: { id: submissionId, activity: { deletedAt: null } },
      select: { ...READ_SELECT, activity: { select: { classroomId: true } } },
    });
    if (!row) throw this.submissionNotFound();
    const { activity, ...submission } = row;

    let role: ClassroomAccessRole;
    try {
      ({ myRole: role } = await this.access.verifyClassroomAccess(actorId, activity.classroomId));
    } catch (error) {
      if (error instanceof NotFoundException) throw this.submissionNotFound();
      throw error;
    }
    const isStaff = role === 'OWNER' || role === 'ADMIN' || role === 'TEACHER';
    const isOwner = role === 'STUDENT' && submission.studentId === actorId;
    if (!isStaff && !isOwner) throw this.submissionNotFound();
    return this.withDownloadUrls(submission);
  }

  /**
   * Signs every file with the configured lifetime. The expiry is computed from the instant taken
   * before signing, so it never overstates how long a URL lives.
   */
  private async withDownloadUrls(row: ReadRow): Promise<SubmissionDownloadResponseDto> {
    const ttlSeconds = this.config.storageSignedUrlTtlSeconds;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const files = await Promise.all(
      row.files.map(async (file) => ({
        id: file.id,
        originalName: file.originalName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        position: file.position,
        downloadUrl: await this.storage.getSignedDownloadUrl(file.storageKey, {
          expiresInSeconds: ttlSeconds,
        }),
        downloadUrlExpiresAt: expiresAt,
      })),
    );
    return {
      id: row.id,
      activityId: row.activityId,
      submittedAt: row.submittedAt.toISOString(),
      isLate: row.isLate,
      autoScore: row.autoScore,
      status: row.grade !== null ? 'graded' : 'submitted',
      files,
      answers: row.answers.map((answer) => ({
        questionId: answer.questionId,
        optionId: answer.optionId,
        position: answer.position,
      })),
    };
  }

  /**
   * Resolves the activity for the caller without leaking existence: unknown, malformed, deleted
   * and draft activities, and non-members of its classroom, are all the same 404. A member who
   * is not a student (staff, linked parent) gets the 403 of the permission matrix.
   */
  private async loadSubmittableActivity(actorId: string, activityId: string) {
    if (!UUID_PATTERN.test(activityId)) throw this.notFound();
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: {
        id: true,
        classroomId: true,
        state: true,
        format: true,
        opensAt: true,
        dueAt: true,
        allowLate: true,
      },
    });
    if (!activity) throw this.notFound();
    // Students never see drafts: check the state before classroom access so a linked
    // parent on a DRAFT activity gets the same 404 as an unknown id (no existence leak).
    if (activity.state !== ActivityState.PUBLISHED) throw this.notFound();
    try {
      await this.access.verifyClassroomAccess(actorId, activity.classroomId, {
        requiredRole: 'STUDENT',
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw this.notFound();
      throw error;
    }
    return activity;
  }

  private findExisting(activityId: string, studentId: string): Promise<SubmissionRow | null> {
    return this.prisma.submission.findUnique({
      where: { activityId_studentId: { activityId, studentId } },
      select: SUBMISSION_SELECT,
    });
  }

  /** Same key: the earlier request's result again. Different key: the student already submitted. */
  private resolveExisting(existing: SubmissionRow, key: string): SubmitResult {
    if (existing.idempotencyKey !== key) {
      throw conflict('activity', 'You already submitted to this activity');
    }
    return { submission: toResponse(existing), created: false };
  }

  private plan(
    classroomId: string,
    activityId: string,
    studentId: string,
    files: AcceptedSubmissionFile[],
  ): PlannedFile[] {
    return files.map((file, position) => {
      const id = randomUUID();
      return {
        ...file,
        id,
        position,
        storageKey: buildSubmissionStorageKey({ classroomId, activityId, studentId, fileId: id }),
      };
    });
  }

  /** Uploads in parallel but waits for every put to settle, so cleanup knows what may exist. */
  private async uploadAll(planned: PlannedFile[]): Promise<void> {
    const results = await Promise.allSettled(
      planned.map((file) =>
        this.storage.put(file.storageKey, file.bytes, { contentType: file.contentType }),
      ),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /** Best effort: a failed delete is logged and never replaces the error being handled. */
  private async discard(planned: PlannedFile[]): Promise<void> {
    const results = await Promise.allSettled(
      planned.map((file) => this.storage.delete(file.storageKey)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Could not delete orphaned submission object ${planned[index].storageKey}`,
        );
      }
    });
  }

  private persist(
    activity: { id: string; classroomId: string },
    studentId: string,
    key: string,
    planned: PlannedFile[],
    mcAnswers: ReturnType<typeof parseMcAnswers> | null,
    onCallbackRejected: () => void,
  ): Promise<TransactionOutcome> {
    const { id: activityId, classroomId } = activity;
    return this.prisma.$transaction(async (tx) => {
      try {
        // Shared row lock first. Submitting never changes the activity, so students must not queue
        // behind each other (a deadline rush would outlast the transaction timeout), but the lock
        // still conflicts with the FOR UPDATE that update/publish/deactivate take: a teacher change
        // waits for in-flight submits and a submit queued behind one reads the committed result.
        // One submission per student stays guaranteed by the unique index (P2002 handled by the caller).
        const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM activities
        WHERE id = ${activityId}::uuid AND classroom_id = ${classroomId}::uuid
          AND deleted_at IS NULL
        FOR SHARE`;
        if (locked.length === 0) throw this.notFound();
        const current = await tx.activity.findFirst({
          where: { id: activityId, classroomId, deletedAt: null },
          select: {
            state: true,
            type: true,
            format: true,
            title: true,
            opensAt: true,
            dueAt: true,
            allowLate: true,
            maxScore: true,
            weightMultiplier: true,
            createdById: true,
          },
        });
        if (!current || current.state !== ActivityState.PUBLISHED) throw this.notFound();
        if (!(await this.access.isActiveStudent(classroomId, studentId, { client: tx }))) {
          throw this.notFound();
        }

        // A winner that committed while this request was uploading or queued: replay, not insert.
        const existing = await tx.submission.findUnique({
          where: { activityId_studentId: { activityId, studentId } },
          select: SUBMISSION_SELECT,
        });
        if (existing) return { created: false, row: existing };

        // Server clock, read once after the lock: it decides lateness and stamps the row.
        const now = new Date();
        const { isLate } = assertAcceptsSubmission(current, now);
        // Multiple-choice answers are validated and scored against the committed questions of
        // this very activity, inside the same transaction as the row they belong to. The score
        // is computed once, here; an idempotent replay never reaches this point, so it never
        // re-scores.
        const evaluation: McEvaluation | null =
          current.format === ActivityFormat.MULTIPLE_CHOICE && mcAnswers
            ? await evaluateMcAnswers(tx, activityId, mcAnswers, current.maxScore)
            : null;
        const row = await tx.submission.create({
          data: {
            activityId,
            studentId,
            submittedAt: now,
            isLate,
            ...(evaluation ? { autoScore: evaluation.autoScore } : {}),
            idempotencyKey: key,
            files: {
              create: planned.map((file) => ({
                id: file.id,
                storageKey: file.storageKey,
                originalName: file.originalName,
                contentType: file.contentType,
                sizeBytes: file.sizeBytes,
                position: file.position,
              })),
            },
            ...(evaluation ? { answers: { create: evaluation.rows } } : {}),
          },
          select: SUBMISSION_SELECT,
        });
        // Same transaction as the row: the metric exists if and only if the submission commits.
        await this.metrics.recordSubmission(tx, { classroomId, userId: studentId, at: now });
        let autoGradeId: string | null = null;
        if (evaluation) {
          // Auto-graded multiple-choice submissions receive an authoritative Grade, GradeRevision,
          // weighted points credit, grade_posted notification, and EXAM_PASSED streak in the exact
          // same transaction as the submission (rules/activities-and-grading.md D11 & D18).
          const typeWeight = resolveActivityTypeWeight(current.type, this.config);
          const pointsAwarded = calculateWeightedGradePoints(
            evaluation.autoScore,
            typeWeight,
            current.weightMultiplier,
          );
          const gradeId = randomUUID();
          let pointTransactionId: string | null = null;
          if (pointsAwarded > 0) {
            const creditResult = await this.pointsLedger.credit(
              {
                classroomId,
                studentId,
                actorId: current.createdById,
                amount: pointsAwarded,
                sourceType: SUBMISSION_GRADE_SOURCE_TYPE,
                sourceId: gradeId,
                reason: buildLedgerReason(
                  'Grade',
                  current.title,
                  evaluation.autoScore,
                  current.maxScore,
                ),
              },
              tx,
            );
            pointTransactionId = creditResult.entry.id;
          }

          await tx.grade.create({
            data: {
              id: gradeId,
              submissionId: row.id,
              graderId: current.createdById,
              score: evaluation.autoScore,
              feedback: AUTO_GRADED_MC_FEEDBACK,
              activityTitle: current.title,
              maxScore: current.maxScore,
              pointsAwarded,
              typeWeight: new Prisma.Decimal(typeWeight.toFixed(2)),
              weightMultiplier: new Prisma.Decimal(current.weightMultiplier.toString()),
              pointTransactionId,
              version: 1,
              gradedAt: now,
            },
          });

          await tx.gradeRevision.create({
            data: {
              gradeId,
              graderId: current.createdById,
              version: 1,
              score: evaluation.autoScore,
              feedback: AUTO_GRADED_MC_FEEDBACK,
              pointsDelta: pointsAwarded,
              pointTransactionId,
            },
          });

          await recordGradePostedNotifications(tx, this.notifications, {
            classroomId,
            gradeId,
            studentId,
          });

          if (
            current.type === ActivityType.EXAM &&
            isExamPassed(evaluation.autoScore, current.maxScore)
          ) {
            await this.streaks.recordQualifying(tx, {
              studentId,
              source: StreakQualifyingSource.EXAM_PASSED,
              at: row.submittedAt,
            });
          }

          autoGradeId = gradeId;
        }
        if (!isLate) {
          // Same transaction as the row: the event exists if and only if the submission commits.
          const payload: SubmissionOnTimePayload = {
            version: 1,
            submissionId: row.id,
            activityId,
            classroomId,
            studentId,
            submittedAt: row.submittedAt.toISOString(),
          };
          await this.outbox.record(tx, { type: SUBMISSION_ON_TIME_EVENT, payload });
          // The on-time submission is the day's qualifying activity (RN-08): the
          // streak day is unique per (student, local day), so repeated or
          // concurrent same-day submissions count once.
          await this.streaks.recordQualifying(tx, {
            studentId,
            source: StreakQualifyingSource.ON_TIME_SUBMISSION,
            at: row.submittedAt,
          });
        }
        return {
          created: true,
          row: autoGradeId ? { ...row, grade: { id: autoGradeId } } : row,
        };
      } catch (error) {
        // Only callback rejection establishes that this invocation will not request COMMIT.
        // Do not mark an outer $transaction rejection: it can happen after a successful COMMIT.
        onCallbackRejected();
        throw error;
      }
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Activity not found');
  }

  private submissionNotFound(): NotFoundException {
    return new NotFoundException('Submission not found');
  }
}
