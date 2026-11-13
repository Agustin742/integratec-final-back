import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActivityFormat, ActivityState, Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { RequestConflictException } from '../http/conflict';
import { RequestValidationException } from '../http/validation';
import { STORAGE_PORT, type StoragePort } from '../platform/storage/storage.port';
import { PrismaService } from '../prisma/prisma.service';
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
  type SubmissionResponseDto,
} from './submissions.dto';

const SUBMISSION_SELECT = {
  id: true,
  activityId: true,
  submittedAt: true,
  isLate: true,
  idempotencyKey: true,
  files: {
    orderBy: { position: 'asc' },
    select: { id: true, originalName: true, contentType: true, sizeBytes: true, position: true },
  },
} satisfies Prisma.SubmissionSelect;

type SubmissionRow = Prisma.SubmissionGetPayload<{ select: typeof SUBMISSION_SELECT }>;

/** What the controller needs: the body and whether this call created it (201) or replayed it (200). */
export interface SubmitResult {
  submission: SubmissionResponseDto;
  created: boolean;
}

interface ActivityRules {
  format: ActivityFormat;
  opensAt: Date | null;
  dueAt: Date;
  allowLate: boolean;
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
    status: 'submitted',
    files: row.files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      position: file.position,
    })),
  };
}

function conflict(field: string, message: string): RequestConflictException {
  return new RequestConflictException([{ field, messages: [message] }]);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Whether the activity takes a submission at `now` and whether it would be late (data-and-time
 * D10: the server decides on UTC instants). Rejections are 409 with a student-readable reason.
 */
function assertAcceptsSubmission(activity: ActivityRules, now: Date): { isLate: boolean } {
  if (activity.format !== ActivityFormat.FILE) {
    throw conflict('activity', 'This activity does not accept file submissions');
  }
  if (activity.opensAt !== null && now.getTime() < activity.opensAt.getTime()) {
    throw conflict('activity', 'This activity is not open yet');
  }
  if (now.getTime() > activity.dueAt.getTime()) {
    if (!activity.allowLate) {
      throw conflict(
        'activity',
        'The deadline has passed and this activity does not accept late submissions',
      );
    }
    return { isLate: true };
  }
  return { isLate: false };
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
  ) {}

  /**
   * Stores a student's files for a published FILE activity, exactly once per (activity, student).
   *
   * Order: access (404/403) -> header (400) -> existing submission (replay 200 or 409) -> window
   * and format (409) -> file content (400) -> upload -> ONE short transaction. The transaction
   * locks the activity row, so concurrent submits queue, then re-checks everything against
   * committed state and stamps `submittedAt` from the server clock. Uploads happen outside any
   * transaction; whatever was uploaded is deleted again on every path that stores no submission.
   */
  async submit(
    actorId: string,
    activityId: string,
    rawIdempotencyKey: string | undefined,
    uploads: readonly SubmissionFileInput[],
  ): Promise<SubmitResult> {
    const activity = await this.loadSubmittableActivity(actorId, activityId);
    const key = parseIdempotencyKey(rawIdempotencyKey);

    // Cheap short-circuit before touching storage: a retry must not re-upload anything.
    const prior = await this.findExisting(activity.id, actorId);
    if (prior) return this.resolveExisting(prior, key);

    assertAcceptsSubmission(activity, new Date());

    const validation = await validateSubmissionFiles(uploads);
    if (!validation.ok) {
      throw new RequestValidationException(toErrorDetails(validation.violations));
    }
    const planned = this.plan(activity.classroomId, activity.id, actorId, validation.files);

    let outcome: TransactionOutcome;
    try {
      await this.uploadAll(planned);
      outcome = await this.persist(activity, actorId, key, planned);
    } catch (error) {
      await this.discard(planned);
      if (isUniqueViolation(error)) {
        // A racing request stored its submission first (the unique index is the last guard).
        const winner = await this.findExisting(activity.id, actorId);
        if (winner) return this.resolveExisting(winner, key);
      }
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
    try {
      await this.access.verifyClassroomAccess(actorId, activity.classroomId, {
        requiredRole: 'STUDENT',
      });
    } catch (error) {
      if (error instanceof NotFoundException) throw this.notFound();
      throw error;
    }
    // Students never see drafts.
    if (activity.state !== ActivityState.PUBLISHED) throw this.notFound();
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
  ): Promise<TransactionOutcome> {
    const { id: activityId, classroomId } = activity;
    return this.prisma.$transaction(async (tx) => {
      // Row lock first (same pattern as publish/update): concurrent submits for this activity
      // queue here, and everything below reads state committed before this transaction owns it.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM activities
        WHERE id = ${activityId}::uuid AND classroom_id = ${classroomId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE`;
      if (locked.length === 0) throw this.notFound();
      const current = await tx.activity.findFirst({
        where: { id: activityId, classroomId, deletedAt: null },
        select: { state: true, format: true, opensAt: true, dueAt: true, allowLate: true },
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
      const row = await tx.submission.create({
        data: {
          activityId,
          studentId,
          submittedAt: now,
          isLate,
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
        },
        select: SUBMISSION_SELECT,
      });
      return { created: true, row };
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Activity not found');
  }
}
