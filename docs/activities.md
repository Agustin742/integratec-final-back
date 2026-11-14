# Activities (TP and exams)

`ActivitiesModule` lets classroom staff create, edit, publish and deactivate activities (practical work, "TP", and exams) in a classroom. Enrolled students see published activities and are notified when one is published. File submissions live in their own module ([File submissions](submissions.md)); grading, points and study material are **not** part of this module yet (see [Out of scope](#out-of-scope-and-follow-ups)). Authorization comes from the shared `AccessVerificationService` (see [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md)); the academic rules are in [Activities and grading](../rules/activities-and-grading.md).

An activity is an academic assignment. It is **unrelated** to `ActivityMetric` (the per-user, per-classroom, per-day aggregate of connected time described in [D14](technical-justification.md#d14-realtime-presence-and-movement-policy)); the two share only a word.

## Data model

| Table | Purpose |
|---|---|
| `activities` | One row per activity: `type`, `format`, `state`, `title`, `description`, `opensAt`, `dueAt`, `allowLate`, `maxScore`, `weightMultiplier`, `publishedAt`, `createdById`, `deletedAt` |
| `questions` | Multiple-choice questions of an activity, ordered by `position` (unique per activity) |
| `options` | Answer options of a question, ordered by `position` (unique per question), with `isCorrect` |

Enums: `type` is `TP` or `EXAM`; `format` is `FILE` or `MULTIPLE_CHOICE`; `state` is `DRAFT` or `PUBLISHED`. `type` and `format` are immutable after creation. Instants are `timestamptz` and stored in UTC.

Database `CHECK` constraints back the rules the service already enforces, so a row written any other way cannot break them:

- `max_score` between 0 and 100;
- `weight_multiplier` between 0.5 and 3;
- `opens_at` is null or strictly before `due_at`;
- a `published` row always has `published_at`.

**Logical deletion.** `DELETE` sets `deletedAt` (RN-18); rows, questions and options are never physically removed, so history survives once submissions and grades exist. Deactivated activities are never listed or returned and behave as not found.

## Endpoints

All routes live under `/classrooms/:id/activities`, require a Bearer session and use the [shared error envelope](api-conventions.md). `:id` and `:activityId` are UUIDs. The generated contract is in `apps/api/openapi.json`.

| Request | Who | Success | Notes |
|---|---|---|---|
| `POST /classrooms/:id/activities` | Teacher-level staff | `201` teacher view | Creates a `DRAFT` |
| `GET /classrooms/:id/activities` | Staff, students | `200 { items, page, pageSize, total }` | Summaries without questions |
| `GET /classrooms/:id/activities/:activityId` | Staff, students | `200` teacher or student view | Role-dependent shape |
| `PATCH /classrooms/:id/activities/:activityId` | Teacher-level staff | `200` teacher view | Partial; `questions` replaces all |
| `POST /classrooms/:id/activities/:activityId/publish` | Teacher-level staff | `200` teacher view | No body; one way, `DRAFT` to `PUBLISHED` |
| `DELETE /classrooms/:id/activities/:activityId` | Teacher-level staff | `204` | Logical deactivation |

"Teacher-level staff" means school Owner or Admin, the classroom's school teacher, or its independent teacher.

| Status | Meaning |
|---|---|
| `400` | Validation failed (`VALIDATION_FAILED` with per-field `details`), or the activity is not publishable |
| `401` | Missing or invalid session |
| `403` | The classroom is visible to the caller but the role is not allowed: a student on a mutation, or a linked parent on any activity route |
| `404` | Malformed UUID, unknown or foreign classroom or activity, a deactivated activity, a draft requested by a student, or a stranger |
| `409` | Publishing an activity that is already published; `PATCH` with `questions` and `DELETE` once a submission exists (reason in `details`, see [Concurrency](#concurrency)) |

Linked parents are not part of the activity row of the permission matrix (they only see the grades of their linked child), so they receive `403`; the matrix is not extended here.

## Teacher and student views

- **Teacher view** (create, update, publish, and reads by staff): every summary field plus `createdById` and `questions[].options[]` including `isCorrect`.
- **Student view** (reads by students): the same summary fields and questions, but **no `isCorrect` anywhere**. The student query never selects the column, and the student DTO has no such property, so the answer key cannot leave the database or be serialized by mistake. See [Data](../rules/data.md).
- **Drafts are hidden from students.** Students list and read published activities only; a draft id returns `404`. Their `state` filter is ignored (it is not an error), so they cannot probe drafts.
- **Staff** see drafts and published activities and may filter the list with `state`.

Summary fields: `id`, `classroomId`, `type`, `format`, `state`, `title`, `description`, `opensAt` (nullable), `dueAt`, `allowLate`, `maxScore`, `weightMultiplier` (JSON number), `publishedAt` (nullable), `timeZone`, `questionCount`, `createdAt`, `updatedAt`.

## Validation

| Field | Rule |
|---|---|
| `title` | Required, trimmed, 1-120 characters, visible text |
| `description` | Optional, at most 5000 characters, default empty |
| `type`, `format` | Required enums on create; not accepted on `PATCH` |
| `dueAt` | Required ISO 8601 instant **with an explicit offset** (`Z` or `+hh:mm`); stored as UTC |
| `opensAt` | Optional, `EXAM` only (a TP has no `opensAt`), ISO 8601 with offset, strictly before `dueAt` |
| `allowLate` | Optional boolean, default `false` |
| `maxScore` | Integer 0-100 |
| `weightMultiplier` | Number 0.5-3 with at most 2 decimals, default `1` |
| `questions` | Required for `MULTIPLE_CHOICE` (1-50), forbidden for `FILE` |
| `questions[].prompt` | Trimmed, 1-1000 characters |
| `questions[].options` | 2-6 options, each label 1-500 characters, **exactly one** with `isCorrect: true`; array order is the display order |
| `sort` (list) | `dueAt` (default, ascending), `-dueAt`, `createdAt`, `-createdAt`; `id` is always the tiebreaker |
| `page`, `pageSize` | Shared [pagination contract](api-conventions.md#pagination-and-sorting) |
| `state` (list) | `DRAFT` or `PUBLISHED`; staff only |

Explicit `null` is rejected on every optional field (including `opensAt` on `PATCH`), so `opensAt` cannot be removed once set. Unknown properties are rejected. The cross-field rules (`opensAt` only on exams and before `dueAt`) are checked against the **merged** state on `PATCH`, so a partial update cannot create an invalid window. The limits are the single `ACTIVITY_LIMITS` constant in `apps/api/src/activities/activities.dto.ts`.

## Publishing

`POST .../:activityId/publish` runs in **one database transaction**:

1. Lock the activity row (`SELECT ... FOR UPDATE`, scoped by id, classroom and not deactivated).
2. Return `409` if it is already published.
3. Require `dueAt` to be in the future (`400` on `dueAt` otherwise) and, for multiple choice, 1-50 questions each with 2-6 options and exactly one correct (`400` on `questions`). The same server instant stamps `publishedAt`.
4. Set `state = PUBLISHED`.
5. Record one `activity_published` notification per recipient through `NotificationRecorder.record(tx, ...)`.

Recipients are the **active students** of the classroom (`AccessVerificationService.listActiveStudentIds`), excluding the acting user. Notifications are written to the [transactional outbox](../apps/api/src/platform/outbox/outbox.writer.ts) inside the same transaction, so they exist if and only if the publish commits and are delivered after the commit (see [Notification center](notifications.md)). A failure while recording rolls back the state change: the activity stays a draft and no event exists. Concurrent publishes are serialized by the row lock: one wins with `200`, the other re-reads `PUBLISHED` and gets `409`, so each student is notified once.

Publishing is one way: there is no unpublish.

## Concurrency

`PATCH` and publish take the same row lock before reading the state they overwrite, so concurrent writers are serialized rather than racing. A `PATCH` queued behind a `DELETE` returns `404` and never writes to the deactivated row; two `PATCH` requests that are each valid alone but not together produce one `200` and one `400`, never a `500` from a database `CHECK`; concurrent question replacements never interleave. `DELETE` waits for a pending lock and then deactivates.

**Submission lock.** `PATCH`, publish and `DELETE` all take `FOR UPDATE` on the row (`DELETE` used to be a bare update and now does too); a submission takes `FOR SHARE` on it ([File submissions](submissions.md#concurrency)). After the lock, `PATCH` with `questions` returns `409` (field `questions`) and `DELETE` returns `409` (field `state`) if any submission exists, so a submit cannot commit between the check and the write. Title, description, dates, `allowLate`, `maxScore` and `weightMultiplier` stay editable. A `FILE` activity carries no questions, so the questions lock is reachable once multiple choice answers exist (#47); the deletion lock applies to every format.

## Time zone

Instants are stored in UTC and returned as ISO 8601 UTC ([D10](technical-justification.md#d10-deadline-time-zone)). Each response also carries `timeZone`, the IANA zone of the classroom's school, falling back to `America/Argentina/Buenos_Aires` for independent teachers and schools without one. Clients render deadlines in that zone; the server decides lateness on UTC instants. See [Data and time](../rules/data-and-time.md).

## Decisions and defaults

Recorded as [D15](technical-justification.md#d15-activity-publishing-defaults) and approved on 2026-11-13:

- Deletion is always logical.
- Questions and options are editable until the first submission exists; the lock (`409`) landed with #30 (see [Concurrency](#concurrency)). An activity with submissions can no longer be deactivated either ([D16](technical-justification.md#d16-file-submission-defaults)).
- Defaults: title 1-120 characters, description at most 5000, 1-50 questions, 2-6 options with exactly one correct, `weightMultiplier` 0.5-3 defaulting to 1, an exam has an optional `opensAt` and a required `dueAt`, a TP has only `dueAt`, a single attempt, and the whole classroom as audience.

## Out of scope and follow-ups

- Study material upload (#46).
- The realtime `activity:published` event; its transport is still open. Only the persisted notification exists.
- Unpublishing a published activity.
- Multiple-choice answers and auto-grading (#47), grades (#32) and the points wallet (#31). File submissions are documented in [File submissions](submissions.md).

## Verification

```bash
# Supply DATABASE_URL for an isolated, migrated local PostgreSQL database first:
pnpm --filter @aula/api exec vitest run src/activities
```

`activities.dto.spec.ts` and `activities.http.spec.ts` need no database. The `*.integration.spec.ts` files need an explicitly supplied `DATABASE_URL` and cover the `CHECK` constraints, role-scoped views, concurrency and the atomic publish and notification behavior. Fixtures use dates relative to the current time, so the suite does not expire.
