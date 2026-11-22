-- Additive only: creates the daily review delivery and question tables for
-- HU-BOT-003 (RN-13/RN-14). No existing records are rewritten or removed.

-- CreateEnum
CREATE TYPE "DailyReviewContentKind" AS ENUM ('GENERATED', 'STRUCTURED');

-- CreateTable
CREATE TABLE "daily_review_deliveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_day" VARCHAR(10) NOT NULL,
    "content_kind" "DailyReviewContentKind" NOT NULL,
    "delivered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_review_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_review_questions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_day" VARCHAR(10) NOT NULL,
    "prompt" VARCHAR(280) NOT NULL,
    "options" JSONB NOT NULL,
    "correct_option" VARCHAR(120) NOT NULL,
    "material_title" VARCHAR(120),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "answered_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_review_questions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_review_deliveries_user_id_local_day_key" ON "daily_review_deliveries"("user_id", "local_day");

-- CreateIndex
CREATE INDEX "daily_review_deliveries_user_id_delivered_at_idx" ON "daily_review_deliveries"("user_id", "delivered_at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_review_questions_user_id_local_day_key" ON "daily_review_questions"("user_id", "local_day");

-- AddForeignKey
ALTER TABLE "daily_review_deliveries" ADD CONSTRAINT "daily_review_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_review_questions" ADD CONSTRAINT "daily_review_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Business integrity CHECK constraints (same shape as the streak local-day rule)
ALTER TABLE "daily_review_deliveries"
ADD CONSTRAINT "daily_review_deliveries_local_day_check"
CHECK ("local_day" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE "daily_review_questions"
ADD CONSTRAINT "daily_review_questions_local_day_check"
CHECK ("local_day" ~ '^\d{4}-\d{2}-\d{2}$');

ALTER TABLE "daily_review_questions"
ADD CONSTRAINT "daily_review_questions_attempts_check"
CHECK ("attempts" >= 0);
