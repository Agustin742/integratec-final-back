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
 * preserves refresh reuse detection and a short audit trail. Rotated tokens of a session that
 * is still live are never pruned. Each table is emptied with
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
   * `sessions` counts expired sessions deleted. `refreshTokens` counts every refresh token
   * deleted by an explicit rule: the tokens of sessions about to be removed (deleted first,
   * in batches, so the session delete cascades nothing), plus rotated tokens older than the
   * cutoff whose session is no longer live. A session is live while it has not expired at
   * `now` and is not revoked; its rotated tokens are kept however old they are, because
   * session expiry is fixed at creation and may outlast today's `REFRESH_TOKEN_TTL`, and
   * dropping them would turn a replay into an unknown-token 401 that revokes nothing.
   */
  async run(now: Date = new Date()): Promise<AuthDataCleanupResult> {
    const cutoff = new Date(now.getTime() - this.config.authDataRetentionSeconds * 1000);
    const batch = this.config.authCleanupBatchSize;

    const expiredSessionTokens = await this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "refresh_tokens"
        WHERE "id" IN (
          SELECT rt."id" FROM "refresh_tokens" rt
          JOIN "sessions" s ON s."id" = rt."session_id"
          WHERE s."expires_at" < ${cutoff}
          LIMIT ${limit}
        )`,
      batch,
    );
    const rotatedTokens = await this.deleteInBatches(
      (limit) => Prisma.sql`
        DELETE FROM "refresh_tokens"
        WHERE "id" IN (
          SELECT rt."id" FROM "refresh_tokens" rt
          JOIN "sessions" s ON s."id" = rt."session_id"
          WHERE rt."rotated_at" IS NOT NULL AND rt."rotated_at" < ${cutoff}
            AND NOT (s."expires_at" > ${now} AND s."revoked_at" IS NULL)
          LIMIT ${limit}
        )`,
      batch,
    );
    const refreshTokens = expiredSessionTokens + rotatedTokens;
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
