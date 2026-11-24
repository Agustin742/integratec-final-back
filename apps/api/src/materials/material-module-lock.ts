import { createHash } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UUID_PATTERN } from '../access/access-verification.service';

function classroomMaterialModulesLockKey(classroomId: string): bigint {
  return createHash('sha256')
    .update(`material-modules:${classroomId.toLowerCase()}`)
    .digest()
    .readBigInt64BE(0);
}

/**
 * Serializes classroom-wide module lifecycle mutations (`create`, `reorder`, `remove`)
 * for a single classroom until the enclosing transaction commits or rolls back.
 *
 * Lock ordering across module and material transactions (strictly acyclic):
 * 1. Classroom advisory xact lock (`material-modules:<classroomId>`) — `create`, `reorder`, `remove`
 * 2. `material_modules` row lock (`FOR UPDATE` in `reorder`, `UPDATE` in `remove`,
 *    `FOR SHARE` in `upload` / `move`)
 * 3. `study_materials` row write (`INSERT` in `upload`, `UPDATE` in `move` / `remove`)
 *
 * Because `upload` and `move` never acquire the classroom advisory lock (only `FOR SHARE`
 * on a single module row), and `remove` acquires the advisory lock before updating the
 * module row and unassigning its materials, no lock-ordering cycle can form.
 */
export async function lockClassroomMaterialModules(
  tx: Prisma.TransactionClient,
  classroomId: string,
): Promise<void> {
  const lockKey = classroomMaterialModulesLockKey(classroomId);
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${lockKey})`;
}

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
