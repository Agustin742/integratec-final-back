import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './unique-violation';

function p2002(target?: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: target === undefined ? undefined : { target },
  });
}

describe('isUniqueViolation', () => {
  it('matches any P2002 when no column is requested', () => {
    expect(isUniqueViolation(p2002())).toBe(true);
    expect(isUniqueViolation(p2002(['email']))).toBe(true);
  });

  it('matches only the requested column, as an array or a constraint name', () => {
    expect(isUniqueViolation(p2002(['submission_id']), 'submission_id')).toBe(true);
    expect(isUniqueViolation(p2002('grades_submission_id_key'), 'submission_id')).toBe(true);
    expect(isUniqueViolation(p2002(['point_transaction_id']), 'submission_id')).toBe(false);
    expect(isUniqueViolation(p2002(), 'submission_id')).toBe(false);
  });

  it('rejects other Prisma codes and non-Prisma errors', () => {
    const other = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2025',
      clientVersion: 'test',
    });
    expect(isUniqueViolation(other)).toBe(false);
    expect(isUniqueViolation(new Error('P2002'))).toBe(false);
  });
});
