-- Additive only: creates new tables and enums; no existing records are rewritten or removed.
-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('tp', 'exam');

-- CreateEnum
CREATE TYPE "activity_format" AS ENUM ('file', 'multiple_choice');

-- CreateEnum
CREATE TYPE "activity_state" AS ENUM ('draft', 'published');

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "classroom_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "type" "activity_type" NOT NULL,
    "format" "activity_format" NOT NULL,
    "state" "activity_state" NOT NULL DEFAULT 'draft',
    "title" VARCHAR(120) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "opens_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "allow_late" BOOLEAN NOT NULL DEFAULT false,
    "max_score" INTEGER NOT NULL,
    "weight_multiplier" DECIMAL(3,2) NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "activity_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "options" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_classroom_id_state_deleted_at_idx" ON "activities"("classroom_id", "state", "deleted_at");

-- CreateIndex
CREATE INDEX "activities_classroom_id_due_at_id_idx" ON "activities"("classroom_id", "due_at", "id");

-- CreateIndex
CREATE INDEX "activities_created_by_id_idx" ON "activities"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_activity_id_position_key" ON "questions"("activity_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "options_question_id_position_key" ON "options"("question_id", "position");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "options" ADD CONSTRAINT "options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Score ceiling is a 0-100 scale (activities-and-grading); the service validates the same bound.
ALTER TABLE "activities"
ADD CONSTRAINT "activities_max_score_check"
CHECK ("max_score" BETWEEN 0 AND 100);

-- Agreed multiplier domain is 0.5-3; DECIMAL(3,2) alone would allow up to 9.99.
ALTER TABLE "activities"
ADD CONSTRAINT "activities_weight_multiplier_check"
CHECK ("weight_multiplier" BETWEEN 0.5 AND 3);

-- The availability window must open strictly before the due date (NULL opens_at means open now).
ALTER TABLE "activities"
ADD CONSTRAINT "activities_window_check"
CHECK ("opens_at" IS NULL OR "opens_at" < "due_at");

-- A published activity always records when it was published.
ALTER TABLE "activities"
ADD CONSTRAINT "activities_published_at_check"
CHECK ("state" <> 'published' OR "published_at" IS NOT NULL);
