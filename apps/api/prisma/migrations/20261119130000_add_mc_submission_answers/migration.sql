-- Additive only: adds the multiple-choice auto-graded score column and the per-question answers
-- table; no existing records are rewritten or removed. FILE submissions keep `auto_score` NULL.

-- RedefineTables
ALTER TABLE "submissions" ADD COLUMN "auto_score" INTEGER;

-- CreateTable
CREATE TABLE "submission_answers" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "submission_answers_submission_id_question_id_key" ON "submission_answers"("submission_id", "question_id");

-- CreateIndex
CREATE UNIQUE INDEX "submission_answers_submission_id_position_key" ON "submission_answers"("submission_id", "position");

-- CreateIndex
CREATE INDEX "submission_answers_question_id_idx" ON "submission_answers"("question_id");

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- `autoScore` mirrors the activity's 0-100 `maxScore` scale (activities.max_score check).
ALTER TABLE "submissions"
ADD CONSTRAINT "submissions_auto_score_check"
CHECK ("auto_score" IS NULL OR "auto_score" BETWEEN 0 AND 100);

-- A submission answers a question at most once; the bound also keeps `position` sane.
ALTER TABLE "submission_answers"
ADD CONSTRAINT "submission_answers_position_check"
CHECK ("position" BETWEEN 0 AND 99);
