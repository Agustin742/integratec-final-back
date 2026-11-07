import type { Prisma } from '@prisma/client';

/** Serialize credential changes and session creation on the persisted user row. */
export async function lockCredentialUser(tx: Prisma.TransactionClient, userId: string) {
  const rows = await tx.$queryRaw<{ passwordHash: string }[]>`
    SELECT password_hash AS "passwordHash" FROM users
    WHERE id = ${userId}::uuid FOR UPDATE
  `;
  return rows[0];
}
