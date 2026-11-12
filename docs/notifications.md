# Notification center

`NotificationsModule` is wired into the root API. It provides authenticated listing and persistent read state, plus an internal producer API that creates notices from committed [transactional outbox](../apps/api/src/platform/outbox/outbox.writer.ts) events after checking current access. No feature producer, frontend, live push or email sender is implemented.

## REST quick path

Send the existing session access token as `Authorization: Bearer <access token>` on every route. Recipient identity comes exclusively from the verified session.

| Request | Success | Behavior |
|---|---|---|
| `GET /notifications?page=1&pageSize=20` | `200 { items, page, pageSize, total }` | Own currently accessible notices, newest first: `createdAt DESC, id DESC` |
| `PATCH /notifications/:id/read` | `200` notification object | Mark one visible notice read; replay returns its original `readAt` |
| `PATCH /notifications/read-all` | `200 { updated: number }` | Mark every visible unread notice, across pages; count only changed rows, replay returns zero |

PATCH requests need no body. The explicit collection route `read-all` avoids interpreting a magic ID as a bulk operation. Ordering is fixed: timestamps descend, with descending opaque UUIDs breaking ties, not implying chronological UUID order. Offset pages may shift when new notices arrive; refetch to reconcile. `page` defaults to 1 (range 1–10,000), `pageSize` to 20 (range 1–100), using the [shared pagination contract](api-conventions.md#pagination-and-sorting). Unsupported query parameters, including `sort` and recipient filters, return `400 VALIDATION_FAILED`.

Each item contains exactly `id`, `kind`, `resourceId`, `classroomId`, `studentId`, `readAt`, and `createdAt`. `studentId` is explicitly null for classroom-wide context; `readAt` is null until read. Instants are ISO 8601 UTC. No recipient ID, event ID, delivery state, raw content, grade or email is exposed. The source endpoint must independently authorize detail access; this navigation object never grants that permission.

Missing/invalid credentials return `401 UNAUTHENTICATED`. Single-read requests with a malformed, nonexistent, other-recipient or now-inaccessible ID all return `404 NOT_FOUND` using the [shared error envelope](api-conventions.md). Rejected requests do not alter notices or counts. Empty/inaccessible collections return `200` with an empty list/zero count, not `404`. Mark-all leaves hidden and other-recipient rows unchanged.

## Current-access and read-state boundaries

Every request re-evaluates persisted access through `NotificationsService.hasCurrentAccess` and the shared authorization service, including exact child context, active child enrollment/link and adult mode. Parent announcements remain denied pending #37. School Owner/Admin authority is preserved without classroom enrollment. Nullable stored `studentId` is normalized to an absent optional value for the shared check.

Listing and mark-all group only the recipient's distinct `(classroomId, studentId, kind)` contexts. Each is checked once, with at most four concurrent shared-service calls, before constructing the database predicate used for counting, pagination or update. There is no page-then-filter operation or full-notice scan. This deliberately reuses the shared matrix rather than duplicating it in a notification-specific SQL policy. Cost and predicate size scale with distinct historical contexts, not notice count; exceptionally large context histories may eventually need a shared bulk authorization boundary. No new shared-access API or arbitrary visibility cap is introduced here.

Count and page rows share a repeatable-read transaction snapshot. Access checks precede that transaction and read mutations, matching the shared service's existing consistency boundary: they are not serializably coordinated with simultaneous membership/link/adult-mode changes. A change committed before a subsequent request is observed; a revocation racing an in-flight request is not claimed to cancel it. Source resources remain independently protected.

Read updates use `WHERE readAt IS NULL`, so overlapping single/all requests cannot replace the original non-null timestamp. Mark-all reports the database's actual affected-row count; single-read reloads the resulting row in its transaction. There is no unread-counter table to drift. Read state and retained history are never deleted when access is lost.

## Producer quick path

1. Import `NotificationsModule` into the producer's NestJS module and inject `NotificationRecorder`.
2. Resolve the source resource, classroom, recipient candidates and optional student context in the owning domain service. Authorize the business mutation there; never copy scope identifiers from an untrusted request without resolving them.
3. Call `record` once per candidate recipient **inside the same Prisma transaction** as the originating change. The returned UUID identifies the outbox request, not a notification.

```typescript
await prisma.$transaction(async (tx) => {
  // Apply the originating mutation here, after the owning service authorizes it.
  await notifications.record(tx, {
    kind: 'grade_posted',
    classroomId: resolvedClassroomId,
    resourceId: resolvedGradeId,
    recipientId: candidateUserId,
    studentId: resolvedStudentId,
  });
});
```

The variable `notifications` above is an injected `NotificationRecorder`. IDs must be UUIDs. No feature producer currently exists: this is an integration recipe, not an implemented grade/activity/chat feature. Do not call the recorder after commit or use a separate transaction: that would lose atomicity with the originating change. The producer owns source-resource authorization and mutation idempotency; recording twice creates two distinct events. There is no public creation endpoint.

## Payload and access contract

| Field | Meaning |
|---|---|
| `kind` | `activity_published`, `grade_posted`, `announcement`, or `mention`; only these currently supported intents are accepted |
| `classroomId` | Resolved source classroom; every notice is classroom-scoped |
| `resourceId` | Opaque source UUID for navigation; the source endpoint must independently authorize detail access |
| `recipientId` | Exactly one candidate user; access is checked again during handling |
| `studentId` | Optional exact student context; **required** for `grade_posted` |

The recorder validates a strict object: additional fields, non-UUID identifiers, unsupported kinds and grades without a student context are rejected before recording. Neither outbox payloads nor notifications contain text bodies, grades, child names, email addresses, arbitrary links or source snapshots. A future source service must not use this minimal navigation metadata as permission to reveal its underlying data. Source resources are polymorphic and do not yet have tables; `resourceId` intentionally has no foreign key. Other relational identifiers have restrictive foreign keys.

The [shared access service](../apps/api/src/access/access-verification.service.ts) remains the authority; there is no copied membership query or permission matrix. A notification with `studentId` uses `verifyStudentResourceAccess`, including active target enrollment, own-student isolation and the exact linked child. Others use `verifyClassroomAccess`. School Owner/Admin authority needs no classroom membership; unrelated schools, unrelated teachers, removed memberships and deleted contexts are denied. An operational database error is retried by the outbox, not mistaken for denial.

Parent-role recipients can currently receive only child-specific grade notices. Classroom mentions and activities do not grant parents classroom-content access. Parent announcement delivery is explicitly deferred until issue #37 resolves visibility, **even when a child context is supplied**. This does not globally reject accounts that are also parents: shared-service staff authority remains valid in its own context. Adult mode disables parent-derived delivery, while preserving staff/student authority. Inactive links and inactive children cannot grant access through another active sibling.

Access is checked from persisted state when the event is handled, not frozen when recorded. Denied candidates produce no notice and the event is successfully consumed; membership regained later does not automatically replay a consumed event. Creation uses the existing shared helper's consistency boundary: it does not claim serializable coordination with a simultaneous membership change. REST rechecks access on every read/mutation, including child context, rather than trusting creation-time access.

## Commit, replay and delivery

The registered handler loads the event by its UUID from the database before acting. A callback supplied an uncommitted event ID cannot read it through another connection. Rollback removes the request along with the originating mutation; the dispatcher only sees committed outbox rows. No new queue, timer or shared outbox implementation is introduced.

Notification creation and its `in_app` delivery receipt are one transaction. Database uniqueness on `sourceEventId` prevents duplicate notifications; uniqueness on `(notificationId, channel)` prevents duplicate delivery receipts under replay or concurrent handlers. Conflict-ignore inserts preserve IDs, timestamps and read state. This deduplicates redelivery of the **same event**, not separate producer requests for the same resource. A malformed persisted payload throws a generic error for the existing bounded retry/exhaustion mechanism; it is never silently acknowledged as delivered.

Only `in_app` receipts are created. A receipt's `deliveredAt` means the durable in-app notice was created, not that a user viewed it or a live broadcast arrived. `email` remains a future channel, not an active sender or pending email job; no email row is automatically scheduled. No live `notification:created`, email provider, digest, opt-out or bounce policy is implemented ([scope and open decisions](../rules/communication-and-notifications.md#notifications)).

## Storage choices

| Choice | Rationale / next use |
|---|---|
| UUID IDs, `Timestamptz(6)` creation/update/read/delivery instants | Existing Prisma conventions; UTC API instants serialize as ISO 8601 |
| Nullable `readAt` | Null is unread; non-null records the read instant, without a redundant boolean |
| Nullable `studentId` | Distinguishes classroom content from private student context; never substitute a sibling |
| `kind` varchar(32), channel varchar(20) | Technical bounds comfortably cover the accepted intent/channel tokens; runtime kinds remain a finite allowlist, not free-form content |
| Index `(recipientId, createdAt, id)` | Supports deterministic newest-first ordering `createdAt DESC, id DESC`; UUID tie-breaker is opaque, not chronological |
| Restrictive foreign keys | Preserve history; no cascading deletion or retention policy is invented |
| Unique `sourceEventId` | One recipient/request; notification identity survives retries |

The root app imports `NotificationsModule`; explicit DTO projections and OpenAPI decorators define the public contract. Existing global session authentication and `@CurrentUser` supply identity. Producer APIs and outbox event behavior are unchanged by REST integration.

## Verification and migration prerequisites

Use an explicitly supplied, disposable local PostgreSQL database through `DATABASE_URL`; never load a real environment file or default to a shared database. Existing dependencies and Prisma CLI must already be installed. Apply reviewed migrations and regenerate the client before tests:

```bash
pnpm --filter @aula/api prisma:migrate:deploy
pnpm --filter @aula/api prisma:generate
pnpm --filter @aula/api exec vitest run src/notifications/notifications.http.spec.ts src/notifications/notifications.integration.spec.ts --pool=threads --maxWorkers=2 --minWorkers=1
pnpm --filter @aula/api typecheck
pnpm --filter @aula/api openapi:export
pnpm --filter @aula/api exec vitest run src/openapi/openapi.spec.ts --pool=threads --maxWorkers=2 --minWorkers=1
pnpm exec eslint apps/api/src/notifications
pnpm exec prettier --check apps/api/src/notifications
python scripts/ci/check_docs.py docs/notifications.md
```

The new migration creates only empty notification/delivery tables, their indexes and foreign keys. It does not rewrite or delete data. Normal foreign-key DDL may take short locks on referenced tables: schedule deployment accordingly. If application rollout is stopped, leave the additive tables in place and revert application integration; no destructive down migration is provided. Integration tests append synthetic UUID-scoped records, do not delete existing fixtures, and require the caller to dispose of the task database afterward. They prove commit/rollback, current access, child/adult-mode isolation, replay/concurrent handler uniqueness and retry behavior. HTTP tests use the root app, real Prisma persistence and shared authorization with a session-identity override (not real JWT/session verification). They cover visible pagination/totals, exact child revocation, adult mode, staff authority, uniform rejection without writes, stable ordering, minimal projections, read replay/overlap and existing health/classroom routes. Concurrent requests exercise overlap but do not force database lock contention. They do not prove live delivery, email sending, production deployment or independent/full-workspace verification.
