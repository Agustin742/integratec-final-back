-- Backfill the per-UTC-day submission counts for submissions that predate write-time
-- recording (20261117231530_add_metric_submission_and_message_counts), so the daily
-- submissionCount rows and the teacher summary (gradedCount + ungradedCount) tell the same
-- story. Rows are keyed by the UTC day of each submission; the count is derived from
-- `submissions` itself, so the update is self-correcting for any database that already ran
-- the feature in development. In production this runs once, before write-time recording
-- starts. message_count stays 0 until chat (RF-COM-002) ships.
INSERT INTO "activity_metrics" ("id", "classroom_id", "user_id", "day", "connected_seconds", "submission_count", "message_count", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  a."classroom_id",
  s."student_id",
  (s."submitted_at" AT TIME ZONE 'UTC')::date,
  0,
  COUNT(*),
  0,
  now(),
  now()
FROM "submissions" s
JOIN "activities" a ON a."id" = s."activity_id"
GROUP BY a."classroom_id", s."student_id", (s."submitted_at" AT TIME ZONE 'UTC')::date
ON CONFLICT ("classroom_id", "user_id", "day") DO UPDATE
SET "submission_count" = "excluded"."submission_count",
    "updated_at" = now();
