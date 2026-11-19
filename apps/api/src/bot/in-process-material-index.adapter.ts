import { Injectable } from '@nestjs/common';
import type { MaterialIndexEntry, MaterialIndexPort } from './material-index.port';

/**
 * Default {@link MaterialIndexPort} adapter. Retrieval technology is an open
 * decision (issue #40 blocker, R6), so this in-process implementation only
 * records per-classroom partition membership: it makes the enable/disable/list
 * flow complete and testable today, and HU-BOT-002 replaces it with the chosen
 * retrieval adapter without changing the port contract.
 *
 * The map is process-local and never a source of truth: `allowed_materials` is
 * the system of record for what the bot may use, and a restart starts every
 * partition empty until materials are re-indexed.
 */
@Injectable()
export class InProcessMaterialIndexAdapter implements MaterialIndexPort {
  private readonly partitions = new Map<string, Map<string, MaterialIndexEntry>>();

  async index(entry: MaterialIndexEntry): Promise<void> {
    // Full replacement per the port contract: a re-enable never reuses earlier chunks.
    this.partition(entry.classroomId).set(entry.materialId, { ...entry });
  }

  async remove(classroomId: string, materialId: string): Promise<void> {
    this.partition(classroomId).delete(materialId);
  }

  async isIndexed(classroomId: string, materialId: string): Promise<boolean> {
    return this.partition(classroomId).has(materialId);
  }

  private partition(classroomId: string): Map<string, MaterialIndexEntry> {
    let partition = this.partitions.get(classroomId);
    if (!partition) {
      partition = new Map();
      this.partitions.set(classroomId, partition);
    }
    return partition;
  }
}
