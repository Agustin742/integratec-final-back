import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityFormat, ActivityState, ActivityType, Prisma } from '@prisma/client';
import {
  AccessVerificationService,
  type ClassroomAccessResult,
  UUID_PATTERN,
} from '../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import { parseSort } from '../http/pagination/sort';
import { RequestValidationException } from '../http/validation';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACTIVITY_LIMITS,
  ACTIVITY_SORT_OPTIONS,
  type ActivitySummaryDto,
  type CreateActivityDto,
  type ListActivitiesQueryDto,
  type QuestionInputDto,
  type StudentActivityResponseDto,
  type TeacherActivityResponseDto,
  type UpdateActivityDto,
} from './activities.dto';

/** Independent-teacher classrooms have no school; they use the platform default (data-and-time). */
const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const SUMMARY_SELECT = {
  id: true,
  classroomId: true,
  type: true,
  format: true,
  state: true,
  title: true,
  description: true,
  opensAt: true,
  dueAt: true,
  allowLate: true,
  maxScore: true,
  weightMultiplier: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  // The school time zone is reached through the activity's own classroom relation, so this
  // module never queries the school table on its own.
  classroom: { select: { school: { select: { timeZone: true } } } },
  _count: { select: { questions: true } },
} satisfies Prisma.ActivitySelect;

/** Teacher view: includes the correct-answer marking. */
const TEACHER_SELECT = {
  ...SUMMARY_SELECT,
  createdById: true,
  questions: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      prompt: true,
      options: {
        orderBy: { position: 'asc' },
        select: { id: true, position: true, label: true, isCorrect: true },
      },
    },
  },
} satisfies Prisma.ActivitySelect;

/**
 * Student view: `isCorrect` is deliberately not selected (rules/data.md), so the value never
 * leaves the database for a student request and cannot be serialized by mistake.
 */
const STUDENT_SELECT = {
  ...SUMMARY_SELECT,
  questions: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      prompt: true,
      options: {
        orderBy: { position: 'asc' },
        select: { id: true, position: true, label: true },
      },
    },
  },
} satisfies Prisma.ActivitySelect;

type SummaryRow = Prisma.ActivityGetPayload<{ select: typeof SUMMARY_SELECT }>;
type TeacherRow = Prisma.ActivityGetPayload<{ select: typeof TEACHER_SELECT }>;
type StudentRow = Prisma.ActivityGetPayload<{ select: typeof STUDENT_SELECT }>;

function toSummary(row: SummaryRow): ActivitySummaryDto {
  return {
    id: row.id,
    classroomId: row.classroomId,
    type: row.type,
    format: row.format,
    state: row.state,
    title: row.title,
    description: row.description,
    opensAt: row.opensAt?.toISOString() ?? null,
    dueAt: row.dueAt.toISOString(),
    allowLate: row.allowLate,
    maxScore: row.maxScore,
    weightMultiplier: row.weightMultiplier.toNumber(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    timeZone: row.classroom.school?.timeZone ?? DEFAULT_TIME_ZONE,
    questionCount: row._count.questions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTeacherView(row: TeacherRow): TeacherActivityResponseDto {
  return {
    ...toSummary(row),
    createdById: row.createdById,
    questions: row.questions.map((q) => ({
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      options: q.options.map((o) => ({
        id: o.id,
        position: o.position,
        label: o.label,
        isCorrect: o.isCorrect,
      })),
    })),
  };
}

function toStudentView(row: StudentRow): StudentActivityResponseDto {
  return {
    ...toSummary(row),
    questions: row.questions.map((q) => ({
      id: q.id,
      position: q.position,
      prompt: q.prompt,
      options: q.options.map((o) => ({ id: o.id, position: o.position, label: o.label })),
    })),
  };
}

/** Positions follow array order, starting at 1. */
function toQuestionCreates(
  questions: QuestionInputDto[],
): Prisma.QuestionCreateWithoutActivityInput[] {
  return questions.map((question, qIndex) => ({
    position: qIndex + 1,
    prompt: question.prompt,
    options: {
      create: question.options.map((option, oIndex) => ({
        position: oIndex + 1,
        label: option.label,
        isCorrect: option.isCorrect,
      })),
    },
  }));
}

function isStaff(access: ClassroomAccessResult): boolean {
  return access.myRole === 'OWNER' || access.myRole === 'ADMIN' || access.myRole === 'TEACHER';
}

/** Cross-field rules shared by create and by update (checked against the merged state). */
function assertValidWindow(type: ActivityType, opensAt: Date | null, dueAt: Date): void {
  if (opensAt === null) return;
  if (type === ActivityType.TP) {
    throw new RequestValidationException([
      { field: 'opensAt', messages: ['opensAt is only allowed for EXAM activities'] },
    ]);
  }
  if (opensAt.getTime() >= dueAt.getTime()) {
    throw new RequestValidationException([
      { field: 'opensAt', messages: ['opensAt must be strictly before dueAt'] },
    ]);
  }
}

/**
 * Publishing re-checks, against the locked row, what input validation already enforced on
 * create/update, so a row that reached the database another way can never be published broken.
 */
function assertPublishable(
  existing: {
    format: ActivityFormat;
    dueAt: Date;
    questions: { options: { isCorrect: boolean }[] }[];
  },
  now: Date,
): void {
  // A deadline that already passed would publish an activity nobody can answer on time.
  if (existing.dueAt.getTime() <= now.getTime()) {
    throw new RequestValidationException([
      { field: 'dueAt', messages: ['dueAt must be in the future to publish the activity'] },
    ]);
  }
  if (existing.format !== ActivityFormat.MULTIPLE_CHOICE) return;
  const { questions: qLimits, options: oLimits } = ACTIVITY_LIMITS;
  const valid =
    existing.questions.length >= qLimits.min &&
    existing.questions.length <= qLimits.max &&
    existing.questions.every(
      (q) =>
        q.options.length >= oLimits.min &&
        q.options.length <= oLimits.max &&
        q.options.filter((o) => o.isCorrect).length === 1,
    );
  if (!valid) {
    throw new RequestValidationException([
      {
        field: 'questions',
        messages: [
          'a multiple-choice activity needs at least one question, each with 2-6 options and exactly one correct',
        ],
      },
    ]);
  }
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly notifications: NotificationRecorder,
  ) {}

  async create(
    actorId: string,
    classroomId: string,
    dto: CreateActivityDto,
  ): Promise<TeacherActivityResponseDto> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });
    const dueAt = new Date(dto.dueAt);
    const opensAt = dto.opensAt === undefined ? null : new Date(dto.opensAt);
    assertValidWindow(dto.type, opensAt, dueAt);

    // One nested write: PostgreSQL commits the activity, its questions and its options together.
    const row = await this.prisma.activity.create({
      data: {
        classroomId,
        createdById: actorId,
        type: dto.type,
        format: dto.format,
        title: dto.title,
        description: dto.description ?? '',
        opensAt,
        dueAt,
        allowLate: dto.allowLate ?? false,
        maxScore: dto.maxScore,
        weightMultiplier: dto.weightMultiplier ?? ACTIVITY_LIMITS.weight.default,
        ...(dto.questions ? { questions: { create: toQuestionCreates(dto.questions) } } : {}),
      },
      select: TEACHER_SELECT,
    });
    return toTeacherView(row);
  }

  async list(
    actorId: string,
    classroomId: string,
    query: ListActivitiesQueryDto,
  ): Promise<Paginated<ActivitySummaryDto>> {
    const access = await this.verifyReadAccess(actorId, classroomId);
    const sort = parseSort(query.sort, ACTIVITY_SORT_OPTIONS);
    const where: Prisma.ActivityWhereInput = {
      classroomId,
      deletedAt: null,
      // Students never see drafts, so their `state` filter is ignored rather than honored.
      ...(isStaff(access)
        ? query.state !== undefined
          ? { state: query.state }
          : {}
        : { state: ActivityState.PUBLISHED }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        ...toSkipTake(query),
        orderBy: [{ [sort.field]: sort.direction }, { id: 'asc' }],
        select: SUMMARY_SELECT,
      }),
      this.prisma.activity.count({ where }),
    ]);
    return paginated(rows.map(toSummary), total, query);
  }

  async get(
    actorId: string,
    classroomId: string,
    activityId: string,
  ): Promise<TeacherActivityResponseDto | StudentActivityResponseDto> {
    const access = await this.verifyReadAccess(actorId, classroomId);
    if (!UUID_PATTERN.test(activityId)) throw this.notFound();
    const scope = { id: activityId, classroomId, deletedAt: null };

    if (isStaff(access)) {
      const row = await this.prisma.activity.findFirst({ where: scope, select: TEACHER_SELECT });
      if (!row) throw this.notFound();
      return toTeacherView(row);
    }
    const row = await this.prisma.activity.findFirst({
      where: { ...scope, state: ActivityState.PUBLISHED },
      select: STUDENT_SELECT,
    });
    if (!row) throw this.notFound();
    return toStudentView(row);
  }

  async update(
    actorId: string,
    classroomId: string,
    activityId: string,
    dto: UpdateActivityDto,
  ): Promise<TeacherActivityResponseDto> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });
    if (!UUID_PATTERN.test(activityId)) throw this.notFound();

    const row = await this.prisma.$transaction(async (tx) => {
      // Row lock first: every check below reads the state this transaction will overwrite, so
      // no other PATCH or DELETE can change (or deactivate) the row between check and write.
      // Under READ COMMITTED a waiter re-evaluates the predicate once the holder commits, so a
      // row deactivated meanwhile no longer matches and is a 404. Tagged template: parameterized.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM activities
        WHERE id = ${activityId}::uuid AND classroom_id = ${classroomId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE`;
      if (locked.length === 0) throw this.notFound();
      const existing = await tx.activity.findFirst({
        where: { id: activityId, classroomId, deletedAt: null },
        select: { type: true, format: true, opensAt: true, dueAt: true },
      });
      if (!existing) throw this.notFound();

      if (dto.questions !== undefined && existing.format !== 'MULTIPLE_CHOICE') {
        throw new RequestValidationException([
          {
            field: 'questions',
            messages: ['questions are only allowed for MULTIPLE_CHOICE activities'],
          },
        ]);
      }
      const opensAt = dto.opensAt === undefined ? existing.opensAt : new Date(dto.opensAt);
      const dueAt = dto.dueAt === undefined ? existing.dueAt : new Date(dto.dueAt);
      assertValidWindow(existing.type, opensAt, dueAt);

      const data: Prisma.ActivityUpdateInput = {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.opensAt !== undefined ? { opensAt } : {}),
        ...(dto.dueAt !== undefined ? { dueAt } : {}),
        ...(dto.allowLate !== undefined ? { allowLate: dto.allowLate } : {}),
        ...(dto.maxScore !== undefined ? { maxScore: dto.maxScore } : {}),
        ...(dto.weightMultiplier !== undefined ? { weightMultiplier: dto.weightMultiplier } : {}),
      };
      if (dto.questions !== undefined) {
        // TODO(#30): once Submission exists, refuse replacing questions (409) when the activity
        // already has a submission ("freeze after the first answer"). Nothing to check yet.
        await tx.option.deleteMany({ where: { question: { activityId } } });
        await tx.question.deleteMany({ where: { activityId } });
        data.questions = { create: toQuestionCreates(dto.questions) };
      }
      // The lock is the guarantee; the scoped where is a second line of defence (extended unique
      // where, Prisma >= 5) so a write can never reach a row outside this classroom or a
      // deactivated one even if the lock were ever removed.
      return tx.activity.update({
        where: { id: activityId, classroomId, deletedAt: null },
        data,
        select: TEACHER_SELECT,
      });
    });
    return toTeacherView(row);
  }

  /**
   * Publishes a draft and records one `activity_published` notification request per active
   * student, all in ONE transaction: the outbox rows exist if and only if the publish commits
   * (docs/notifications.md), so nothing is announced for a publish that rolled back. The row lock
   * serializes concurrent publishes: the loser re-reads PUBLISHED and gets 409, so recipients
   * are notified exactly once.
   */
  async publish(
    actorId: string,
    classroomId: string,
    activityId: string,
  ): Promise<TeacherActivityResponseDto> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });
    if (!UUID_PATTERN.test(activityId)) throw this.notFound();

    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM activities
        WHERE id = ${activityId}::uuid AND classroom_id = ${classroomId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE`;
      if (locked.length === 0) throw this.notFound();
      const existing = await tx.activity.findFirst({
        where: { id: activityId, classroomId, deletedAt: null },
        select: {
          state: true,
          format: true,
          dueAt: true,
          questions: { select: { options: { select: { isCorrect: true } } } },
        },
      });
      if (!existing) throw this.notFound();
      if (existing.state === ActivityState.PUBLISHED) {
        throw new ConflictException('Activity is already published');
      }
      // Server clock, read once: the same instant validates the deadline and stamps the row.
      const now = new Date();
      assertPublishable(existing, now);

      const published = await tx.activity.update({
        where: { id: activityId, classroomId, deletedAt: null },
        data: { state: ActivityState.PUBLISHED, publishedAt: now },
        select: TEACHER_SELECT,
      });
      // Recipients come from the shared access service (it owns membership reads). The acting
      // user is excluded; staff are never STUDENT members, and adult mode only affects parents.
      const recipients = await this.access.listActiveStudentIds(classroomId, {
        excludeUserId: actorId,
        client: tx,
      });
      for (const recipientId of recipients) {
        await this.notifications.record(tx, {
          kind: 'activity_published',
          classroomId,
          resourceId: activityId,
          recipientId,
        });
      }
      return published;
    });
    return toTeacherView(row);
  }

  /** Logical deactivation (RN-18): the row and its questions stay; it only stops being visible. */
  async deactivate(actorId: string, classroomId: string, activityId: string): Promise<void> {
    await this.access.verifyClassroomAccess(actorId, classroomId, { requiredRole: 'TEACHER' });
    if (!UUID_PATTERN.test(activityId)) throw this.notFound();
    const { count } = await this.prisma.activity.updateMany({
      where: { id: activityId, classroomId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (count === 0) throw this.notFound();
  }

  /**
   * Staff and students read; parents are not in the activity row of the permission matrix
   * (classrooms-and-roles), so a visible-but-not-allowed parent gets 403.
   */
  private async verifyReadAccess(
    actorId: string,
    classroomId: string,
  ): Promise<ClassroomAccessResult> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'ANY',
    });
    if (access.myRole === 'PARENT') {
      throw new ForbiddenException('Parents cannot view activities');
    }
    return access;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Activity not found');
  }
}
