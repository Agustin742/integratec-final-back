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
--     -v ON_ERROR_STOP=1 -v confirm_db=<database> \
--     -v cutoff="2026-11-17T00:00:00Z" -v max_rows=1000 \
--     -f - < scripts/dev/purge-stale-outbox.sql
-- Or with a local psql: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_db=<database> -v cutoff=... -v max_rows=... -f scripts/dev/purge-stale-outbox.sql
--
-- `confirm_db` must equal the database psql is connected to, or the script aborts with an
-- error before touching anything. It guards against a stale DATABASE_URL or a wrong -d.
--
-- The stale ids are selected once, locked (FOR UPDATE SKIP LOCKED, so a concurrent
-- dispatcher never races the purge) and reused by every DELETE below. The whole script runs
-- in one transaction: inspect the reported counts and, if anything looks wrong, let the
-- transaction roll back (abort with Ctrl+C, or replace the final COMMIT with ROLLBACK for a
-- dry run that still reports every count).

\set ON_ERROR_STOP on

\if :{?confirm_db}
\else
  \echo 'Missing -v confirm_db=<database>; refusing to run.'
  DO $$ BEGIN RAISE EXCEPTION 'confirm_db is required'; END $$;
  \quit
\endif

SELECT current_database() = :'confirm_db' AS db_ok \gset
\if :db_ok
\else
  \echo 'Connected database does not match confirm_db; refusing to run.'
  DO $$ BEGIN RAISE EXCEPTION 'connected database does not match confirm_db'; END $$;
  \quit
\endif

BEGIN;

CREATE TEMP TABLE stale ON COMMIT DROP AS
  SELECT id FROM outbox_events WHERE false;

INSERT INTO stale (id)
SELECT id
FROM outbox_events
WHERE processed_at IS NULL
  AND failed_at IS NULL
  AND occurred_at < :'cutoff'::timestamptz
ORDER BY occurred_at, id
LIMIT :max_rows::int
FOR UPDATE SKIP LOCKED;

SELECT count(*) AS stale_events_to_purge FROM stale;

WITH purged AS (
  DELETE FROM notification_deliveries nd
  USING notifications n, stale s
  WHERE nd.notification_id = n.id
    AND n.source_event_id = s.id
  RETURNING 1
)
SELECT count(*) AS deliveries_purged FROM purged;

WITH purged AS (
  DELETE FROM notifications n
  USING stale s
  WHERE n.source_event_id = s.id
  RETURNING 1
)
SELECT count(*) AS notifications_purged FROM purged;

WITH purged AS (
  DELETE FROM outbox_events e
  USING stale s
  WHERE e.id = s.id
  RETURNING 1
)
SELECT count(*) AS events_purged FROM purged;

COMMIT;
