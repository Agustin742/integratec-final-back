export interface MaterialRetrievalQuery {
  classroomId: string;
  queryEmbedding: number[];
  topK: number;
  minSimilarity: number;
}

export interface RetrievedChunk {
  chunkId: string;
  materialId: string;
  filename: string;
  position: string;
  content: string;
  similarity: number;
}

/**
 * Classroom-scoped vector retrieval boundary for Study Guide Bot RAG.
 * Implementations MUST filter by the server-resolved `classroomId`, `AllowedMaterial`
 * (`INDEXED`), and non-removed `StudyMaterial` inside PostgreSQL, never in the prompt.
 */
export interface MaterialRetrievalPort {
  search(query: MaterialRetrievalQuery): Promise<RetrievedChunk[]>;
}

export const MATERIAL_RETRIEVAL_PORT = Symbol('MATERIAL_RETRIEVAL_PORT');
