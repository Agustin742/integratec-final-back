import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ClassroomAccessRole } from '../access/access-verification.service';
import { AccessVerificationService } from '../access/access-verification.service';
import { ActivitiesService } from '../activities/activities.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { DEFAULT_LOCAL_DAY_TIME_ZONE, toLocalDay } from '../gamification/local-day';
import { GradesService } from '../grades/grades.service';
import { MetricsService } from '../metrics/metrics.service';
import { isUniqueViolation } from '../prisma/unique-violation';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DailyReviewItemDto,
  DailyReviewResponseDto,
  DailyReviewSectionDto,
} from './daily-review.dto';
import {
  DAILY_REVIEW_INFERENCE_PORT,
  type DailyReviewInferencePort,
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
    @Inject(DAILY_REVIEW_INFERENCE_PORT)
    private readonly inference: DailyReviewInferencePort,
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

    try {
      await this.prisma.dailyReviewDelivery.create({
        data: { userId, localDay, contentKind: summary === null ? 'STRUCTURED' : 'GENERATED' },
      });
    } catch (error) {
      // Concurrent first connection won the unique insert for this local day.
      if (isUniqueViolation(error)) return NOT_DUE;
      throw error;
    }

    return {
      status: 'due',
      audience,
      contentKind,
      summary,
      sections,
      dailyQuestion: null,
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
