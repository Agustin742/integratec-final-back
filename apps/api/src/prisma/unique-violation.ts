import { Prisma } from '@prisma/client';

/** Whether `error` is a Prisma unique-constraint violation (`P2002`). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
