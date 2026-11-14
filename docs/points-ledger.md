# Points wallet and immutable ledger

`PointsModule` is wired into the root API. It provides authenticated read endpoints for student wallets and ledger movements, plus an exported `PointsLedgerService` for future producers (activity grading in `#32` and shop purchases in `#34`). All balances are server-derived (`SUM(amount)`); no client balance write or student-to-student transfer endpoint exists.

## REST endpoints

Send the session access token as `Authorization: Bearer <access token>`.

| Request | Success | Access rules |
| --- | --- | --- |
| `GET /classrooms/:id/points` | `200` `StudentWalletDto` | Active enrolled `STUDENT` only (`403` for staff/parent in non-adult mode; `404` for strangers or adult-mode parents) |
| `GET /classrooms/:id/students/:studentId/points` | `200` `StudentWalletDto` | Target student themselves (`200`), classroom staff (`OWNER`, `ADMIN`, `TEACHER` -> `200`), or active linked parent outside adult mode (`200`); classmate -> `403`; unlinked parent, stranger, deleted context, or adult-mode parent -> `404` |

Both endpoints share the [pagination and sorting contract](api-conventions.md#pagination-and-sorting):

- `page` (default `1`, range `1–10000`) and `pageSize` (default `20`, range `1–100`).
- `sort`: allowed fields are `createdAt` (default `-createdAt`, newest first) and `amount`. Every query appends a matching `id` tiebreaker (`{ id: sort.direction }`) inside a `RepeatableRead` transaction alongside `SUM(amount)` and `count` so balance, total, and page rows reflect a single consistent snapshot.
- Unsupported query parameters (including `?balance=...` or unsupported `sort` fields) return `400 VALIDATION_FAILED`.
- Missing/invalid credentials return `401 UNAUTHENTICATED`.

## Ledger invariants and concurrency

- **Append-only immutability:** `PointsLedgerService` exposes only `credit`, `debit`, `compensate`, `getBalance`, `getOwnWallet`, and `getStudentWallet` (zero update or delete methods). At the PostgreSQL layer, `BEFORE UPDATE OR DELETE ... FOR EACH ROW` trigger `point_transactions_immutable_trg` invokes `prevent_point_transaction_mutation()` and raises an exception even against raw SQL. Statement-level `TRUNCATE` is intentionally left unrestricted so `apps/api/prisma/seed.ts` (guarded by `assertSafeToSeed`) can reset synthetic local databases cleanly despite restrictive foreign keys.
- **Database CHECK constraints:** `amount <> 0`, `entry_kind = 'earning' => amount > 0`, `entry_kind = 'debit' => amount < 0`, and non-empty trimmed `reason` and `source_type`.
- **Earning idempotency:** Partial unique index `point_transactions_earning_source_uidx` on `(source_type, source_id) WHERE entry_kind = 'earning'` guarantees at most one earning per source. `credit` checks for an existing earning replay before locking membership (so "same source, same response" holds even if a student later leaves the classroom) and uses `INSERT ... ON CONFLICT DO NOTHING RETURNING ...` so concurrent duplicate calls inside an outer caller `$transaction` never put PostgreSQL into `25P02` aborted-transaction state. Reusing an earning source with mismatched `(classroomId, studentId, amount)` raises `409 Conflict`.
- **Non-negative balance under concurrency:** `debit` and `compensate` acquire a row-level lock (`SELECT ... FOR UPDATE OF cm`) on the student's active `classroom_memberships` row before reading `COALESCE(SUM(amount), 0)::bigint` and inserting. Concurrent `Promise.all` debits serialize on that lock so balance can never go negative.
- **Idempotent debits and compensations:** Optional `idempotencyKey` (unique) enables safe retries for purchases and corrections; `debit` and `compensate` check for an existing matching entry before locking membership so retries still return the stored entry if the student has since left the classroom, while parameter mismatches on the same key raise `409 Conflict`. Multiple `compensation` entries (such as regrade adjustments) may reference the same `(sourceType, sourceId)`.
- **Caller transaction atomicity:** `credit`, `debit`, and `compensate` accept an optional `tx?: Prisma.TransactionClient` so future grading and purchase flows commit or roll back atomically with their source domain records.
- **Privacy-safe compensation logging:** Recording a new compensation emits a structured log event `points_compensation_recorded` with non-PII identifiers (`classroomId`, `entryId`, `actorId`, `amount`, `sourceType`, `sourceId`) per [points rules](../rules/points-and-shop.md) and [observability rules](../rules/observability-and-privacy.md).

## Open decisions

- **Gap 18 (Classmate balance visibility and additional earning sources):** Per [points rules](../rules/points-and-shop.md#open-decisions), classmates currently receive `403 Forbidden` when requesting another student's wallet, and non-grading earning sources (streaks, medals, mini-game rewards) plus manual teacher adjustment endpoints remain deferred until product decisions are recorded.

## Verification and migration prerequisites

Use an explicitly supplied, disposable local PostgreSQL database through `DATABASE_URL` when running integration and HTTP tests:

```bash
pnpm --filter @aula/api prisma:migrate:deploy
pnpm --filter @aula/api prisma:generate
pnpm --filter @aula/api exec vitest run src/points/points-ledger.spec.ts src/points/points-ledger.integration.spec.ts src/points/points.http.spec.ts src/openapi/openapi.spec.ts --pool=threads --maxWorkers=2 --minWorkers=1
pnpm --filter @aula/api typecheck
pnpm --filter @aula/api build
pnpm exec eslint apps/api/src/points apps/api/src/app.module.ts
pnpm exec prettier --check apps/api/src/points apps/api/src/app.module.ts
python scripts/ci/check_docs.py
```
