-- Additive only: creates the streak/badge tables and relaxes the classroom
-- context of notifications (badge awards are student-owned, not classroom-scoped).
-- No existing records are rewritten or removed.

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "classroom_id" DROP NOT NULL;

-- CreateEnum
CREATE TYPE "StreakQualifyingSource" AS ENUM ('ON_TIME_SUBMISSION', 'EXAM_PASSED', 'DAILY_REVIEW_ANSWERED');

-- CreateEnum
CREATE TYPE "BadgeConditionType" AS ENUM ('STREAK_REACHED', 'QUALIFYING_DAYS_REACHED');

-- CreateTable
CREATE TABLE "streaks" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "current_chain_length" INTEGER NOT NULL DEFAULT 0,
    "best_chain_length" INTEGER NOT NULL DEFAULT 0,
    "last_qualifying_local_day" VARCHAR(10),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "streaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "streak_qualifying_days" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "local_day" VARCHAR(10) NOT NULL,
    "source" "StreakQualifyingSource" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "streak_qualifying_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_definitions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(280) NOT NULL,
    "condition_type" "BadgeConditionType" NOT NULL,
    "threshold" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "badge_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_badges" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "badge_definition_id" UUID NOT NULL,
    "awarded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "streaks_student_id_key" ON "streaks"("student_id");

-- The qualifying-day record is unique per (student, local day): concurrent
-- qualifying actions on one day count exactly once (RN-08).
-- CreateIndex
CREATE UNIQUE INDEX "streak_qualifying_days_student_id_local_day_key" ON "streak_qualifying_days"("student_id", "local_day");

-- CreateIndex
CREATE UNIQUE INDEX "badge_definitions_code_key" ON "badge_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "student_badges_student_id_badge_definition_id_key" ON "student_badges"("student_id", "badge_definition_id");

-- CreateIndex
CREATE INDEX "student_badges_student_id_awarded_at_idx" ON "student_badges"("student_id", "awarded_at");

-- Derived gamification state follows the user row (explicit, limited cascade;
-- `rules/data.md`: cascades must be explicit; user-generated content is unaffected).
-- AddForeignKey
ALTER TABLE "streaks" ADD CONSTRAINT "streaks_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "streak_qualifying_days" ADD CONSTRAINT "streak_qualifying_days_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_badges" ADD CONSTRAINT "student_badges_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Catalog entries are not derived from the student: earned badges block their removal.
-- AddForeignKey
ALTER TABLE "student_badges" ADD CONSTRAINT "student_badges_badge_definition_id_fkey" FOREIGN KEY ("badge_definition_id") REFERENCES "badge_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business integrity CHECK constraints
ALTER TABLE "streaks"
ADD CONSTRAINT "streaks_chain_lengths_check"
CHECK ("current_chain_length" >= 0 AND "best_chain_length" >= 0);

ALTER TABLE "streaks"
ADD CONSTRAINT "streaks_last_local_day_check"
CHECK ("last_qualifying_local_day" IS NULL OR "last_qualifying_local_day" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE "streak_qualifying_days"
ADD CONSTRAINT "streak_qualifying_days_local_day_check"
CHECK ("local_day" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE "badge_definitions"
ADD CONSTRAINT "badge_definitions_threshold_check"
CHECK ("threshold" >= 1);
