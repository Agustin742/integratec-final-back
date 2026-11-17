import { Prisma } from '@prisma/client';

/**
 * Whether `error` is a Prisma unique-constraint violation (`P2002`). With `column`, it only
 * matches when that column is among the violated ones: on PostgreSQL Prisma reports them as
 * `meta.target` (an array of column names such as `['submission_id']`; a constraint name string
 * is accepted too), so a violation of a different unique index is not mistaken for this one.
 */
export function isUniqueViolation(error: unknown, column?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  if (column === undefined) return true;
  const target = error.meta?.target;
  const targets = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return targets.some((entry) => typeof entry === 'string' && entry.includes(column));
}
