-- Repeatable maintenance purge for stale transactional-outbox rows in a shared development
-- database. rules/data.md keeps the application from ever deleting `outbox_events`; this
-- script is an operator tool instead: run by hand against a database you own, never by the
-- app, never by CI, and never against production data you cannot regenerate.
--
-- What it deletes: unprocessed events (no `processed_at`, no `failed_at`) older than the
-- `cutoff`, together with the notifications and notification deliveries that reference them,
-- in foreign-key order and bounded by `max_rows`. Processed and failed rows are never
-- touched: they are history the schemas deliberately keep.
--
-- Usage (Docker, shared dev database):
--   docker exec -i <postgres-container> psql -U <user> -d <database> \
--     -v ON_ERROR_STOP=1 -v cutoff="2026-11-17T00:00:00Z" -v max_rows=1000 \
--     -f - < scripts/dev/purge-stale-outbox.sql
-- Or with a local psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v cutoff=... -v max_rows=... -f scripts/dev/purge-stale-outbox.sql
--
-- The whole script runs in one transaction: inspect the reported counts and, if anything
-- looks wrong, let the transaction roll back (abort with Ctrl+C or add ROLLBACK instead of
-- COMMIT for a dry run).
BEGIN;

WITH stale AS (
  SELECT id
  FROM outbox_events
  WHERE processed_at IS NULL
    AND failed_at IS NULL
    AND occurred_at < :'cutoff'::timestamptz
  ORDER BY occurred_at
  LIMIT :max_rows::int
)
SELECT count(*) AS stale_events_to_purge FROM stale;

WITH stale AS (
  SELECT id
  FROM outbox_events
  WHERE processed_at IS NULL
    AND failed_at IS NULL
    AND occurred_at < :'cutoff'::timestamptz
  ORDER BY occurred_at
  LIMIT :max_rows::int
), purged AS (
  DELETE FROM notification_deliveries nd
  USING notifications n, stale s
  WHERE nd.notification_id = n.id
    AND n.source_event_id = s.id
  RETURNING 1
)
SELECT count(*) AS deliveries_purged FROM purged;

WITH stale AS (
  SELECT id
  FROM outbox_events
  WHERE processed_at IS NULL
    AND failed_at IS NULL
    AND occurred_at < :'cutoff'::timestamptz
  ORDER BY occurred_at
  LIMIT :max_rows::int
), purged AS (
  DELETE FROM notifications n
  USING stale s
  WHERE n.source_event_id = s.id
  RETURNING 1
)
SELECT count(*) AS notifications_purged FROM purged;

WITH stale AS (
  SELECT id
  FROM outbox_events
  WHERE processed_at IS NULL
    AND failed_at IS NULL
    AND occurred_at < :'cutoff'::timestamptz
  ORDER BY occurred_at
  LIMIT :max_rows::int
), purged AS (
  DELETE FROM outbox_events e
  USING stale s
  WHERE e.id = s.id
  RETURNING 1
)
SELECT count(*) AS events_purged FROM purged;

COMMIT;
