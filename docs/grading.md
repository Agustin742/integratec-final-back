# Submission grading and weighted points

`GradesModule` is wired into the root API. It enables authorized classroom staff to grade and regrade submitted `FILE` activities, atomically converts scores into weighted classroom points through `PointsLedgerService`, records student-only `grade_posted` in-app notification requests, and serves a paginated grading queue. Multiple-choice auto-grading (#47), parent/email notifications, and streak scoring remain out of scope.

## Data model

| Table | Purpose |
|---|---|
| `grades` | One row per `submission_id`: `score` (`0-100`), `feedback` (`1-5000` trimmed visible text), `points_awarded` (`>= 0`), `type_weight` and `weight_multiplier` (weights snapshotted at the initial grade), nullable unique `point_transaction_id`, optimistic `version` (`>= 1`), `grader_id`, `graded_at` |
| `grade_revisions` | Append-only history per `(grade_id, version)` storing `score`, `feedback`, `points_delta`, nullable unique `point_transaction_id`, and `grader_id` |

All foreign keys use `ON DELETE RESTRICT`. `SubmissionResponseDto.status` (`submissions.dto.ts`) derives `'graded' | 'submitted'` from `grade !== null`.

## Endpoints

All routes require a Bearer session and use the [shared error envelope](api-conventions.md). The generated contract is in `apps/api/openapi.json`.

| Request | Who | Success | Notes |
|---|---|---|---|
| `POST /submissions/:submissionId/grade` | Classroom staff (`OWNER`, `ADMIN`, assigned `TEACHER`) | `201` `GradeResponseDto` | Grades an ungraded `FILE` submission (`version: 1`) |
| `PATCH /submissions/:submissionId/grade` | Classroom staff (`OWNER`, `ADMIN`, assigned `TEACHER`) | `200` `GradeResponseDto` | Regrades with optimistic `version` check (`409` if stale) |
| `GET /submissions/:submissionId/grade` | Classroom staff, owning active student, active linked parent (`!adultMode`) | `200` `GradeResponseDto` | Never exposes storage keys or signed URLs; staff keep read access after student departure |
| `GET /classrooms/:id/submissions` | Classroom staff (`OWNER`, `ADMIN`, assigned `TEACHER`) | `200` `Paginated<GradingQueueItemDto>` | Optional `activityId`, `state` (`submitted` \| `graded`), and `sort` (`submittedAt` default asc, `gradedAt`, optional `-`) with `+id` tiebreaker |

### Access and existence isolation (#26)

- **Write routes (`POST` / `PATCH`):** Non-members, unassigned school teachers, deleted activities/classrooms/schools, `adultMode` parents, and parents linked only to another student in the classroom receive `404 NOT_FOUND`. Classroom students and parents linked to the submission's student receive `403 FORBIDDEN`.
- **Read route (`GET /submissions/:submissionId/grade`):** Classmate students receive `403 FORBIDDEN`. Out-of-scope actors, unlinked or `adultMode` parents, parents of removed students, deleted activities, and ungraded submissions for authorized callers receive `404 NOT_FOUND`. Classroom staff keep `200` read access even when the student membership is later deactivated ([Activities and grading](../rules/activities-and-grading.md#grades-and-weighted-points)).
- **Queue (`GET /classrooms/:id/submissions`):** Non-members, unassigned school teachers, `adultMode` parents, and unknown/deleted/foreign `activityId` filters receive `404 NOT_FOUND`. Classroom students and non-adult parents receive `403 FORBIDDEN`.
- **Departed students:** The queue lists only submissions of students with an active `STUDENT` membership, and `total` counts the same filtered set. `POST` and `PATCH` on a submission whose student is no longer an active student of the classroom fail up front with `409 CONFLICT` (field `submission`), whatever the score, points delta, or whether the regrade only changes feedback; nothing is written. Existing grades stay readable by staff.

## Weighted points conversion and ledger rules

- Weights come from validated configuration ([`ApiConfig`](../apps/api/src/config/api-config.ts)): `GRADE_WEIGHT_TP` (default `1`) and `GRADE_WEIGHT_EXAM` (default `1.5`, strictly greater than `GRADE_WEIGHT_TP`), combined with `activity.weightMultiplier` (`0.50-3.00`).
- **Weight snapshot:** The initial grade stores the `typeWeight` and `weightMultiplier` it used on `Grade`. Regrades compute points from that snapshot, never from the current activity weight or `GRADE_WEIGHT_*` configuration, so a regrade with an unchanged score never moves points.
- Calculation uses exact integer ten-thousandths arithmetic and half-up rounding (`Math.trunc((score * typeHundredths * activityHundredths + 5000) / 10000)`) so binary floating-point drift cannot misround boundary scores.
- **Zero-point skip:** When initial `pointsAwarded === 0`, no `PointTransaction` is inserted (`pointTransactionId = null`). If a later regrade increases points above zero (`pointTransactionId === null && delta > 0`), `PointsLedgerService.credit` creates the initial `EARNING` row and links it on both `Grade` and `GradeRevision`.
- **Regrade compensation:** When `delta !== 0` after an initial earning exists, `PointsLedgerService.compensate` appends a signed `COMPENSATION` entry (`sourceType: 'submission_grade'`, `sourceId: grade.id`), throwing `409` if `balance + delta < 0`. When `delta === 0`, no ledger entry is written.

## Concurrency and transaction order

- Write transactions acquire locks in strict deadlock-free order: `activities (FOR SHARE)` -> `submissions (FOR UPDATE)` -> (`grades (FOR UPDATE)` on `PATCH`) -> `classroom_memberships (FOR UPDATE OF cm)` inside `PointsLedgerService`.
- The active-student check runs inside the write transaction right after the submission lock, as a non-locking read through `AccessVerificationService.isActiveStudent`, so the lock order above is unchanged. `PointsLedgerService` still locks the membership row whenever points move.
- Unique-constraint conflicts (`P2002`) are caught only outside `$transaction` so PostgreSQL never sees follow-up queries on an aborted transaction (`25P02`).
- Each committed grade or regrade records a student-only `grade_posted` outbox request (`NotificationRecorder.record`) inside the same transaction. Parent notifications and email delivery remain out of scope.
- `GET /classrooms/:id/submissions` executes `activityId` validation, `count`, and `findMany` inside a single `RepeatableRead` transaction.

## Verification

Unit and schema tests run without a database; integration (`Promise.all` races, lock serialization with `ShopService.purchase`, rollback atomicity, `CHECK`/`RESTRICT` constraints, outbox materialization) and HTTP `#26` matrix tests require an isolated local PostgreSQL database through `DATABASE_URL`:

```bash
pnpm --filter @aula/api prisma:migrate:deploy
pnpm --filter @aula/api prisma:generate
pnpm --filter @aula/api exec vitest run src/grades/grades.spec.ts src/grades/grade-schema.spec.ts
pnpm --filter @aula/api exec vitest run src/grades/grades.integration.spec.ts src/grades/grades.http.spec.ts --no-file-parallelism
pnpm --filter @aula/api exec vitest run src/openapi/openapi.spec.ts src/config/api-config.spec.ts
```
