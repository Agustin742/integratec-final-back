import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UUID_PATTERN } from '../access/access-verification.service';

/**
 * Verifies, inside a transaction, that an active module of this classroom exists and holds
 * a share lock on it. Module removal updates the module row first, so it waits for any
 * in-flight upload or move and then unassigns the material that transaction committed;
 * a material can therefore never be left pointing at a removed module.
 */
export async function lockActiveModule(
  tx: Prisma.TransactionClient,
  classroomId: string,
  moduleId: string,
): Promise<void> {
  if (!UUID_PATTERN.test(moduleId)) throw new NotFoundException('Module not found');
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id FROM material_modules
    WHERE id = ${moduleId}::uuid AND classroom_id = ${classroomId}::uuid AND removed_at IS NULL
    FOR SHARE`);
  if (rows.length === 0) throw new NotFoundException('Module not found');
}
