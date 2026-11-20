import { Injectable } from '@nestjs/common';
import type { ClassroomAccessRole } from '../access/access-verification.service';
import { AccessVerificationService } from '../access/access-verification.service';
import { DEFAULT_LOCAL_DAY_TIME_ZONE, toLocalDay } from '../gamification/local-day';
import { isUniqueViolation } from '../prisma/unique-violation';
import { PrismaService } from '../prisma/prisma.service';
import { ActivitiesService } from '../activities/activities.service';
import type { DailyReviewResponseDto, DailyReviewSectionDto } from './daily-review.dto';

/** Upper bound on pages read while resolving the user's roles; one page is 50 classrooms. */
const ACCESS_PAGE_SIZE = 50;

const NOT_DUE: DailyReviewResponseDto = { status: 'not_due' };

export type DailyReviewAudience = 'STUDENT' | 'TEACHER';

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
 * The row is inserted only after the content is ready, so a failed composition
 * never consumes the day (recovery after a lost HTTP response remains the open
 * decision recorded in the card; the frontend re-consults `GET` on the next
 * connection and follows the `status` flag).
 */
@Injectable()
export class DailyReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly activities: ActivitiesService,
  ) {}

  async getDailyReview(userId: string): Promise<DailyReviewResponseDto> {
    const localDay = toLocalDay(new Date(), DEFAULT_LOCAL_DAY_TIME_ZONE);

    const alreadyDelivered = await this.prisma.dailyReviewDelivery.findUnique({
      where: { userId_localDay: { userId, localDay } },
      select: { id: true },
    });
    if (alreadyDelivered !== null) return NOT_DUE;

    const audience = await this.resolveAudience(userId);
    // Parents (and accounts with no classroom access) never receive the review.
    if (audience === null) return NOT_DUE;

    // Exam-day default (rules/ai-bot-and-daily-briefing.md): the block applies to
    // the daily review content and the delivery is not consumed.
    if (audience === 'STUDENT' && (await this.activities.hasExamInProgress(userId))) {
      return NOT_DUE;
    }

    const sections = await this.composeSections(userId, audience);

    // The provider slice (generated summary, issue #119 `contentKind: generated`)
    // plugs in here; without it the review is the structured fallback, which
    // rules/ai-bot-and-daily-briefing.md already defines as fully delivered.
    const contentKind = 'structured' as const;

    try {
      await this.prisma.dailyReviewDelivery.create({
        data: { userId, localDay, contentKind: 'STRUCTURED' },
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
      summary: null,
      sections,
      dailyQuestion: null,
    };
  }

  /**
   * Resolves the review audience from the shared access service so REST, the
   * bot and this review agree on roles everywhere. A student membership wins
   * over teacher-level authority (the review and question are student-shaped);
   * accounts with only parent links or no access get no review at all.
   */
  private async resolveAudience(userId: string): Promise<DailyReviewAudience | null> {
    const roles = new Set<ClassroomAccessRole>();
    for (let skip = 0; ; skip += ACCESS_PAGE_SIZE) {
      const { total, items } = await this.access.listAccessibleClassrooms(userId, {
        skip,
        take: ACCESS_PAGE_SIZE,
        sort: { field: 'createdAt', direction: 'asc' },
      });
      for (const item of items) roles.add(item.myRole);
      if (skip + items.length >= total || items.length === 0) break;
    }
    if (roles.has('STUDENT')) return 'STUDENT';
    if (roles.has('TEACHER') || roles.has('OWNER') || roles.has('ADMIN')) return 'TEACHER';
    return null;
  }

  /**
   * Structured review rows built only from PostgreSQL data (the provider fallback
   * shape of RN-13). The composition slice (activities, grades, announcements,
   * teacher grading queue) fills this in; the delivery contract above is
   * independent of where the rows come from.
   */
  private async composeSections(
    _userId: string,
    _audience: DailyReviewAudience,
  ): Promise<DailyReviewSectionDto[]> {
    return [];
  }
}
