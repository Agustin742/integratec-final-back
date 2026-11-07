import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthDataCleanupResult {
  sessions: number;
  refreshTokens: number;
  passwordResetTokens: number;
}

/**
 * Prunes auth rows nobody can use any more, so the tables do not grow without bound.
 *
 * Rows are kept for `authDataRetentionSeconds` past their expiry (or rotation/use), which
 * preserves refresh reuse detection and a short audit trail. Each table is emptied with
 * bounded batches, one short `DELETE` statement each and no surrounding transaction, so a
 * large backlog never holds long locks. The deletes are idempotent: running twice, or from
 * two instances at once, only removes what is still there.
 */
@Injectable()
export class AuthDataCleanupService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /**
   * Deletes rows older than the retention window counted back from `now`.
   *
   * Counts are rows removed by an explicit rule: `sessions` counts expired sessions (their
   * refresh tokens go with them through the cascade and are not counted), `refreshTokens`
   * counts rotated tokens pruned from sessions that are still stored.
   */
  async run(now: Date = new Date()): Promise<AuthDataCleanupResult> {
    const cutoff = new Date(now.getTime() - this.config.authDataRetentionSeconds * 1000);
    const batch = this.config.authCleanupBatchSize;

    const refreshTokens = await this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "refresh_tokens"
        WHERE "id" IN (
          SELECT "id" FROM "refresh_tokens"
          WHERE "rotated_at" IS NOT NULL AND "rotated_at" < ${cutoff}
          LIMIT ${limit}
        )`,
      batch,
    );
    const sessions = await this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "sessions"
        WHERE "id" IN (
          SELECT "id" FROM "sessions"
          WHERE "expires_at" < ${cutoff}
          LIMIT ${limit}
        )`,
      batch,
    );
    const passwordResetTokens = await this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "password_reset_tokens"
        WHERE "id" IN (
          SELECT "id" FROM "password_reset_tokens"
          WHERE ("used_at" IS NOT NULL AND "used_at" < ${cutoff}) OR "expires_at" < ${cutoff}
          LIMIT ${limit}
        )`,
      batch,
    );

    return { sessions, refreshTokens, passwordResetTokens };
  }

  /** Runs the statement until a batch removes fewer rows than the batch size. */
  private async deleteInBatches(
    statement: (limit: number) => Prisma.Sql,
    batchSize: number,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw(statement(batchSize));
      total += deleted;
      if (deleted < batchSize) {
        return total;
      }
    }
  }
}
