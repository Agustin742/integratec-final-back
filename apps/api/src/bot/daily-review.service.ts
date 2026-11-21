import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ClassroomAccessRole } from '../access/access-verification.service';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { ActivitiesService } from '../activities/activities.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { BotMaterialsService } from './bot-materials.service';
import { DEFAULT_DAILY_QUESTION_ATTEMPTS, type ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { DEFAULT_LOCAL_DAY_TIME_ZONE, toLocalDay } from '../gamification/local-day';
import { StreakService } from '../gamification/streak.service';
import { GradesService } from '../grades/grades.service';
import { conflict } from '../http/conflict';
import { MetricsService } from '../metrics/metrics.service';
import { isUniqueViolation } from '../prisma/unique-violation';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AnswerDailyQuestionDto,
  DailyQuestionAnswerResponseDto,
  DailyQuestionDto,
  DailyQuestionStreakDto,
  DailyReviewItemDto,
  DailyReviewResponseDto,
  DailyReviewSectionDto,
} from './daily-review.dto';
import {
  DAILY_REVIEW_INFERENCE_PORT,
  type DailyReviewInferencePort,
  type GeneratedDailyQuestion,
  normalizeGeneratedQuestion,
} from './daily-review-inference.port';

/** Upper bound on pages read while resolving the user's roles; one page is 50 classrooms. */
const ACCESS_PAGE_SIZE = 50;
/**
 * Upper bound on classrooms whose per-classroom data is composed into the review. The
 * audience is still resolved over every accessible classroom; only the (potentially
 * one-query-per-classroom) composition is bounded so a huge membership cannot turn the
 * review into a scan of the whole school.
 */
const MAX_REVIEW_CLASSROOMS = 25;
/** Rows read from any per-classroom list service for one section. */
const CLASSROOM_PAGE_SIZE = 5;
/** Grading-queue rows read per classroom: enough to cover a full class group once. */
const QUEUE_PAGE_SIZE = 25;
/** Rows kept per review section; one classroom can never flood the review. */
const SECTION_ITEM_CAP = 5;

const NOT_DUE: DailyReviewResponseDto = { status: 'not_due' };

/**
 * Question fields that may ever be serialized; `correctOption` and `attempts` are
 * deliberately absent so the answer key can never leak into a response (S9).
 */
const QUESTION_PUBLIC_SELECT = {
  id: true,
  prompt: true,
  options: true,
  materialTitle: true,
} satisfies Prisma.DailyReviewQuestionSelect;
type QuestionPublicRow = Prisma.DailyReviewQuestionGetPayload<{
  select: typeof QUESTION_PUBLIC_SELECT;
}>;

const toQuestionDto = (row: QuestionPublicRow): DailyQuestionDto => ({
  id: row.id,
  prompt: row.prompt,
  options: row.options as string[],
  materialTitle: row.materialTitle,
});

/** Canned feedback in the product language (user-facing strings, rules/quality-and-testing.md). */
const CORRECT_ANSWER_FEEDBACK = '¡Muy bien! Respuesta correcta y día de racha ganado. ¡Seguí así!';
const WRONG_ANSWER_FEEDBACK =
  'Todavía no es la correcta. Repasá el material de la clase y probá de nuevo.';
const EXAM_LOCKED_MESSAGE = 'The study guide bot is unavailable while an exam is in progress.';

export type DailyReviewAudience = 'STUDENT' | 'TEACHER';

/** One accessible classroom, as resolved once for both audience and composition. */
interface ReviewClassroom {
  id: string;
  name: string;
  myRole: ClassroomAccessRole;
}

/** A section row waiting to be ordered against its peers. */
interface SectionRow {
  item: DailyReviewItemDto;
  /** Newest/nearest-first ordering key, normalized to an ISO UTC string. */
  at: string;
}

/**
 * Delivery engine for the daily review (HU-BOT-003, RN-13/RN-14).
 *
 * The day is the calendar date in `America/Argentina/Buenos_Aires` computed on
 * the server (`rules/ai-bot-and-daily-briefing.md`); client clocks are never
 * authoritative. Delivery is decided atomically: the content is composed first,
 * then the `DailyReviewDelivery` row is inserted under its unique constraint,
 * and only the request whose insert succeeds returns `due`. A concurrent or
 * replayed first connection loses the insert and answers `not_due`.
 *
 * Composition goes only through the exported application services that REST
 * uses (`rules/architecture.md`: a module MUST NOT query another module's
 * tables), so the review can never show data the user could not already see.
 * The summary wording comes from the inference port; any failure there is the
 * structured fallback, which rules/ai-bot-and-daily-briefing.md already defines
 * as fully delivered (RN-13). Generated text is never persisted (decision L3):
 * the delivery row records only fact and origin (`contentKind`).
 */
@Injectable()
export class DailyReviewService {
  private readonly logger = new Logger(DailyReviewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly activities: ActivitiesService,
    private readonly metrics: MetricsService,
    private readonly announcements: AnnouncementsService,
    private readonly grades: GradesService,
    private readonly botMaterials: BotMaterialsService,
    private readonly streak: StreakService,
    @Inject(DAILY_REVIEW_INFERENCE_PORT)
    private readonly inference: DailyReviewInferencePort,
    @Inject(API_CONFIG) private readonly config: Pick<ApiConfig, 'dailyQuestionMaxAttempts'>,
  ) {}

  async getDailyReview(userId: string): Promise<DailyReviewResponseDto> {
    const localDay = toLocalDay(new Date(), DEFAULT_LOCAL_DAY_TIME_ZONE);

    const alreadyDelivered = await this.prisma.dailyReviewDelivery.findUnique({
      where: { userId_localDay: { userId, localDay } },
      select: { id: true },
    });
    if (alreadyDelivered !== null) return NOT_DUE;

    const resolved = await this.resolveAudience(userId);
    // Parents (and accounts with no classroom access) never receive the review.
    if (resolved === null) return NOT_DUE;
    const { audience, classrooms } = resolved;

    // Exam-day default (rules/ai-bot-and-daily-briefing.md): the block applies to
    // the daily review content and the delivery is not consumed.
    if (audience === 'STUDENT' && (await this.activities.hasExamInProgress(userId))) {
      return NOT_DUE;
    }

    const sections = await this.composeSections(userId, audience, classrooms);

    // The port contract fails closed (null on any provider failure, timeout, throttle
    // or invalid output), and even a throwing adapter must not block delivery: the
    // structured fallback is delivered and counts as delivered (RN-13, S6).
    let summary: string | null = null;
    try {
      summary = await this.inference.generateSummary({ userId, audience, sections });
    } catch {
      summary = null;
    }
    const contentKind = summary === null ? 'structured' : 'generated';

    // The daily question is student-only and independent of the summary: it is
    // built from enabled material, and its failure is a `null` question while the
    // review (generated or structured) is still delivered. Generation runs in
    // memory so an in-flight exam lockout or losing concurrent GET never persists
    // an orphan question row.
    const generatedQuestion =
      audience === 'STUDENT' ? await this.prepareDailyQuestion(userId, classrooms) : null;

    // In-flight exam lockout: if an exam opened while sections or inference were
    // running, abort before consuming the day's delivery or persisting a question.
    if (audience === 'STUDENT' && (await this.activities.hasExamInProgress(userId))) {
      return NOT_DUE;
    }

    try {
      await this.prisma.dailyReviewDelivery.create({
        data: { userId, localDay, contentKind: summary === null ? 'STRUCTURED' : 'GENERATED' },
      });
    } catch (error) {
      // Concurrent first connection won the unique insert for this local day.
      if (isUniqueViolation(error)) return NOT_DUE;
      throw error;
    }

    const dailyQuestion =
      generatedQuestion === null
        ? null
        : await this.persistDailyQuestion(userId, localDay, generatedQuestion);

    return {
      status: 'due',
      audience,
      contentKind,
      summary,
      sections,
      dailyQuestion,
    };
  }

  /**
   * Daily question generation (S3), computed in memory for a STUDENT before
   * delivery persistence. The prompt input is ONLY enabled material titles (plus
   * classroom names) the user may already see; no enabled material means no
   * question, even when the summary was generated. Generation failure returns
   * `null` and does not block the review.
   */
  private async prepareDailyQuestion(
    userId: string,
    classrooms: ReviewClassroom[],
  ): Promise<GeneratedDailyQuestion | null> {
    const studentClassroomIds = classrooms
      .filter((classroom) => classroom.myRole === 'STUDENT')
      .map((classroom) => classroom.id);
    const materials = await this.botMaterials.enabledMaterialTitles(studentClassroomIds);
    if (materials.length === 0) return null;

    // Same fail-closed contract as the summary path: a throwing adapter must
    // never block the review, and any invalid output is discarded before persisting.
    let generated: GeneratedDailyQuestion | null = null;
    try {
      generated = await this.inference.generateDailyQuestion({ userId, materials });
    } catch {
      generated = null;
    }
    return generated === null ? null : normalizeGeneratedQuestion(generated);
  }

  /**
   * Persists a validated daily question after the delivery row is claimed. The
   * answer key lives in the persisted row and never in a response DTO.
   */
  private async persistDailyQuestion(
    userId: string,
    localDay: string,
    valid: GeneratedDailyQuestion,
  ): Promise<DailyQuestionDto | null> {
    try {
      const row = await this.prisma.dailyReviewQuestion.create({
        data: {
          userId,
          localDay,
          prompt: valid.prompt,
          options: valid.options,
          correctOption: valid.correctOption,
          materialTitle: valid.materialTitle,
        },
        select: QUESTION_PUBLIC_SELECT,
      });
      return toQuestionDto(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrent first connection already stored today's question under the
      // (user, local day) unique: reuse its row so both requests agree.
      const existing = await this.prisma.dailyReviewQuestion.findUnique({
        where: { userId_localDay: { userId, localDay } },
        select: QUESTION_PUBLIC_SELECT,
      });
      return existing === null ? null : toQuestionDto(existing);
    }
  }

  /**
   * Validates an answer to the day's question (S7): a correct answer credits the
   * streak exactly once per local day, atomically with the answered state.
   * Every decision is server-side from persisted state; the answer key never
   * leaves this method.
   */
  async answerDailyQuestion(
    userId: string,
    dto: AnswerDailyQuestionDto,
  ): Promise<DailyQuestionAnswerResponseDto> {
    // A malformed id answers 404 exactly like a foreign one: both mean there is
    // no question for this user, and neither may leak which rows exist.
    if (!UUID_PATTERN.test(dto.questionId)) {
      throw new NotFoundException('Daily question not found');
    }
    const question = await this.prisma.dailyReviewQuestion.findFirst({
      where: { id: dto.questionId, userId },
      select: { id: true, localDay: true, attempts: true, answeredAt: true, correctOption: true },
    });
    if (question === null) throw new NotFoundException('Daily question not found');

    // Exam lockout: block answering while an exam is open in any of the student's
    // classrooms, before consuming an attempt from the daily budget.
    if (await this.activities.hasExamInProgress(userId)) {
      throw conflict('exam', EXAM_LOCKED_MESSAGE);
    }

    const localDay = toLocalDay(new Date(), DEFAULT_LOCAL_DAY_TIME_ZONE);
    if (question.localDay !== localDay) {
      // Day rollover: yesterday's question is no longer answerable.
      throw conflict('dailyQuestion', 'the daily question is no longer available');
    }
    if (question.answeredAt !== null) {
      // The contract's repeat-answer case: only after a correct, credited answer.
      throw conflict('dailyQuestion', 'the daily question was already answered today');
    }

    // One guarded UPDATE consumes the attempt atomically: the unanswered and
    // budget conditions run inside the statement, so concurrent wrong answers
    // each consume their own slot and can never make a later correct answer lose
    // the race, and a concurrent correct answer turns this into a plain 409.
    const maxAttempts = this.config.dailyQuestionMaxAttempts ?? DEFAULT_DAILY_QUESTION_ATTEMPTS;
    const consumed = await this.prisma.dailyReviewQuestion.updateMany({
      where: { id: question.id, answeredAt: null, attempts: { lt: maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (consumed.count === 0) {
      const fresh = await this.prisma.dailyReviewQuestion.findUnique({
        where: { id: question.id },
        select: { answeredAt: true },
      });
      if (fresh !== null && fresh.answeredAt !== null) {
        throw conflict('dailyQuestion', 'the daily question was already answered today');
      }
      throw new HttpException(
        'No more daily question attempts left today. Try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const answer = dto.answer.trim();
    if (answer !== question.correctOption) {
      // Wrong but still retryable: the streak is untouched, and the live summary
      // keeps the response contract single-shaped for the frontend.
      return {
        correct: false,
        feedback: WRONG_ANSWER_FEEDBACK,
        streak: await this.currentStreak(userId),
      };
    }

    // Correct: ONE transaction claims the day's answer and credits the streak, so
    // the qualifying day exists if and only if the answered state does. The losing
    // concurrent correct answer rolls back with a 409 and credits nothing.
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.dailyReviewQuestion.updateMany({
        where: { id: question.id, answeredAt: null },
        data: { answeredAt: new Date() },
      });
      if (claimed.count === 0) {
        throw conflict('dailyQuestion', 'the daily question was already answered today');
      }
      // Idempotent per (student, local day): a student who already qualified today
      // through a submission still gets `correct: true` and the live streak.
      await this.streak.recordQualifying(tx, {
        studentId: userId,
        source: 'DAILY_REVIEW_ANSWERED',
        at: new Date(),
      });
    });

    return {
      correct: true,
      feedback: CORRECT_ANSWER_FEEDBACK,
      streak: await this.currentStreak(userId),
    };
  }

  /** The live streak snapshot in the delivery contract's shape (issue #119). */
  private async currentStreak(userId: string): Promise<DailyQuestionStreakDto> {
    const { streak } = await this.streak.getStudentSummary(userId);
    return {
      currentStreak: streak.currentStreak,
      bestStreak: streak.bestStreak,
      lastQualifiedDate: streak.lastQualifyingDay,
    };
  }

  /**
   * Resolves the review audience and the accessible classrooms in the same paged walk of
   * the shared access service, so REST, the bot and this review agree on roles everywhere
   * and the classroom list is read once. A student membership wins over teacher-level
   * authority (the review and question are student-shaped); accounts with only parent
   * links or no access get no review at all.
   */
  private async resolveAudience(
    userId: string,
  ): Promise<{ audience: DailyReviewAudience; classrooms: ReviewClassroom[] } | null> {
    const roles = new Set<ClassroomAccessRole>();
    const classrooms: ReviewClassroom[] = [];
    for (let skip = 0; ; skip += ACCESS_PAGE_SIZE) {
      const { total, items } = await this.access.listAccessibleClassrooms(userId, {
        skip,
        take: ACCESS_PAGE_SIZE,
        sort: { field: 'createdAt', direction: 'asc' },
      });
      for (const item of items) {
        roles.add(item.myRole);
        classrooms.push({ id: item.classroom.id, name: item.classroom.name, myRole: item.myRole });
      }
      if (skip + items.length >= total || items.length === 0) break;
    }
    if (roles.has('STUDENT')) return { audience: 'STUDENT', classrooms };
    if (roles.has('TEACHER') || roles.has('OWNER') || roles.has('ADMIN')) {
      return { audience: 'TEACHER', classrooms };
    }
    return null;
  }

  /**
   * Structured review rows built only from PostgreSQL data through the other modules'
   * exported services. Empty sections are omitted; each section keeps at most
   * `SECTION_ITEM_CAP` rows so the review stays a briefing, not a listing.
   */
  private async composeSections(
    userId: string,
    audience: DailyReviewAudience,
    classrooms: ReviewClassroom[],
  ): Promise<DailyReviewSectionDto[]> {
    const bounded = classrooms.slice(0, MAX_REVIEW_CLASSROOMS);
    const pendingRows =
      audience === 'STUDENT'
        ? await this.collectStudentPending(userId, bounded)
        : await this.collectTeacherQueue(userId, bounded);
    const newsRows =
      audience === 'STUDENT'
        ? await this.collectStudentNews(userId, bounded)
        : await this.collectAnnouncements(userId, bounded);

    const sections: DailyReviewSectionDto[] = [];
    if (pendingRows.length > 0) {
      sections.push({ kind: 'pending', items: pendingRows.map((row) => row.item) });
    }
    if (newsRows.length > 0) {
      sections.push({ kind: 'news', items: newsRows.map((row) => row.item) });
    }
    return sections;
  }

  /**
   * Student pending rows: published, not-yet-submitted activities nearest by deadline
   * across the user's STUDENT classrooms, through the same `ActivitiesService.list`
   * student-status query REST uses.
   */
  private async collectStudentPending(
    userId: string,
    classrooms: ReviewClassroom[],
  ): Promise<SectionRow[]> {
    const rows: SectionRow[] = [];
    for (const classroom of classrooms) {
      if (classroom.myRole !== 'STUDENT') continue;
      const items = await this.collectFromClassroom(classroom, async () => {
        // ISO date strings order chronologically, so `dueAt` doubles as the sort key.
        const page = await this.activities.list(userId, classroom.id, {
          status: 'pending',
          sort: 'dueAt',
          page: 1,
          pageSize: CLASSROOM_PAGE_SIZE,
        });
        return page.items.map((activity) => ({
          at: activity.dueAt,
          item: {
            kind: 'pending_activity',
            title: activity.title,
            classroomName: classroom.name,
            dueAt: activity.dueAt,
            detail: null,
          } satisfies DailyReviewItemDto,
        }));
      });
      rows.push(...items);
    }
    return rows.sort((a, b) => a.at.localeCompare(b.at)).slice(0, SECTION_ITEM_CAP);
  }

  /**
   * Student news rows: recent grades and the latest announcements across the user's
   * STUDENT classrooms, merged newest-first. Grades come from the report-card service
   * (already ordered by grading time), announcements from the announcement listing.
   */
  private async collectStudentNews(
    userId: string,
    classrooms: ReviewClassroom[],
  ): Promise<SectionRow[]> {
    const rows: SectionRow[] = [];
    for (const classroom of classrooms) {
      if (classroom.myRole !== 'STUDENT') continue;
      const grades = await this.collectFromClassroom(classroom, async () => {
        const page = await this.metrics.reportCard(userId, classroom.id, {
          page: 1,
          pageSize: CLASSROOM_PAGE_SIZE,
        });
        return page.items.map((grade) => ({
          at: grade.gradedAt,
          item: {
            kind: 'recent_grade',
            title: grade.activityTitle,
            classroomName: classroom.name,
            dueAt: null,
            detail: `${grade.score}/${grade.maxScore}`,
          } satisfies DailyReviewItemDto,
        }));
      });
      const announcements = await this.collectAnnouncementRows(userId, classroom);
      rows.push(...grades, ...announcements);
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, SECTION_ITEM_CAP);
  }

  /**
   * Teacher pending rows: submissions awaiting a grade across their classrooms, through
   * the same grading-queue service REST uses, one row per activity (the queue lists each
   * submission; grouping keeps five distinct activities instead of five classmates).
   */
  private async collectTeacherQueue(
    userId: string,
    classrooms: ReviewClassroom[],
  ): Promise<SectionRow[]> {
    const byActivity = new Map<string, SectionRow>();
    for (const classroom of classrooms) {
      const submissions = await this.collectFromClassroom(classroom, async () => {
        const page = await this.grades.listGradingQueue(userId, classroom.id, {
          state: 'submitted',
          page: 1,
          pageSize: QUEUE_PAGE_SIZE,
        });
        return page.items;
      });
      for (const submission of submissions) {
        const key = `${submission.activityId}:${classroom.id}`;
        const existing = byActivity.get(key);
        // Oldest submission first: the longest-waiting activity surfaces first.
        if (existing !== undefined) continue;
        byActivity.set(key, {
          at: submission.submittedAt,
          item: {
            kind: 'teacher_review',
            title: submission.activityTitle,
            classroomName: classroom.name,
            dueAt: null,
            detail: null,
          } satisfies DailyReviewItemDto,
        });
      }
    }
    return [...byActivity.values()]
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(0, SECTION_ITEM_CAP);
  }

  /** Teacher news rows: latest announcements across their classrooms, newest first. */
  private async collectAnnouncements(
    userId: string,
    classrooms: ReviewClassroom[],
  ): Promise<SectionRow[]> {
    const rows: SectionRow[] = [];
    for (const classroom of classrooms) {
      rows.push(...(await this.collectAnnouncementRows(userId, classroom)));
    }
    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, SECTION_ITEM_CAP);
  }

  private async collectAnnouncementRows(
    userId: string,
    classroom: ReviewClassroom,
  ): Promise<SectionRow[]> {
    return this.collectFromClassroom(classroom, async () => {
      const page = await this.announcements.list(userId, classroom.id, {
        page: 1,
        pageSize: CLASSROOM_PAGE_SIZE,
      });
      return page.items.map((announcement) => ({
        at: announcement.createdAt,
        item: {
          kind: 'announcement',
          title: announcement.title,
          classroomName: classroom.name,
          dueAt: null,
          detail: null,
        } satisfies DailyReviewItemDto,
      }));
    });
  }

  /**
   * Runs one classroom's composition step. A per-classroom failure MUST NOT abort the
   * review (rules/ai-bot-and-daily-briefing.md: access loss and 403/404 from any
   * service are a skip, never a lost day): the classroom is skipped and composition
   * continues with the rest. Logged without content, classroom uuid only.
   */
  private async collectFromClassroom<T>(
    classroom: ReviewClassroom,
    step: () => Promise<T[]>,
  ): Promise<T[]> {
    try {
      return await step();
    } catch (error) {
      this.logger.warn({
        operation: 'dailyReview.compose',
        classroomId: classroom.id,
        outcome: 'skipped',
        errorName: error instanceof Error ? error.constructor.name : 'unknown',
      });
      return [];
    }
  }
}
