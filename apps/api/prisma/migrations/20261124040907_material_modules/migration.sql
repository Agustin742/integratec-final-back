-- AlterTable
ALTER TABLE "study_materials" ADD COLUMN     "module_id" UUID;

-- CreateTable
CREATE TABLE "material_modules" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "position" INTEGER NOT NULL,
    "removed_at" TIMESTAMPTZ(6),
    "removed_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "material_modules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "material_modules_name_check" CHECK (btrim("name") <> ''),
    CONSTRAINT "material_modules_position_check" CHECK ("position" >= 0)
);

-- CreateIndex
CREATE INDEX "material_modules_classroom_id_removed_at_position_id_idx" ON "material_modules"("classroom_id", "removed_at", "position", "id");

-- CreateIndex
CREATE INDEX "material_modules_removed_by_id_idx" ON "material_modules"("removed_by_id");

-- CreateIndex
CREATE INDEX "study_materials_module_id_idx" ON "study_materials"("module_id");

-- AddForeignKey
ALTER TABLE "study_materials" ADD CONSTRAINT "study_materials_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "material_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_modules" ADD CONSTRAINT "material_modules_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_modules" ADD CONSTRAINT "material_modules_removed_by_id_fkey" FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
