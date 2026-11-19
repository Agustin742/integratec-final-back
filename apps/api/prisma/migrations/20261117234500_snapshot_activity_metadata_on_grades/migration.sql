-- Freeze the graded activity title and maxScore on the grade (the same snapshot pattern as
-- type_weight and weight_multiplier): later activity edits never rewrite the values a student
-- was graded against. Backfills every existing grade from the activity its submission points
-- at, then enforces NOT NULL. Additive and lossless.
ALTER TABLE "grades" ADD COLUMN     "activity_title" VARCHAR(120),
ADD COLUMN     "max_score" INTEGER;

UPDATE "grades" g
SET "activity_title" = a."title",
    "max_score" = a."max_score"
FROM "submissions" s
JOIN "activities" a ON a."id" = s."activity_id"
WHERE g."submission_id" = s."id";

ALTER TABLE "grades" ALTER COLUMN "activity_title" SET NOT NULL,
ALTER COLUMN "max_score" SET NOT NULL;
