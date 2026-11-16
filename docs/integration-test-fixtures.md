# Isolated PostgreSQL test fixtures

Set `DATABASE_URL` explicitly to an isolated, migrated **test** database before running integration tests. Do not use a shared or production database. Environment files are not loaded by these fixtures, and the new fixtures do not silently fall back to a default connection.

- The test-only configuration boundary accepts loopback hosts and the Compose `postgres` hostname. This checks locality, not database ownership; the caller must provide a dedicated database.
- The outbox suite requires permission to create a schema. It atomically creates a UUID-named schema and an empty copy of `public.outbox_events`, checks that model operations and raw dispatcher SQL resolve to that private table, and guards cleanup by schema OID and current owner. Cleanup never uses `CASCADE` or deletes shared event rows.
- Specs sharing an event type must pass only their owned event IDs as the fourth argument to `dispatchPending(batchSize, now, types, eventIds)`. Capture IDs returned by transactional recorders; when an HTTP producer returns no IDs, query by fixture-owned payload identifiers (for example user or activity ID), never a global before/after snapshot. Scope assertions and cleanup to the same ownership boundary.
- Type and ID filters intersect. An explicit empty ID list claims nothing; omitting IDs preserves the existing type-filtered or unfiltered production behavior. Only the private-schema outbox suite intentionally tests unfiltered dispatch. Production polling callers remain unchanged.
- Activity publishing specs can leave pending events until final fixture teardown: other specs no longer claim them. Final teardown still removes owned notifications and deliveries before their source events; no per-test cleanup or cross-dispatch row-lock workaround is needed.
- Fixtures use the existing migrated schema. They do not provision services, migrate, seed or change production dispatcher behavior.

```bash
# With the isolated DATABASE_URL exported:
pnpm --filter @aula/api exec vitest run src/platform/outbox/outbox.spec.ts src/config/testing/isolated-test-database.spec.ts
```

On a resource-constrained host, the same Vitest cases can run with parallel threads and a bounded worker count:

```bash
pnpm --recursive exec vitest run --pool=threads --maxWorkers=2 --minWorkers=1
```

This does not skip cases or increase test timeouts. A successful run in this mode is not evidence that a previous fork-pool interruption was diagnosed or cured. See the [quality rules](../rules/quality-and-testing.md) for reporting failed and unavailable checks.
