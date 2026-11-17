-- Additive only: creates new tables; no existing records are rewritten or removed.

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "grader_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "points_awarded" INTEGER NOT NULL,
    "type_weight" DECIMAL(4,2) NOT NULL,
    "weight_multiplier" DECIMAL(3,2) NOT NULL,
    "point_transaction_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "graded_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_revisions" (
    "id" UUID NOT NULL,
    "grade_id" UUID NOT NULL,
    "grader_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "points_delta" INTEGER NOT NULL,
    "point_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grades_submission_id_key" ON "grades"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "grades_point_transaction_id_key" ON "grades"("point_transaction_id");

-- CreateIndex
CREATE INDEX "grades_grader_id_idx" ON "grades"("grader_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_revisions_point_transaction_id_key" ON "grade_revisions"("point_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_revisions_grade_id_version_key" ON "grade_revisions"("grade_id", "version");

-- CreateIndex
CREATE INDEX "grade_revisions_grader_id_idx" ON "grade_revisions"("grader_id");

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_grader_id_fkey" FOREIGN KEY ("grader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grades" ADD CONSTRAINT "grades_point_transaction_id_fkey" FOREIGN KEY ("point_transaction_id") REFERENCES "point_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_revisions" ADD CONSTRAINT "grade_revisions_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_revisions" ADD CONSTRAINT "grade_revisions_grader_id_fkey" FOREIGN KEY ("grader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_revisions" ADD CONSTRAINT "grade_revisions_point_transaction_id_fkey" FOREIGN KEY ("point_transaction_id") REFERENCES "point_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business integrity CHECK constraints
ALTER TABLE "grades"
ADD CONSTRAINT "grades_score_check"
CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "grades"
ADD CONSTRAINT "grades_feedback_check"
CHECK (char_length(btrim("feedback")) BETWEEN 1 AND 5000);

ALTER TABLE "grades"
ADD CONSTRAINT "grades_points_awarded_check"
CHECK ("points_awarded" >= 0);

ALTER TABLE "grades"
ADD CONSTRAINT "grades_type_weight_check"
CHECK ("type_weight" BETWEEN 0.1 AND 10);

ALTER TABLE "grades"
ADD CONSTRAINT "grades_weight_multiplier_check"
CHECK ("weight_multiplier" BETWEEN 0.5 AND 3);

ALTER TABLE "grades"
ADD CONSTRAINT "grades_version_check"
CHECK ("version" >= 1);

ALTER TABLE "grade_revisions"
ADD CONSTRAINT "grade_revisions_version_check"
CHECK ("version" >= 1);

ALTER TABLE "grade_revisions"
ADD CONSTRAINT "grade_revisions_score_check"
CHECK ("score" BETWEEN 0 AND 100);

ALTER TABLE "grade_revisions"
ADD CONSTRAINT "grade_revisions_feedback_check"
CHECK (char_length(btrim("feedback")) BETWEEN 1 AND 5000);
