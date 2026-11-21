-- Enable pgvector in PostgreSQL 16 (available on pgvector/pgvector:pg16 and AWS RDS PostgreSQL 16).
CREATE EXTENSION IF NOT EXISTS vector;

-- Additive only: no existing rows are rewritten or deleted. Stores chunked text and
-- 768-dimensional embeddings partitioned by classroom for Study Guide Bot RAG (HU-BOT-002).
CREATE TABLE "material_chunks" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "position" VARCHAR(80) NOT NULL,
    "embedding" vector(768) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "material_chunks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "material_chunks_chunk_index_check" CHECK ("chunk_index" >= 0),
    CONSTRAINT "material_chunks_content_check" CHECK (btrim("content") <> ''),
    CONSTRAINT "material_chunks_position_check" CHECK (btrim("position") <> '')
);

CREATE UNIQUE INDEX "material_chunks_classroom_id_material_id_chunk_index_key"
    ON "material_chunks"("classroom_id", "material_id", "chunk_index");
CREATE INDEX "material_chunks_classroom_id_material_id_idx"
    ON "material_chunks"("classroom_id", "material_id");
CREATE INDEX "material_chunks_embedding_hnsw_idx"
    ON "material_chunks" USING hnsw ("embedding" vector_cosine_ops);

ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_classroom_id_fkey"
    FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_chunks" ADD CONSTRAINT "material_chunks_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "study_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reset any materials previously marked indexed by the removed in-process adapter
-- (which have no rows in material_chunks) so teachers visibly re-index them into pgvector.
UPDATE "allowed_materials"
SET "index_state" = 'failed'::"material_index_state",
    "failure_reason" = 'This material needs to be re-enabled so it can be indexed for the Study Guide Bot.',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "index_state" = 'indexed'::"material_index_state"
  AND NOT EXISTS (
    SELECT 1
    FROM "material_chunks" mc
    WHERE mc."classroom_id" = "allowed_materials"."classroom_id"
      AND mc."material_id" = "allowed_materials"."material_id"
  );
