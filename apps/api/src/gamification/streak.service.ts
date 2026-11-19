import { Injectable } from '@nestjs/common';
import { StreakQualifyingSource } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BadgesService } from './badges.service';
import { DEFAULT_LOCAL_DAY_TIME_ZONE, localDayDistance, toLocalDay } from './local-day';

/**
 * A graded exam counts as "passed" at or above this share of the activity's
 * `maxScore`. The exact passing threshold is an open decision (gap 18 cluster);
 * this implementation default exists so the exam trigger is usable and is
 * disclosed in `docs/gamification.md` pending team approval.
 */
export const EXAM_PASSING_SCORE_RATIO = 0.6;

/** Server-side exam-passed predicate used by the grading trigger site. */
export function isExamPassed(score: number, maxScore: number): boolean {
  return score >= Math.ceil(maxScore * EXAM_PASSING_SCORE_RATIO);
}

export interface QualifyingEvent {
  studentId: string;
  source: StreakQualifyingSource;
  /** Server-owned instant of the qualifying action; decides the local day. */
  at: Date;
}

export interface StreakSummary {
  /** Chain that is still alive: last qualifying day is today or yesterday. */
  currentStreak: number;
  bestStreak: number;
  /** Local day (`YYYY-MM-DD`) of the last qualifying activity, if any. */
  lastQualifyingDay: string | null;
}

export interface EarnedBadge {
  id: string;
  code: string;
  name: string;
  description: string;
  awardedAt: string;
}

export interface GamificationSummary {
  streak: StreakSummary;
  badges: EarnedBadge[];
}

const STREAK_ROW_SELECT = {
  currentChainLength: true,
  bestChainLength: true,
  lastQualifyingLocalDay: true,
} satisfies Prisma.StreakSelect;

type StreakRow = Prisma.StreakGetPayload<{ select: typeof STREAK_ROW_SELECT }>;

interface LockedStreakRow {
  current_chain_length: number;
  best_chain_length: number;
  last_qualifying_local_day: string | null;
}

/**
 * Study streak engine (HU-GAM-002, RN-08). A real academic action extends the
 * streak at most once per (student, local day) in
 * `America/Argentina/Buenos_Aires`; a bare login never reaches this service.
 * Concurrency: the qualifying-day unique constraint elects one writer per day,
 * and the streak row is locked before the chain update so two different days
 * racing still compute one consistent chain.
 */
@Injectable()
export class StreakService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly badges: BadgesService,
  ) {}

  /**
   * Records one qualifying action and extends the streak when the local day has
   * not counted yet. Runs inside the caller's transaction so the day record,
   * the streak update, and any badge award commit or fail together. Replayed or
   * same-day events are idempotent no-ops for the chain (badge evaluation stays
   * safe to run against the live state). An event whose local day is not after
   * the stored last qualifying day (transactions racing across the day boundary
   * can commit out of clock order) still records its day but leaves the chain
   * and last day untouched.
   */
  async recordQualifying(tx: Prisma.TransactionClient, event: QualifyingEvent): Promise<void> {
    const localDay = toLocalDay(event.at, DEFAULT_LOCAL_DAY_TIME_ZONE);
    const inserted = await tx.streakQualifyingDay.createMany({
      data: {
        studentId: event.studentId,
        localDay,
        source: event.source,
      },
      skipDuplicates: true,
    });

    if (inserted.count === 0) {
      // The day already counted (replay, retry, or a concurrent same-day
      // event). Badge evaluation reads live state and stays idempotent.
      await this.evaluateBadges(tx, event.studentId);
      return;
    }

    // The streak row may not exist yet; both insert and lock must precede the
    // chain update so concurrent first-time writers serialize on one row.
    await tx.streak.createMany({
      data: [{ studentId: event.studentId }],
      skipDuplicates: true,
    });
    const [locked] = await tx.$queryRaw<LockedStreakRow[]>`
      SELECT "current_chain_length", "best_chain_length", "last_qualifying_local_day"
      FROM "streaks"
      WHERE "student_id" = ${event.studentId}::uuid
      FOR UPDATE
    `;
    if (!locked) throw new Error('Streak row missing after insert');

    const previous: StreakRow = {
      currentChainLength: locked.current_chain_length,
      bestChainLength: locked.best_chain_length,
      lastQualifyingLocalDay: locked.last_qualifying_local_day,
    };
    const lastDay = previous.lastQualifyingLocalDay;
    if (lastDay !== null && localDayDistance(lastDay, localDay) <= 0) {
      // Out-of-order commit: the day row above is a real activity day (it
      // still counts for active-days badges), but the chain and last day
      // must never move backwards.
      await this.evaluateBadges(tx, event.studentId);
      return;
    }
    const nextCurrent = this.nextChainLength(previous, localDay);
    const nextBest = Math.max(previous.bestChainLength, nextCurrent);

    await tx.streak.update({
      where: { studentId: event.studentId },
      data: {
        currentChainLength: nextCurrent,
        bestChainLength: nextBest,
        lastQualifyingLocalDay: localDay,
      },
    });

    await this.evaluateBadges(tx, event.studentId);
  }

  /** Live-state badge evaluation shared by both the day-winner and replay paths. */
  private async evaluateBadges(tx: Prisma.TransactionClient, studentId: string): Promise<void> {
    const streak = await tx.streak.findUnique({
      where: { studentId },
      select: { currentChainLength: true, bestChainLength: true },
    });
    const qualifyingDayCount = await tx.streakQualifyingDay.count({
      where: { studentId },
    });
    await this.badges.evaluateAndAward(tx, {
      studentId,
      currentChainLength: streak?.currentChainLength ?? 0,
      bestChainLength: streak?.bestChainLength ?? 0,
      qualifyingDayCount,
    });
  }

  /**
   * The chain continues only when the previous qualifying day was exactly the
   * day before (`gap === 1`); any larger gap restarts at 1 because the daily
   * requirement was not met in between and the streak broke (RN-08). Callers
   * only pass a day strictly after the last one: a gap of 0 cannot occur for
   * the day-winner path and a negative gap (out-of-order commit) is handled
   * by `recordQualifying` before chaining.
   */
  private nextChainLength(previous: StreakRow, localDay: string): number {
    const lastDay = previous.lastQualifyingLocalDay;
    if (lastDay === null) return 1;
    return localDayDistance(lastDay, localDay) === 1 ? previous.currentChainLength + 1 : 1;
  }

  /**
   * Own-data read for `GET /gamification/me`: current chain (zero when the last
   * qualifying day is older than yesterday, i.e. the streak broke), best chain,
   * and earned badges in unlock order (awardedAt ASC, id ASC).
   */
  async getStudentSummary(studentId: string): Promise<GamificationSummary> {
    const [streak, badges] = await Promise.all([
      this.prisma.streak.findUnique({
        where: { studentId },
        select: STREAK_ROW_SELECT,
      }),
      this.prisma.studentBadge.findMany({
        where: { studentId },
        select: {
          id: true,
          awardedAt: true,
          badgeDefinition: {
            select: { code: true, name: true, description: true },
          },
        },
        orderBy: [{ awardedAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const today = toLocalDay(new Date(), DEFAULT_LOCAL_DAY_TIME_ZONE);
    let currentStreak = 0;
    const lastDay = streak?.lastQualifyingLocalDay ?? null;
    if (streak !== null && lastDay !== null) {
      const gap = localDayDistance(lastDay, today);
      if (gap === 0 || gap === 1) {
        currentStreak = streak.currentChainLength;
      }
    }

    return {
      streak: {
        currentStreak,
        bestStreak: streak?.bestChainLength ?? 0,
        lastQualifyingDay: lastDay,
      },
      badges: badges.map((badge) => ({
        id: badge.id,
        code: badge.badgeDefinition.code,
        name: badge.badgeDefinition.name,
        description: badge.badgeDefinition.description,
        awardedAt: badge.awardedAt.toISOString(),
      })),
    };
  }
}
