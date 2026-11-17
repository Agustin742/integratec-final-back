-- Additive: no existing rows are rewritten or deleted. Required author/classroom and
-- optional removal actor use RESTRICT so membership/account changes retain history.
CREATE TABLE "study_materials" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "object_key" VARCHAR(255) NOT NULL,
    "filename" VARCHAR(120) NOT NULL,
    "content_type" VARCHAR(32) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "study_materials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "study_materials_size_check" CHECK ("size_bytes" BETWEEN 1 AND 10485760),
    CONSTRAINT "study_materials_removal_check" CHECK (("removed_at" IS NULL) = ("removed_by_id" IS NULL))
);

CREATE UNIQUE INDEX "study_materials_object_key_key" ON "study_materials"("object_key");
CREATE INDEX "study_materials_classroom_id_removed_at_created_at_id_idx"
    ON "study_materials"("classroom_id", "removed_at", "created_at", "id");
CREATE INDEX "study_materials_author_id_idx" ON "study_materials"("author_id");
CREATE INDEX "study_materials_removed_by_id_idx" ON "study_materials"("removed_by_id");

ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_classroom_id_fkey"
    FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_removed_by_id_fkey"
    FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
