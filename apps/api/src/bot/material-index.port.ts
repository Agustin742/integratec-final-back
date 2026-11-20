/**
 * Bot material index boundary (issue #40, HU-BOT-001). Retrieval technology is
 * still an open decision (R6 candidate: Amazon Bedrock Knowledge Bases or an
 * equivalent), so every feature depends on this port, never on a concrete
 * provider. HU-BOT-002 replaces the default in-process adapter with the chosen
 * retrieval adapter without touching the endpoints or the data model.
 *
 * Partition contract (`rules/ai-bot-and-daily-briefing.md`): entries are addressed
 * by `(classroomId, materialId)` and the implementation MUST keep one partition
 * per classroom so retrieval can never cross classrooms or schools. The server
 * derives the classroom from persisted state; the prompt never filters.
 */
export interface MaterialIndexEntry {
  /** Classroom partition the material is indexed under. */
  classroomId: string;
  /** Study material indexed inside that partition. */
  materialId: string;
  /** Private storage key of the material bytes, resolved by the caller. */
  objectKey: string;
  filename: string;
  contentType: string;
}

export interface MaterialIndexPort {
  /**
   * Indexes the material under its classroom partition. MUST fully replace any
   * earlier chunks of the same `(classroomId, materialId)` pair: a re-enable
   * never reuses previously retrieved content, and a disable followed by a
   * re-enable indexes from scratch.
   */
  index(entry: MaterialIndexEntry): Promise<void>;
  /**
   * Removes every indexed chunk of the material from its classroom partition so
   * the material is excluded from retrieval immediately. Removing a missing
   * entry succeeds (idempotent).
   */
  remove(classroomId: string, materialId: string): Promise<void>;
  /** Whether the classroom partition currently holds indexed chunks for the material. */
  isIndexed(classroomId: string, materialId: string): Promise<boolean>;
}

/** Injection token for the {@link MaterialIndexPort} implementation. */
export const MATERIAL_INDEX_PORT = Symbol('MATERIAL_INDEX_PORT');
