# Tracker — Luis

## 2026-11-20 — Prevent stale appearance retries from overwriting newer state (PR #121)

- **Status:** completed
- **Area / files:** `apps/api/prisma/`, `apps/api/src/platform/realtime/`, `apps/api/src/users/`, `apps/api/src/equipment/`, `apps/realtime/src/internal/`, `apps/realtime/src/rooms/`
- **Change:** Added monotonically increasing per-user appearance revisions so realtime ignores stale outbox snapshots, including races with join and reconnection verification.
- **Reason:** A retried older outbox snapshot can arrive after a newer update and leave the live avatar stale.
- **Validation:** Realtime (137/137), API appearance/join/reverification (97/97), PostgreSQL integration, OpenAPI (13/13), lint, typecheck, build, format, docs (82 files), and `git diff --check` passed locally. Full CI remains pending after push.
- **Next step:** Monitor CI and review on PR #121.

## 2026-11-19 — Realtime classroom chat (#48)

- **Status:** PR [#122](https://github.com/Agustin742/integratec-final-back/pull/122) open from `feat/48-chat-realtime` (commit `683c844`)
- **Area / files:** `apps/api/src/chat/`, `apps/api/src/platform/realtime/`, `apps/realtime/src/internal/`, `apps/realtime/src/rooms/`, `packages/contracts/`, chat/realtime rules and documentation
- **Change:** Implemented the approved REST-send, transactional-outbox, authenticated internal-HTTP broadcast flow and the `chat:message` / `chat:message.hidden` event contract. Message creation and first moderation atomically record minimal outbox events; the handler resolves persisted message content before dispatch. Colyseus validates the service request and broadcasts only to rooms for the matching classroom. Delivery retries do not roll back REST writes; clients deduplicate by ID and reconcile from REST history.
- **Reason:** Deliver live chat without making Colyseus the persistence or authorization authority; REST history remains the recovery source.
- **Verification:** `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `python scripts/ci/check_docs.py` (82 files), and `git diff --check origin/develop` passed. Focused API suites passed **114/114** tests (chat HTTP 39, chat send 21, OpenAPI 13, realtime chat handler/client 12, realtime eviction 29); realtime suites passed **63/63** (internal routes 22, rooms 41); shared contracts passed **2/2**. Integration tests ran against a temporary isolated PostgreSQL 17 database. API tests used Vitest's thread pool because the default pool produced a worker-specific Nest DI failure; all focused suites passed under threads. The full monorepo test suite was not run.
- **Next step:** Await CI and review. The frontend integration remains tracked separately in frontend #51.

## 2026-11-15 — Submission grading, weighted points conversion, and review queue (Issue #32)

- **Status:** completed
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261116000000_create_grades/`, `apps/api/prisma/seed.ts`, `apps/api/src/config/api-config.ts`, `apps/api/src/config/api-config.spec.ts`, `apps/api/.env.example`, `apps/api/src/auth/testing/auth-test-config.ts`, `apps/api/src/grades/`, `apps/api/src/submissions/submissions.dto.ts`, `apps/api/src/submissions/submissions.service.ts`, `apps/api/src/points/points-ledger.integration.spec.ts`, `apps/api/src/app.module.ts`, `apps/api/src/openapi/openapi.spec.ts`, `apps/api/openapi.json`, `rules/data.md`, `docs/technical-justification.md`, `docs/grading.md`, `docs/submissions.md`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #32 (`HU-ACT-004: Grade submissions, give feedback and credit weighted points`) on `feat/32-grade-submissions`:
  - **Config & weighted points (`api-config.ts`, `grade-points.ts`):** Added `GRADE_WEIGHT_TP` (default `1`) and `GRADE_WEIGHT_EXAM` (default `1.5`, validated strictly `EXAM > TP`, `0.1..10`, <= 2 decimals) and implemented exact integer ten-thousandths half-up rounding (`calculateWeightedGradePoints`) without IEEE-754 float drift.
  - **Prisma schema, additive migration & seed (`20261116000000_create_grades`, `seed.ts`):** Added `Grade` (`grades`) and `GradeRevision` (`grade_revisions`) with `ON DELETE RESTRICT` FKs and PostgreSQL `CHECK` constraints (`score 0..100`, `feedback 1..5000` trimmed, `points_awarded >= 0`, `version >= 1`). Updated `Submission.grade` and derived `SubmissionResponseDto.status` (`'graded' | 'submitted'`). Updated `TRUNCATE TABLE` in `seed.ts` and `points-ledger.integration.spec.ts` to include `"grade_revisions", "grades"` alongside `"classroom_items", "student_purchases", "point_transactions"` and added `SubmissionFile`/`Submission`/`Option`/`Question`/`Activity` cleanup in `seed.ts`.
  - **`GradesModule`, `GradesService`, controllers & DTOs (`apps/api/src/grades/`):**
    - `POST /submissions/:submissionId/grade` (`201`): staff-only (`#26` isolation), strict DTO validation (`0..100`, `VisibleText` `1..5000`, `forbidNonWhitelisted`), locks `activities (FOR SHARE)` -> `submissions (FOR UPDATE)`, rejects non-`FILE` or already-graded submissions (`409`), credits `PointsLedgerService` when `pointsAwarded > 0` (`submission_grade`), appends `GradeRevision` v1, records student-only `grade_posted` outbox notice, and catches `P2002` strictly outside `$transaction`.
    - `PATCH /submissions/:submissionId/grade` (`200`): optimistic concurrency via `version`, locks `grades (FOR UPDATE)`, supports `0`-to-positive initial `credit`, signed `compensate` (`409` on negative balance), and `delta === 0` no-ledger regrades, appending `GradeRevision` and `grade_posted`.
    - `GET /submissions/:submissionId/grade` (`200`): readable by classroom staff (preserved after student departure), active owning student, and active linked parent (`!adultMode`), returning `403` to classmate students and `404` otherwise, with zero storage keys or signed URLs.
    - `GET /classrooms/:id/submissions` (`200`): staff-only `RepeatableRead` paginated queue filtering by `activityId` and `state`, sorted by `submittedAt`/`gradedAt` with `+id` tiebreaker.
  - **Docs, OpenAPI & tests:** Added `D18` in `docs/technical-justification.md`, updated `rules/data.md`, `docs/submissions.md`, `README.md`, added `docs/grading.md`, regenerated `apps/api/openapi.json`, and added unit (`grades.spec.ts`, `grade-schema.spec.ts`), integration/concurrency (`grades.integration.spec.ts`), `#26` HTTP (`grades.http.spec.ts`), and `openapi.spec.ts` specs.
- **Verification observed (2026-11-15):**
  - `prisma:migrate:deploy` (`14` migrations including `20261116000000_create_grades`) and `ALLOW_DESTRUCTIVE_SEED=true prisma:seed` against isolated PostgreSQL `grades_test_isolated` (`127.0.0.1:5433`, dropped afterward) — passed.
  - Real PostgreSQL & Supertest run (`--no-file-parallelism`) across 10 files (`grades.spec.ts` `12/12`, `grade-schema.spec.ts` `3/3`, `grades.integration.spec.ts` `8/8`, `grades.http.spec.ts` `4/4`, `points-ledger.integration.spec.ts` `10/10`, `submissions.http.spec.ts` `16/16`, `submissions.integration.spec.ts` `39/39`, `submissions-read.integration.spec.ts` `20/20`, `openapi.spec.ts` `10/10`, `api-config.spec.ts` `137/137`) — passed **259/259 tests, 0 skipped**.
  - `prisma:generate`, `openapi:export`, `lint`, `typecheck`, `build`, `format:check`, `python scripts/ci/check_docs.py` (`75 files`), and `git diff --check` — passed (exit 0).
- **Next step:** Stage, commit in logical commits (without AI attribution), push `feat/32-grade-submissions`, and open PR targeting `develop` once confirmed by the user.

## 2026-11-14 — Classroom shop catalog, overrides, and atomic purchases (Issue #34)

- **Status:** completed
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261114000000_create_classroom_shop/`, `apps/api/prisma/seed.ts`, `apps/api/src/config/api-config.ts`, `apps/api/src/config/api-config.spec.ts`, `apps/api/.env.example`, `apps/api/src/shop/`, `apps/api/src/points/points-ledger.integration.spec.ts`, `apps/api/src/app.module.ts`, `apps/api/src/openapi/openapi.spec.ts`, `apps/api/openapi.json`, `rules/data.md`, `docs/shop.md`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #34 (`HU-GAM-003: Purchase classroom shop items`) on `feat/34-shop-purchases`:
  - **Prisma schema & additive migration (`20261114000000_create_classroom_shop`):**
    - Added `ShopItemKind` (`classroom_item`, `avatar_accessory`, `desk_upgrade`, `pet_accessory`) and `ClassroomItemState` (`unlocked`, `active`, `disabled`) enums.
    - Added `ShopItem` (`shop_items`), `ClassroomShopItem` (`classroom_shop_items` with `(classroomId, shopItemId)` unique, optional positive `priceOverride`, and `isEnabled`), `StudentPurchase` (`student_purchases` with unique constraints on `(classroomId, studentId, shopItemId)` and `(classroomId, studentId, idempotencyKey)`), and `ClassroomItem` (`classroom_items` with `(classroomId, shopItemId)` unique), all with `ON DELETE RESTRICT` foreign keys and PostgreSQL `CHECK` constraints (`default_price > 0`, `price_override IS NULL OR price_override > 0`, `price_paid > 0`, trimmed non-empty `code`, `name`, `idempotency_key`).
  - **Seed reset & synthetic catalog (`apps/api/prisma/seed.ts`):**
    - Updated cleanup order to `TRUNCATE TABLE "classroom_items", "student_purchases", "point_transactions"` together (respecting the new restrictive foreign key from `student_purchases` to `point_transactions`) before deleting `classroomShopItem`, `shopItem`, and `classroom`.
    - Seeded synthetic `isImplemented: true` items (`cap_blue`, `headphones_studio`, `glasses_round`, `backpack_explorer`, `desk_plant`, `classroom_theme_warm`) and `isImplemented: false` items (`minigame_pong`, `pet_scarf`) under `assertSafeToSeed`.
  - **`ShopModule`, `ShopController`, `ShopService`, `ShopPurchaseRateLimiter` (`apps/api/src/shop/`):**
    - Wired `ShopModule` into `AppModule` and added `SHOP_PURCHASE_RATE_LIMIT_WINDOW` / `SHOP_PURCHASE_RATE_LIMIT_MAX` to `ApiConfig` (`.env.example`, `README.md`).
    - Student-only endpoints (`verifyClassroomAccess(..., { requiredRole: 'STUDENT' })`): `GET /classrooms/:id/shop/items` (kind filter, `parseSort` over `defaultPrice` | `name` | `createdAt` + `id` tiebreaker, effective price & ownership flags), `GET /classrooms/:id/shop/purchases` (`parseSort` over `createdAt` | `pricePaid` + `id` tiebreaker), and `POST /classrooms/:id/shop/purchase`.
    - Atomic purchase flow inside `prisma.$transaction`: locks `classroom_memberships` `FOR UPDATE OF cm`, resolves idempotent replay by `(classroomId, studentId, idempotencyKey)` (`200 OK`, `replayed: true`, `409 Conflict` if `shopItemId` differs) before debiting, locks `shop_items` `FOR SHARE` with `classroom_shop_items` override (`404` when inactive/disabled, `409` when `!isImplemented`), verifies unique ownership (`409`), derives `shop:<sha256>` ledger key, calls `PointsLedgerService.debit`, inserts `StudentPurchase` (and `ClassroomItem` with `ACTIVE` state for `CLASSROOM_ITEM`), maps `P2002` to `409 Conflict`, and logs non-PII `shop_item_purchased`.
  - **Docs, OpenAPI & tests:**
    - Updated `rules/data.md`, added `docs/shop.md` (linked in `README.md`), regenerated `apps/api/openapi.json`, and added `shop.spec.ts` (14 unit tests), `shop.integration.spec.ts` (10 PostgreSQL concurrency/atomicity/rollback/CHECK tests), `shop.http.spec.ts` (4 Supertest auth matrix, `#26` `assertResourceAuthorization`, validation/tampering, catalog override/filtering isolation, replay, rate-limit `429` tests), and OpenAPI contract checks in `openapi.spec.ts`.
    - Updated the `TRUNCATE` reset integration test in `points-ledger.integration.spec.ts` to truncate `"classroom_items", "student_purchases", "point_transactions"` together.
- **Verification observed (2026-11-14):**
  - `pnpm.cmd --dir backend --filter @aula/api prisma:migrate:deploy` against isolated PostgreSQL 16 `aula-postgres` (`127.0.0.1:5433`, database `shop_test_isolated`, dropped afterward) — passed: all 12 migrations applied cleanly.
  - `ALLOW_DESTRUCTIVE_SEED=true pnpm.cmd --dir backend --filter @aula/api prisma:seed` against `shop_test_isolated` — passed (`Seed applied successfully with synthetic school domain data.`).
  - `pnpm.cmd --dir backend --filter @aula/api exec vitest run src/shop/shop.spec.ts src/shop/shop.integration.spec.ts src/shop/shop.http.spec.ts src/points/points-ledger.spec.ts src/points/points-ledger.integration.spec.ts src/points/points.http.spec.ts src/openapi/openapi.spec.ts src/config/api-config.spec.ts --no-file-parallelism` against `shop_test_isolated` — passed **201/201 tests across 8 files** (`shop.spec.ts` 14/14, `shop.integration.spec.ts` 10/10, `shop.http.spec.ts` 4/4, `points-ledger.spec.ts` 33/33, `points-ledger.integration.spec.ts` 10/10, `points.http.spec.ts` 6/6, `openapi.spec.ts` 8/8, `api-config.spec.ts` 116/116).
  - `pnpm.cmd --dir backend lint` (`eslint .`), `pnpm.cmd --dir backend typecheck`, `pnpm.cmd --dir backend build`, and `pnpm.cmd --dir backend openapi:export` — passed (exit 0).
  - `pnpm.cmd --dir backend exec prettier --check ...`, `python scripts/ci/check_docs.py` (`71 files`), and `git -C backend diff --check` — passed (exit 0).
- **Next step:** Stage, commit in logical commits (without AI attribution), push, and open the PR targeting `develop` once approved by the user.

## 2026-11-14 — PR #87 review fixes for points ledger & seed reset (Issue #31)

- **Status:** completed
- **Area / files:** `apps/api/prisma/seed.ts`, `apps/api/src/points/points-ledger.service.ts`, `apps/api/src/points/points-ledger.spec.ts`, `apps/api/src/points/points-ledger.integration.spec.ts`, `docs/points-ledger.md`, `changelogs/tracker-luis.md`
- **Change:** Addressed PR #87 code-review feedback on `feat/31-points-wallet-ledger`:
  - **`apps/api/prisma/seed.ts` & `docs/points-ledger.md`:** Added `TRUNCATE TABLE "point_transactions"` before `deleteMany()` so dev/test seeding resets cleanly despite restrictive foreign keys and the `BEFORE UPDATE OR DELETE` immutability trigger, and documented that `TRUNCATE` is intentionally left unrestricted under `assertSafeToSeed`.
  - **`apps/api/src/points/points-ledger.service.ts`:**
    - Checked idempotent replay (`credit`, `debit`, `compensate`) before `lockActiveStudentMembership` so valid retries succeed even if the student later left the classroom.
    - Updated `readLockedBalance` to aggregate with `COALESCE(SUM("amount"), 0)::bigint` to prevent `int32` sum overflow.
    - Unified `RawPointRow`/`TransactionRow` into `PointRow` and extracted `POINT_ROW_RETURNING` and `insertIdempotentRow` (fixing `ON CONFLICT ("source_type", "source_id") WHERE "entry_kind" = 'earning' DO NOTHING`).
  - **Tests:** Added unit test for pre-lock replay in `points-ledger.spec.ts` (`33` tests) and integration tests for post-leave idempotent replay and `TRUNCATE TABLE "point_transactions"` in `points-ledger.integration.spec.ts` (`10` tests).
- **Verification observed (2026-11-14):**
  - `pnpm --dir backend --filter @aula/api typecheck` and `pnpm --dir backend --filter @aula/api build` — passed (exit 0).
  - `pnpm --dir backend exec eslint apps/api/src/points apps/api/prisma/seed.ts` and `prettier --check apps/api/src/points apps/api/prisma/seed.ts` — passed (exit 0).
  - `python scripts/ci/check_docs.py` — passed (`Documentation checks passed (70 files)`).
  - `pnpm --dir backend --filter @aula/api exec vitest run src/points/points-ledger.spec.ts src/points/points-ledger.integration.spec.ts src/points/points.http.spec.ts src/openapi/openapi.spec.ts --no-file-parallelism` (against isolated PostgreSQL 16 `aula-postgres` on `127.0.0.1:5433`, database `points_test_isolated`) — passed **56/56 tests** across 4 files (`33` unit, `10` DB integration, `6` HTTP, `7` OpenAPI).

## 2026-11-13 — Weighted points wallet and immutable ledger (Issue #31)

- **Status:** completed
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261113144500_create_point_transactions/`, `apps/api/src/points/`, `apps/api/src/app.module.ts`, `apps/api/src/classrooms/desks/desks.http.spec.ts`, `apps/api/openapi.json`, `docs/points-ledger.md`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #31 (`HU-GAM-001: Weighted points wallet and ledger`):
  - **Prisma schema & additive migration (`20261113144500_create_point_transactions`):**
    - Added `PointEntryKind` enum (`EARNING`, `DEBIT`, `COMPENSATION` mapped to `earning`, `debit`, `compensation`) and `PointTransaction` model (`point_transactions`) with restrictive foreign keys to `Classroom` and `User` (`studentId`, optional `actorId`) and indexes on `(classroomId, studentId, createdAt, id)` and `(studentId)`.
    - Added partial unique index `point_transactions_earning_source_uidx` on `(source_type, source_id) WHERE entry_kind = 'earning'`.
    - Added PostgreSQL `CHECK` constraints (`amount <> 0`, `earning => amount > 0`, `debit => amount < 0`, non-empty trimmed `reason` and `source_type`).
    - Added PostgreSQL `BEFORE UPDATE OR DELETE` trigger `point_transactions_immutable_trg` calling `prevent_point_transaction_mutation()` to reject any raw SQL mutation.
  - **`PointsModule` & `PointsLedgerService` (`apps/api/src/points/`):**
    - Wired `PointsModule` into `AppModule` and exported `PointsLedgerService` for future grading (`#32`) and shop (`#34`) producers.
    - `credit(input, tx?)`: locks the student's active `classroom_memberships` row `FOR UPDATE`, inserts idempotently with `INSERT ... ON CONFLICT ("source_type", "source_id") WHERE "entry_kind" = 'earning' DO NOTHING RETURNING ...` so duplicate earnings never abort an outer caller `$transaction` (`25P02`), and throws `ConflictException` if an earning source is reused with mismatched `(classroomId, studentId, amount)`.
    - `debit(input, tx?)`: locks the active student membership row `FOR UPDATE`, supports idempotent replay via `idempotencyKey` (rejecting mismatched parameters with `409 Conflict`), checks `COALESCE(SUM(amount), 0)::int - amount >= 0`, and inserts `-amount`.
    - `compensate(input, tx?)`: locks the active student membership row `FOR UPDATE`, supports `idempotencyKey`, enforces non-negative balance, allows multiple adjustments on the same `(sourceType, sourceId)`, and logs `points_compensation_recorded` with non-PII IDs (`classroomId`, `entryId`, `actorId`, `amount`, `sourceType`, `sourceId`).
    - `getBalance(classroomId, studentId, tx?)`, `getOwnWallet`, and `getStudentWallet`: expose internal balance lookup inside optional transactions, delegate HTTP authorization exclusively to `AccessVerificationService` (`verifyClassroomAccess(..., { requiredRole: 'STUDENT' })` and `verifyStudentResourceAccess(...)`), and read `(SUM(amount), count, rows)` in a `RepeatableRead` `$transaction` using `parseSort(query.sort, { allowed: ['createdAt', 'amount'], default: { field: 'createdAt', direction: 'desc' } })` with `{ id: sort.direction }` tiebreaker.
  - **`PointsController` & DTOs:**
    - Exposed `GET /classrooms/:id/points` and `GET /classrooms/:id/students/:studentId/points` returning `StudentWalletDto` (`classroomId`, `studentId`, `balance`, `items`, `page`, `pageSize`, `total`). No balance write or student-to-student transfer routes exist.
  - **Documentation, OpenAPI, merge-conflict cleanup & tests:**
    - Regenerated `apps/api/openapi.json` via `pnpm --filter @aula/api openapi:export`.
    - Added `docs/points-ledger.md` and linked it in `README.md`.
    - Removed the duplicate `realtimeInternalUrl` property at `apps/api/src/classrooms/desks/desks.http.spec.ts` left by merging #82 and #84 into `develop` (`d1646c4`).
    - Added `points-ledger.spec.ts` (32 unit tests), `points-ledger.integration.spec.ts` (8 PostgreSQL concurrency, idempotency, rollback, and trigger tests), and `points.http.spec.ts` (6 Supertest HTTP & authorization matrix tests).
- **Verification observed (2026-11-13):**
  - `pnpm --filter @aula/api prisma:migrate:deploy` (against isolated PostgreSQL 16 `aula-postgres` on `127.0.0.1:5433`, database `points_test_isolated`, dropped afterward) — passed: all 10 migrations applied on empty DB (and verified idempotent no-op earlier).
  - `pnpm --filter @aula/api typecheck` and `pnpm --filter @aula/api build` — passed (exit 0).
  - `pnpm --filter @aula/api exec vitest run src/points/points-ledger.spec.ts src/points/points-ledger.integration.spec.ts src/points/points.http.spec.ts src/openapi/openapi.spec.ts src/classrooms/desks/desks.http.spec.ts --pool=threads --maxWorkers=2 --minWorkers=1` — passed **73/73 tests** across 5 files against real PostgreSQL 16 (`32` unit in `points-ledger.spec.ts`, `8` DB integration in `points-ledger.integration.spec.ts`, `6` HTTP in `points.http.spec.ts`, `7` OpenAPI in `openapi.spec.ts`, `20` desks HTTP in `desks.http.spec.ts`).
  - `pnpm exec eslint apps/api/src/points apps/api/src/app.module.ts apps/api/src/classrooms/desks/desks.http.spec.ts` — passed (0 errors).
  - `pnpm exec prettier --check apps/api/src/points apps/api/src/app.module.ts apps/api/src/classrooms/desks/desks.http.spec.ts` — passed.
  - `python scripts/ci/check_docs.py` — passed (68 files) after final tracker update.
- **Reason:** Provide the immutable, server-owned points ledger and student wallet read API required by gamification (`#31`) and future grading (`#32`) and shop (`#34`) modules, while unblocking API build/typecheck on `develop`.
- **Next step:** Stage, commit (`feat(points): add immutable points ledger and student wallet (#31)`), and open PR targeting `develop` once approved by user.

## 2026-11-11 — Classroom member directory readable by members (Issue #52)

- **Status:** completed
- **Area / files:** `apps/api/src/classrooms/directory/`, `apps/api/src/classrooms/classrooms.module.ts`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #52 (`feat(classrooms): classroom member directory readable by members`):
  - Created `ClassroomDirectoryModule`, `ClassroomDirectoryController`, `ClassroomDirectoryService`, and `directory.dto.ts` under `apps/api/src/classrooms/directory/`.
  - Implemented `GET /classrooms/:id/members` providing public member cards (`id`, `userId`, `displayName`, `role`, `avatar`) for @mention autocomplete and classroom member list per Decision D12 (`rules/classrooms-and-roles.md:66-70`).
  - Contextual access verification via `AccessVerificationService`:
    - Enrolled students, classroom teachers, school owners, and school administrators are permitted (`list_directory` capability).
    - Linked parents receive `403 Forbidden` (`Classroom member directory is only accessible to classroom members`).
    - Strangers, foreign teachers, removed members, nonexistent classrooms, and invalid UUIDs receive uniform `404 NotFound` without existence leakage.
  - Queries active members (`state: ACTIVE`, `deletedAt: null`, `role in [STUDENT, TEACHER]`), dynamically includes independent teachers from `classroom.independentTeacherId` when active and deduplicates against memberships.
  - Case-insensitive prefix search via `q` query parameter, treating LIKE wildcard characters as literal prefix text.
  - Stable sort order by `displayName asc, id asc`.
  - Strict privacy protection: never leaks email, passwordHash, parent links, or grades.
  - Resilient avatar fallback: normalizes valid appearance via `avatarSnapshot` and falls back to `DEFAULT_AVATAR` for missing, null, or corrupted configurations.
  - Comprehensive testing suite:
    - Unit tests (`directory.spec.ts`) covering authorization matrix, role capabilities, independent teacher inclusion, prefix filtering, pagination, avatar fallback, and privacy.
    - HTTP tests (`directory.http.spec.ts`) validating status codes (200, 400, 401, 403, 404), parameter validation, and privacy.
    - PostgreSQL integration tests (`directory.integration.spec.ts`) validating end-to-end database filtering, pagination, removed member exclusion, and mandatory concurrent read safety via `Promise.all`.
  - Exported updated OpenAPI specification to `apps/api/openapi.json`.
- **Review refinements (PR #82 review, 2026-11-12):**
  - **School-teacher eligibility aligned with shared authorization:** `ClassroomDirectoryService.list` now filters `ClassroomRole.TEACHER` memberships by active `SchoolMember` status when `classroom.schoolId !== null` and validates listed memberships through `deriveClassroomAccessRole`, while preserving independent-teacher inclusion, deduplication, and enrolled-student visibility. Added unit and PostgreSQL regression coverage for an inactive school member with an active classroom `TEACHER` membership.
  - **Published ordering semantics in OpenAPI:** Updated `@ApiOperation` on `ClassroomDirectoryController.list` to state ascending `displayName` order with ascending `user id` tiebreaker (`localeCompare` semantics) per `rules/api-contracts.md`, and regenerated `apps/api/openapi.json`.
  - **Develop merge integration:** Merged `origin/develop` (`#25`, `#26`), resolved `apps/api/openapi.json`, and added the missing `realtimeInternalUrl` field to `apps/api/src/classrooms/desks/desks.http.spec.ts` so workspace `typecheck` passes with `ApiConfig`.
- **Reason:** Enable classroom members (students and teachers) to view their classmates and teachers for @mention autocomplete and class directory while enforcing strict privacy and contextual authorization boundaries.
- **Next step:** Review verification results, open pull request targeting `develop`, and update issue board status.

## 2026-11-09 — Classroom invitations, join codes, and desk assignment (Issue #22)

- **Status:** completed
- **Area / files:** `apps/api/src/classrooms/`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #22 (HU-AUL-002: Join a classroom through email invitation or access code/link):
  - Created `ClassroomInvitationsService`, `InvitationsController`, and extended `ClassroomsController` and `ClassroomsModule` with seven endpoints:
    - `POST /classrooms/:id/invitations`: issues single-use email invitation with SHA-256 hashed secret, target email, expiration, and outbox event dispatch (`classroom.invitation-created`) for asynchronous email delivery via `EmailPort`. Preserves complete non-disclosure of existing users.
    - `GET /classrooms/:id/invitations`: paginated list of email invitations filtered by status.
    - `DELETE /classrooms/:id/invitations/:invitationId`: revokes active email invitation.
    - `POST /classrooms/:id/join-code`: generates/regenerates shareable uppercase alphanumeric join code (7 Crockford Base32 characters); automatically revokes previous active join code; stores only SHA-256 hash and exposes raw code once upon generation.
    - `DELETE /classrooms/:id/join-code`: revokes active join code.
    - `POST /invitations/accept`: accepts opaque token from email invitation, binds authenticated account to classroom membership, and assigns available desk.
    - `POST /classrooms/join`: redeems join code, enforces sliding-window in-memory rate limiting against brute-force guessing (`429 TOO_MANY_REQUESTS`), creates membership atomically, assigns lowest available desk, and auto-expands desks dynamically (`(maxDeskIndex ?? 0) + 1`) when all default 12 desks are occupied.
  - Enforced idempotency: re-joining by an already enrolled student returns existing membership and desk without consuming extra uses.
  - Implemented transactional concurrency safety and tested with `Promise.all` for max-uses race conditions, duplicate user joins, and desk allocation.
  - Added unit test suites and PostgreSQL integration test battery (`*.spec.ts` and `*.integration.spec.ts`).
  - Exported updated OpenAPI specification to `apps/api/openapi.json`.
- **Review refinements (Issue #22 review):**
  - **CRIT-01 (Desk concurrency):** Replaced bare `tx.desk.update` in `assignDesk` with atomic conditional claim `tx.desk.updateMany({ where: { id: availableDesk.id, membershipId: null }, data: { membershipId } })`. If `claimed.count === 0`, retries with next available desk or auto-expansion with retry on `(classroomId, deskIndex)` collision, preventing desk clobbering.
  - **CRIT-02 (Atomic `useCount` increment & P2004 handling):** Enforced conditional atomic increment on `tx.invitation.updateMany` bounded by `useCount: { lt: maxUses }` and transitions state to `USED` upon reaching limit. Caught Prisma constraint error `P2004` alongside `P2002` mapping to `409 Conflict`.
  - **CRIT-03 & WARN-06 (Teacher invitation authorization):** Restricted `role === TEACHER` on `createEmailInvitation` to school `OWNER` and `ADMIN`, throwing `403 Forbidden` if requested by a classroom teacher per `rules/classrooms-and-roles.md:75`. In `acceptEmailInvitation`, upserted `SchoolMember(TEACHER)` for school classrooms to guarantee active school authority.
  - **CRIT-04 & WARN-04 (Soft-deleted school & classroom check):** Included `school: { select: { deletedAt: true } }` on classroom relations in `joinWithCode` and `acceptEmailInvitation`, uniformly throwing `404 NotFound` with identical opaque error message (`Invalid or expired join code` / `Invalid or expired invitation`) to avoid information leakage.
  - **CRIT-05 (Reactivate inactive/soft-deleted memberships):** Implemented reactivation inside `$transaction` for inactive or soft-deleted memberships upon re-joining or accepting an invitation, assigning an unallocated desk if none exists and preventing duplicate insertion crashes (`P2002`).
  - **WARN-05 (Staff enrollment prevention):** Rejected attempts by independent teachers, school owners, and school administrators to join as students via join code, throwing `409 Conflict` without consuming code uses.
  - **WARN-07 (Integration test hygiene):** Removed silent skips (`try { await prisma.$connect(); } catch { return; }` and `if (!testClassroom) return;`) in `classroom-invitations.integration.spec.ts`, failing fast if database is unreachable and guaranteeing `skipped: 0`.
  - **POL-01 & POL-02 (Crockford Base32 normalization & Revocation guard):** In `normalizeJoinCode`, mapped Crockford Base32 aliases (`O` -> `0`, `I`/`L` -> `1`). In `revokeInvitation`, validated that only `PENDING` invitations can be revoked, returning `400 BadRequest` if already used or revoked.
  - **Contract refinement (Raw token return & Role restriction):** Created `CreatedClassroomInvitationResponseDto` returning the raw `token` secret once on `POST /classrooms/:id/invitations` per Issue #22 scope, while `GET` list omits it. Blocked `OWNER` and `ADMIN` roles in `CreateClassroomInvitationDto` and `createEmailInvitation`, restricting classroom invitations strictly to `STUDENT` or `TEACHER`.
- **Review round 2 (PR #78 review):**
  - **Teacher invitations removed (out of scope for #22):** `POST /classrooms/:id/invitations` now accepts only `STUDENT` (`400` for any other role), and `acceptEmailInvitation` no longer creates or reactivates a `SchoolMember`; it always enrolls the account as a classroom `Student` and treats a non-student invitation as invalid. This supersedes the CRIT-03 teacher-authorization and `STUDENT` or `TEACHER` role-restriction items above. Teacher invitations belong to HU-AUL-004. OpenAPI regenerated.
  - **Invitation token no longer persisted in plaintext:** the `classroom.invitation-created` outbox payload now carries `encryptedToken` (`{ iv, authTag, ciphertext }`, AES-256-GCM, bound to the invitation id) instead of the raw token. The key is the new required `INVITATION_TOKEN_KEY` secret (32 bytes as hex or base64, validated in `api-config.ts`, documented in `.env.example`, `docker-compose.yml`, and the README). `ClassroomInvitationCreatedHandler` decrypts it right before calling `EmailPort`. Helper: `apps/api/src/platform/crypto/secret-box.ts`.
  - **Idempotent retry with an exhausted code or used invitation:** `joinWithCode` now recognizes an actively enrolled student before rejecting a `USED` or exhausted (`useCount >= maxUses`) join code, and `acceptEmailInvitation` does the same for a `USED` invitation. The existing membership and desk are returned without consuming another use; other users, removed members, and deleted classrooms or schools are still rejected. Covered by `maxUses: 1` integration tests.
  - **Atomic revocation:** `revokeInvitation` and `revokeJoinCode` now use a conditional `updateMany` filtered by `state: PENDING` and check the affected-row count, so a concurrently accepted (`USED`) invitation or exhausted code is never overwritten with `REVOKED`. When nothing matches, the invitation is re-read and the matching error (`404`, or `400` for already used, revoked, or expired) is returned. Covered by a stale-read unit test and acceptance-versus-revocation integration tests (both orders plus a `Promise.all` race asserting the invariant).
  - **Desk auto-expansion recorded as a decision:** documented in `rules/classrooms-and-roles.md` (Desk allocation) with its basis in RF-ESP-002 and HU-ESP-002 criterion 3: one assignable desk per enrolled student, no classroom capacity, clients render desks from backend data. The existing integration test covers the 13th and 14th students receiving desks 13 and 14 (indexes are 1-based). The `deskIndex` field description in OpenAPI now states the policy.
- **Reason:** Enable teachers and school administrators to invite students via email or shareable join codes, allocate 3D desks automatically with dynamic auto-expansion, and protect joining endpoints against brute force attacks.
- **Next step:** Open PR targeting `develop` and move card #22 to `In review` on GitHub Project 3.

## 2026-11-08 — Create and configure virtual classrooms (Issue #21)

- **Status:** in-progress
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261107231500_add_classroom_subject/`, `apps/api/src/classrooms/`, `apps/api/src/app.module.ts`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #21 (HU-AUL-001): added optional `subject` column (`VARCHAR(200)`) to `Classroom` via Prisma migration `20261107231500_add_classroom_subject`. Created `ClassroomsModule`, `ClassroomsController` (`POST /classrooms`, `GET /classrooms`, `GET /classrooms/:id`, `PATCH /classrooms/:id`), `MeClassroomsController` (`GET /me/classrooms`), and `ClassroomsService` integrated with `AccessVerificationService`. Implemented atomic classroom provisioning inside `prisma.$transaction`: creates `Classroom` with default control states (`adultMode: false`, `chatMuted: false`, `collaborationLocked: false`, `gamesDisabled: false`), default `ClassroomPet` (proposed defaults: `DEFAULT_PET_NAME = 'Michi'`, `DEFAULT_PET_SPECIES = 'cat'`, `level: 1`, `experience: 0`), `DEFAULT_INITIAL_DESK_COUNT = 12` unassigned `Desk` rows (`deskIndex` `1..12`), and `ClassroomMembership(TEACHER)` for school teachers (while deriving School Owner/Admin authority from `SchoolMember` without creating per-classroom memberships per `rules/data.md`). Enforced 401/403/404 status uniformity, `UUID_PATTERN` validation, and `adultMode` toggle preserving `ParentLink` rows in DB while immediately revoking parent access. Added unit, HTTP validation, and PostgreSQL integration tests including transactional rollback and `Promise.all` concurrency tests. Exported updated OpenAPI contract.
- **Reason:** Enable independent teachers and school staff to create, list, inspect, and configure persistent virtual classrooms and their initial 3D spatial/pet state.
- **Next step:** Open PR targeting `develop` and move card #21 to `In review` on GitHub Project 3.

## 2026-11-07 — Resource isolation and server-side access verification (Issue #19)

- **Status:** completed
- **Area / files:** `apps/api/src/auth/`, `apps/api/src/access/`, `apps/api/src/app.module.ts`, `apps/api/src/health.controller.ts`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #19 (HU-AUL-005): introduced global authentication guard (`SessionAuthGuard`) enforcing session validity by default, `@Public()` metadata decorator, `@CurrentUser()` / `@CurrentSession()` parameter decorator extracting validated session identity, and protected `/auth/logout` via the guard. Created `AccessModule` and `AccessVerificationService` enforcing server-side persisted state per request: `verifySchoolAccess` (active school membership, role checks, 404 on unknown school/stranger), `verifyClassroomAccess` (exact hierarchy: School Owner/Admin authority over all classrooms in their school without per-classroom membership, teacher on own classroom with 404 for another teacher's classroom in the same school, enrolled active student, active linked parent unless adult mode is active, 403 on insufficient role, 404 for stranger/cross-school isolation without existence leakage), and `verifyStudentResourceAccess` (own resource, staff, linked parent, 403 for classmate, 404 for stranger/unlinked parent). Added capabilities computation helper deriving exact permission matrix from `rules/classrooms-and-roles.md`. Added unit test suites for `SessionAuthGuard`, `CurrentUser`/`CurrentSession`, and `AccessVerificationService` including permission matrix, isolation, adult mode, and concurrency tests.
- **Review refinements (PR #71):** Protected all access methods against non-UUID string injection with `UUID_PATTERN` early-exit to guarantee 404s instead of PostgreSQL syntax 500s. Enforced that school teachers must hold an active `SchoolMember` status to retain classroom authority. Added HTTP integration test with Supertest (`session-auth.guard.http.spec.ts`) asserting global default-deny and `@Public()` route behavior. Added real PostgreSQL matrix tests (`access-verification.integration.spec.ts`). Deliberate design decision: `ADMIN` defaults to fail-closed without `manage_school` capability pending formal Owner-to-Admin delegation scope definition.
- **Reason:** Provide foundational security boundary and contextual authorization required by all virtual classroom endpoints (#21, #22, #23, etc.).
- **Next step:** Completed and merged into `develop` via PR #71.

## 2026-11-05 — Account registration and organizational path selection (Issue #17)

- **Status:** completed
- **Area / files:** `packages/contracts/src/index.ts`, `apps/api/package.json`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261105230000_add_user_registration_path/`, `apps/api/src/auth/`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #17 (HU-AUT-001): added `POST /auth/register` endpoint with atomic account creation supporting independent teacher and school paths. Exported `RegistrationPath` enum and constant array in `@aula/contracts`. Added new Prisma migration creating `registration_path` enum and column on `User` to persist the chosen organizational path. Implemented salted password hashing via bcrypt (10 rounds) and enforced password boundary limit of 72 UTF-8 bytes to prevent silent truncation. Handled school path atomically by creating `School`, automatic collision-resilient slug generation, and assigning `SchoolMember` with `OWNER` role. Created default empty `AvatarConfiguration`. Handled race conditions and uniqueness constraints returning 409 Conflict. Added comprehensive Vitest tests verifying DTO validation, UTF-8 byte boundary, transactional atomicity, persistence of registration path, and concurrent duplicate registrations (`Promise.all`). Updated OpenAPI spec.
- **Reason:** Implement account registration and path selection fulfilling HU-AUT-001, address PR #66 code review feedback, and enforce strict Definition of Done (DoD).
- **Next step:** Completed and merged into develop via PR #66.

## 2026-11-04 — Baseline Prisma schema and relational migrations (Issue #14)

- **Status:** completed
- **Area / files:** `apps/api/prisma/`, `apps/api/src/prisma/`, `apps/api/Dockerfile`, `.github/workflows/ci.yml`, `package.json`, `apps/api/package.json`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #14: set up Prisma ORM in `apps/api` with initial migration for baseline relational schema covering `User`, `Session`, `AvatarConfiguration`, `School`, `SchoolMember`, `Classroom`, `ClassroomMembership`, `Desk`, `ClassroomPet`, `ParentLink`, `Invitation`, and `JoinCodeUsage`. Enforced required database-level constraints: normalized unique email, single active owner per school partial index, exclusive ownership CHECK on `Classroom` (school OR independent teacher), invitation integrity CHECK (email required for email kind, absent for join codes with role student, use count <= max uses), and default Buenos Aires time zone. Created NestJS global `PrismaModule` and `PrismaService`. Added synthetic seed script (`prisma/seed.ts`). Authored comprehensive integration tests exercising all database constraints against PostgreSQL. Updated CI workflow with automated migration step and updated Dockerfile for container builds.
- **Reason:** Provide durable relational data model foundation, Prisma Client integration, and strict database constraint guarantees for subsequent domain modules.
- **Next step:** Merge PR for Issue #14 into develop, then proceed with authentication endpoints and session management.

## 2026-11-03 — Docker Compose local PostgreSQL and service Dockerfiles (Issue #13)

- **Status:** completed
- **Area / files:** `.dockerignore`, `docker-compose.yml`, `apps/api/Dockerfile`, `apps/realtime/Dockerfile`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #13 Docker setup: added root `.dockerignore` excluding dependencies, build artifacts, environments, and docs; created `docker-compose.yml` with health-checked PostgreSQL 16 on `127.0.0.1:5432` with the `aula_postgres_data` volume matching `apps/api/.env.example`, plus optional `api` and `realtime` containers under the `app` profile (no default for `INTERNAL_SERVICE_SECRET`, which is read from a git-ignored root `.env`); authored multi-stage `apps/api/Dockerfile` and `apps/realtime/Dockerfile` on `node:22-alpine` using Corepack pnpm, non-root `USER node`, container health checks, and monorepo contract building; and updated `README.md` with Docker Compose workflows.
- **Reason:** Enable local containerized PostgreSQL database service and production-ready container builds for API and realtime microservices.
- **Next step:** Merge PR for Issue #13 into develop, then proceed with Prisma baseline schema and migrations (Issue #14).

## 2026-11-03 — Extend CI with pnpm caching and PostgreSQL service container (Issue #11)

- **Status:** completed
- **Area / files:** `.github/workflows/ci.yml`, `README.md`, `changelogs/tracker-luis.md`, `.gitattributes`, `prettier.config.mjs`
- **Change:** Extended `.github/workflows/ci.yml` for Issue #11: added a health-checked `postgres:16-alpine` service container with test credentials and injected `DATABASE_URL` (ready for Prisma integration tests in #14); enabled Corepack and configured `pnpm` store caching via `actions/setup-node@v4`; added individual defensive step guards with `$GITHUB_STEP_SUMMARY` for formatting, linting, typecheck, testing, and building; configured `.gitattributes` (`* text=auto eol=lf`) keeping Prettier on default LF; and updated `README.md` to document the CI setup.
- **Reason:** Implement issue #11 to ensure fast, deterministic CI runs with package caching and real database integration test readiness.
- **Next step:** Merge PR #54 into develop, then implement typed environment configuration (Issue #12) and Docker Compose setup (Issue #13).

## 2026-11-02 — Address review feedback on monorepo bootstrap (Issue #10)

- **Status:** completed
- **Area / files:** `package.json`, `pnpm-lock.yaml`, `.gitignore`, `README.md`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `apps/api/`, `apps/realtime/`, `packages/contracts/`
- **Change:** Addressed all review comments on PR #10: untracked `.tsbuildinfo` files and added `*.tsbuildinfo` to `.gitignore`; resolved clean-clone typecheck by pointing `@aula/contracts` types at `./src/index.ts`; expanded `.github/workflows/ci.yml` to run `format:check`, `lint`, `typecheck`, `test`, and `build`; restored accurate notes and actionlint docs in `README.md`; exercised real Express app routes with `supertest` in realtime tests; upgraded Colyseus to `0.18.x`; separated NestJS bootstrap logic from `main.ts` with explicit `.catch()` error handling; and extended ESLint configuration with `js.configs.recommended` and `tseslint.configs.recommended`.
- **Reason:** Satisfy blocking and important PR review criteria before merging Issue #10 into develop.
- **Next step:** Merge PR #10 into develop, then proceed with configuration (#12) and Docker (#13).

## 2026-11-02 — Bootstrap pnpm monorepo (Issue #10)

- **Status:** completed
- **Area / files:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/api/`, `apps/realtime/`, `packages/contracts/`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Bootstrapped the backend monorepo with `pnpm` workspaces hosting `apps/api` (minimal NestJS application with `/health` endpoint), `apps/realtime` (minimal Colyseus server with `/health` endpoint and zero database dependencies), and `packages/contracts` (internal shared TypeScript interfaces). Configured root strict TypeScript base configuration (`tsconfig.base.json`), ESLint, Prettier, and Vitest smoke test suites across all packages. Pinned Node.js 22 and pnpm 10.
- **Reason:** Implement issue #10 and establish the foundational monorepo workspace for subsequent backend modules.
- **Next step:** Configure environment variables and Docker Compose for local PostgreSQL (Issues #12 and #13) and implement Prisma schema migrations (Issue #14).

## 2026-11-02 — Align ERS, User Stories, and Requirements Decisions with school niche (v0.3)

- **Status:** completed
- **Area / files:** `docs/requirements-decision.md`, `docs/functional-requirements.md`, `docs/user-stories.md`, `master-document.md`, `changelogs/tracker-luis.md`
- **Change:** Updated the functional requirements specification (ERS v0.2), user stories catalog (v0.2), and requirements decisions log to align 100% with the v0.3 **3D Virtual Classroom for Schools** model defined in `master-document.md` and `rules/`. Replaced the legacy office, room, and Kanban model with schools, classrooms, school-scoped roles (`Teacher`, `Student`, `Parent / Guardian`, `School Owner / Admin`), academic activities (`TP` and `Exam`), submissions, grading with transactional weighted points (`PointTransaction`), daily streak, badges, shop, classroom pet, live classroom tools, 2D Classic Mode, and the RAG Study Guide Bot over teacher-approved material.
- **Reason:** Eliminate the documentation drift between `docs/` functional specifications and the v0.3 school niche contract established in `master-document.md` and `rules/`.
- **Next step:** Align derived diagrams if needed and proceed with backend MVP Core implementation.

## 2026-11-02 — Fix documentation links and diagram references

- **Status:** completed
- **Area / files:** `docs/requirements-decision.md`, `docs/diagrams/`
- **Change:** Updated internal links and rule anchors across requirements decisions and architecture diagrams to align with realigned school domain rules (`classrooms-and-roles.md`, `activities-and-grading.md`, `communication-and-notifications.md`).
- **Reason:** Resolve broken link and anchor errors reported by `scripts/ci/check_docs.py`.
- **Next step:** Review backend architecture and proceed with implementation.
