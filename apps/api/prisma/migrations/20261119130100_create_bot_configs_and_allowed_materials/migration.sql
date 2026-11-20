-- Additive only: no existing rows are rewritten or deleted. The classroom owns exactly one
-- bot configuration; AllowedMaterial is unique per (classroom, material) and carries the
-- explicit classroom partition so bot retrieval can never cross classrooms or schools.
CREATE TYPE "material_index_state" AS ENUM ('pending', 'indexed', 'failed');

CREATE TABLE "bot_configs" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "bot_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_configs_classroom_id_key" ON "bot_configs"("classroom_id");

CREATE TABLE "allowed_materials" (
    "id" UUID NOT NULL,
    "bot_config_id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "index_state" "material_index_state" NOT NULL DEFAULT 'pending',
    "failure_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "allowed_materials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "allowed_materials_failure_reason_check"
        CHECK (("failure_reason" IS NULL) = ("index_state" <> 'failed'))
);

CREATE UNIQUE INDEX "allowed_materials_classroom_id_material_id_key"
    ON "allowed_materials"("classroom_id", "material_id");
CREATE INDEX "allowed_materials_bot_config_id_created_at_id_idx"
    ON "allowed_materials"("bot_config_id", "created_at", "id");
CREATE INDEX "allowed_materials_material_id_idx" ON "allowed_materials"("material_id");

ALTER TABLE "bot_configs" ADD CONSTRAINT "bot_configs_classroom_id_fkey"
    FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allowed_materials" ADD CONSTRAINT "allowed_materials_bot_config_id_fkey"
    FOREIGN KEY ("bot_config_id") REFERENCES "bot_configs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allowed_materials" ADD CONSTRAINT "allowed_materials_classroom_id_fkey"
    FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "allowed_materials" ADD CONSTRAINT "allowed_materials_material_id_fkey"
    FOREIGN KEY ("material_id") REFERENCES "study_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
