# File submissions

`SubmissionsModule` lets an enrolled student hand in files for a published `FILE` activity (see [Activities](activities.md)) and lets the student and the classroom staff read the result. Multiple-choice answers (#47), grading (#32), points (#31) and the streak engine (HU-GAM-002) are **not** part of this module yet (see [Out of scope](#out-of-scope-and-follow-ups)). Authorization comes from the shared `AccessVerificationService`; the academic rules are in [Activities and grading](../rules/activities-and-grading.md) and the defaults are recorded as [D16](technical-justification.md#d16-file-submission-defaults).

## Data model

| Table | Purpose |
|---|---|
| `submissions` | One row per (activity, student): `submittedAt` (server clock), `isLate`, `idempotencyKey` |
| `submission_files` | Files of a submission: private `storageKey` (unique), `originalName`, `contentType`, `sizeBytes`, `position` |

`(activity_id, student_id)` is unique, so the database, not only the service, guarantees a single submission. `CHECK` constraints back the idempotency key length (1-255), file size (1 byte to 10 MB), position (0-4), name length (1-255) and the content type allow-list. Foreign keys are `RESTRICT`. The state of the student's work is derived from this row (`status: "submitted"`), never stored separately.

## Endpoints

All routes require a Bearer session and use the [shared error envelope](api-conventions.md). The generated contract is in `apps/api/openapi.json`.

| Request | Who | Success | Notes |
|---|---|---|---|
| `POST /activities/:activityId/submissions` | Students | `201` created, `200` idempotent replay | `multipart/form-data`, field `files` (1-5), header `Idempotency-Key` required |
| `GET /activities/:activityId/submissions/me` | Students | `200` | The caller's own submission with signed download URLs |
| `GET /submissions/:submissionId` | The submission's student, teacher-level staff | `200` | Signed download URLs |

"Teacher-level staff" means school Owner or Admin, the classroom's school teacher, or its independent teacher.

### Who gets which status

| Caller | `POST` and `GET .../me` | `GET /submissions/:id` |
|---|---|---|
| Enrolled student (own work) | `201`/`200`, or the rules below | `200` |
| Another student of the classroom | n/a (own submission only) | `404` |
| Teacher-level staff of the classroom | `403` | `200` |
| Linked parent | `403` | `404` (parents see the grade of the child, never the files) |
| Non-member, teacher of another classroom | `404` | `404` |
| Unknown, malformed, draft or deactivated activity; unknown submission | `404` | `404` |

`404` is used wherever a different status would reveal that an activity or a submission exists. A student who has not submitted yet gets `404 Submission not found` from `.../me`. Staff and parents are visible members of the classroom, so the upload route answers them `403` like the rest of the activity routes.

## File rules

- Accepted types: **PDF, PNG, JPEG and DOCX**, detected from the file **content** (magic bytes, via `file-type`). The client MIME type and the extension are never trusted; a plain zip or XLSX is rejected.
- At most **10 MB** per file, **1 to 5 files**, original name at most **255** characters (longer names are rejected, not truncated). Names are sanitized before being stored as metadata and are never part of the storage key.
- Violations (no files, empty file, unsupported type, invalid name) are `400 VALIDATION_FAILED` with per-file `details`.
- multer enforces the transport limits before the handler runs: a file over 10 MB is `413`; more than 5 files (or an unexpected field) is a generic `400 BAD_REQUEST`, not `VALIDATION_FAILED`.
- The limits live in `apps/api/src/submissions/submission-file-policy.ts` and mirror the database `CHECK` constraints; change both together.

## Submission window

The server clock decides, on UTC instants ([D10](technical-justification.md#d10-deadline-time-zone)). The clock is read once, after the activity lock, and stamps `submittedAt`.

| Situation | Result |
|---|---|
| Activity is multiple choice | `409` |
| Before `opensAt` (exams only) | `409` |
| After `dueAt`, `allowLate = false` | `409` |
| After `dueAt`, `allowLate = true` | stored with `isLate = true` |
| Otherwise | stored with `isLate = false` |

Every `409` carries the reason in the error `details` (`RequestConflictException`), so the envelope message stays fixed and nothing sensitive leaks.

## Idempotency

The `Idempotency-Key` header (1-255 characters, a UUID is recommended) is required; a missing or oversized key is `400`.

- Same key as the stored submission: `200` with that submission; nothing is uploaded or stored again, and the replay does not re-check the window.
- Different key once a submission exists: `409` ("You already submitted").
- Two racing requests: the unique index on `(activity_id, student_id)` decides; the loser re-reads the winner and gets `200` (same key) or `409`, never `500`.

A replay compares the key only, not the file contents.

## Storage

- Files go to the private bucket through the `StoragePort`; there is no public object access.
- Key shape: `submissions/<classroomId>/<activityId>/<studentId>/<fileId>`, ids only.
- Upload goes through the API (not a presigned PUT) so the server validates the real bytes before anything is stored. Uploads happen **outside** any transaction, then one short transaction writes the rows.
- Cleanup: on every path that stores no submission (upload error, transaction failure, lost race) the uploaded objects are deleted, best effort; a failed delete is logged and never replaces the original error.
- Download: reads sign each file URL through the storage port with `STORAGE_SIGNED_URL_TTL` (default 5 minutes) and return `downloadUrlExpiresAt`. Responses send `Cache-Control: no-store`, and never contain the storage key or the idempotency key.

## Concurrency

The submit transaction takes `SELECT ... FOR SHARE` on the activity row, then re-checks that the activity is still published and not deactivated, that the student is still enrolled, and the window. Teacher `PATCH`, publish and deactivate take `FOR UPDATE` on the same row ([Activities: Concurrency](activities.md#concurrency)). The effect:

- a teacher change waits for in-flight submits, and a submit queued behind one reads the committed result (for example `404` after a deactivation);
- students do not queue behind each other, so a deadline rush cannot outlast the transaction timeout; per-student uniqueness comes from the unique index.

## Events

A timely submission (`isLate = false`) records the outbox event `submission.submitted-on-time` in the same transaction as the row, so it exists if and only if the submission commits. Payload (version 1): `version`, `submissionId`, `activityId`, `classroomId`, `studentId`, `submittedAt` (ISO 8601 UTC); ids and an instant only. No event is recorded for late submissions, replays or the request that loses a race. Delivery is at least once, so consumers deduplicate on `submissionId`.

The dispatcher counts an event type without a handler as a failed attempt, so `SubmissionOnTimeHandler` is a **no-op** that acknowledges the event until the streak consumer arrives with HU-GAM-002. Events recorded before that consumer exists are acknowledged without effect, and there is no replay tooling for them: the streak backfill must read the `submissions` table (`isLate = false`), not the outbox.

## Related activity rules

Once any submission exists for an activity ([Activities](activities.md)):

- `PATCH` with `questions` is `409` (title, description and dates stay editable);
- `DELETE` is `409`, and deactivation now takes the row lock like `PATCH` and publish.

## Out of scope and follow-ups

- Resubmission and submission history (MVP is one submission per student and activity).
- Multiple-choice answers (#47), grading and grades (#32), points (#31) and the streak engine (HU-GAM-002).
- Malware scanning of uploads.
- Edge case: if the connection is lost after the transaction commits, the error path can delete objects of a stored submission. Accepted for the MVP; the unlikely window is documented, not mitigated.
- More than 5 files returns multer's generic `400 BAD_REQUEST` instead of `VALIDATION_FAILED`.
- Retention of submissions and files ([Data](../rules/data.md) leaves it open).

## Verification

```bash
# Supply DATABASE_URL for an isolated, migrated local PostgreSQL database first:
pnpm --filter @aula/api exec vitest run src/submissions
```

`submission-file-policy*.spec.ts`, `submission-schema.spec.ts` and `submissions.http.spec.ts` need no database. The `*.integration.spec.ts` files need an explicitly supplied `DATABASE_URL` and cover the `CHECK` constraints, access matrix, window, idempotency and races, locking, storage cleanup, signed reads and the outbox event. Storage is replaced by an in-memory `StoragePort` (`apps/api/src/testing/in-memory-storage.ts`).
