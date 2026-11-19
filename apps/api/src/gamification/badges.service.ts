import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { NotificationRecorder } from '../notifications/notification-recorder.service';

export interface BadgeEvaluationInput {
  studentId: string;
  /** Chain length after the qualifying day that triggered this evaluation. */
  currentChainLength: number;
  bestChainLength: number;
  /** Distinct local days with a qualifying activity, counted live. */
  qualifyingDayCount: number;
}

interface CatalogEntry {
  id: string;
  conditionType: 'STREAK_REACHED' | 'QUALIFYING_DAYS_REACHED';
  threshold: number;
}

function conditionMet(entry: CatalogEntry, input: BadgeEvaluationInput): boolean {
  if (entry.conditionType === 'STREAK_REACHED') {
    // The best chain proves the threshold was reached even if the current
    // chain has since broken; already-met badges never retro-fail.
    return input.bestChainLength >= entry.threshold;
  }
  return input.qualifyingDayCount >= entry.threshold;
}

/**
 * Catalog-driven, idempotent badge awarding (HU-GAM-002): a badge condition met
 * awards `StudentBadge` once per (student, badge), even on repeated evaluation,
 * and records one in-app notification per newly awarded badge only.
 */
@Injectable()
export class BadgesService {
  constructor(private readonly notifications: NotificationRecorder) {}

  /**
   * Evaluates every active catalog entry and awards the not-yet-earned badges
   * whose condition the student now meets. Must run inside the caller's
   * transaction so badge, streak day, and notification commit or fail together.
   * Returns the codes awarded by this evaluation (empty on replay).
   */
  async evaluateAndAward(
    tx: Prisma.TransactionClient,
    input: BadgeEvaluationInput,
  ): Promise<string[]> {
    const definitions = await tx.badgeDefinition.findMany({
      where: { isActive: true },
      select: { id: true, code: true, conditionType: true, threshold: true },
    });
    if (definitions.length === 0) return [];

    const earnedIds = new Set(
      (
        await tx.studentBadge.findMany({
          where: { studentId: input.studentId },
          select: { badgeDefinitionId: true },
        })
      ).map((row) => row.badgeDefinitionId),
    );

    const awarded: string[] = [];
    for (const definition of definitions) {
      if (earnedIds.has(definition.id)) continue;
      if (!conditionMet(definition, input)) continue;

      // Database-level ON CONFLICT DO NOTHING: a concurrent evaluation for the
      // same badge loses silently and must not duplicate the notification.
      const inserted = await tx.studentBadge.createMany({
        data: {
          studentId: input.studentId,
          badgeDefinitionId: definition.id,
        },
        skipDuplicates: true,
      });
      if (inserted.count === 0) continue;

      const created = await tx.studentBadge.findUniqueOrThrow({
        where: {
          studentId_badgeDefinitionId: {
            studentId: input.studentId,
            badgeDefinitionId: definition.id,
          },
        },
        select: { id: true },
      });
      await this.notifications.record(tx, {
        kind: 'badge_awarded',
        resourceId: created.id,
        recipientId: input.studentId,
        studentId: input.studentId,
      });
      awarded.push(definition.code);
    }
    return awarded;
  }
}
