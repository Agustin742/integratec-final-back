# Durable notification creation

`NotificationsModule` provides an import-ready, internal producer API. It records requests in the existing [transactional outbox](../apps/api/src/platform/outbox/outbox.writer.ts) and creates in-app notices only from committed events, after checking current access. Root module integration and the listing/read REST endpoints are the next work unit (T2); no endpoint is delivered by T1.

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

Access is checked from persisted state when the event is handled, not frozen when recorded. Denied candidates produce no notice and the event is successfully consumed; membership regained later does not automatically replay a consumed event. Creation uses the existing shared helper's consistency boundary: it does not claim serializable coordination with a simultaneous membership change. T2 must recheck access on every read/mutation, including child context, rather than trusting creation-time access.

## Commit, replay and delivery

The registered handler loads the event by its UUID from the database before acting. A callback supplied an uncommitted event ID cannot read it through another connection. Rollback removes the request along with the originating mutation; the dispatcher only sees committed outbox rows. No new queue, timer or shared outbox implementation is introduced.

Notification creation and its `in_app` delivery receipt are one transaction. Database uniqueness on `sourceEventId` prevents duplicate notifications; uniqueness on `(notificationId, channel)` prevents duplicate delivery receipts under replay or concurrent handlers. Conflict-ignore inserts preserve IDs, timestamps and read state. This deduplicates redelivery of the **same event**, not separate producer requests for the same resource. A malformed persisted payload throws a generic error for the existing bounded retry/exhaustion mechanism; it is never silently acknowledged as delivered.

Only `in_app` receipts are created. A receipt's `deliveredAt` means the durable in-app notice was created, not that a user viewed it or a live broadcast arrived. `email` remains a future channel, not an active sender or pending email job; no email row is automatically scheduled. No live `notification:created`, email provider, digest, opt-out or bounce policy is implemented ([scope and open decisions](../rules/communication-and-notifications.md#notifications)).

## Storage and T2 integration

| Choice | Rationale / next use |
|---|---|
| UUID IDs, `Timestamptz(6)` creation/update/read/delivery instants | Existing Prisma conventions; UTC API instants must later serialize as ISO 8601 |
| Nullable `readAt` | Null is unread; non-null records the read instant, without a redundant boolean |
| Nullable `studentId` | Distinguishes classroom content from private student context; never substitute a sibling |
| `kind` varchar(32), channel varchar(20) | Technical bounds comfortably cover the accepted intent/channel tokens; runtime kinds remain a finite allowlist, not free-form content |
| Index `(recipientId, createdAt, id)` | Supports deterministic newest-first ordering `createdAt DESC, id DESC`; UUID tie-breaker is opaque, not chronological |
| Restrictive foreign keys | Preserve history; no cascading deletion or retention policy is invented |
| Unique `sourceEventId` | One recipient/request; notification identity survives retries |

T2 must import `NotificationsModule` in the root app, add explicit DTOs/controllers and OpenAPI, and protect routes through existing session authentication. Filter by authenticated recipient **and current context before pagination and total counting**, and before marking one/all read. Another recipient's ID or a now-inaccessible notice must answer `404`. Use `NotificationsService.hasCurrentAccess` for the stored context, normalizing nullable `studentId` to an absent optional field. Do not use a classroom-only allowlist for child-specific records, or paginate first and filter a page afterward. Ordering above is the planned default, not a delivered REST contract.

## Verification and migration prerequisites

Use an explicitly supplied, disposable local PostgreSQL database through `DATABASE_URL`; never load a real environment file or default to a shared database. Existing dependencies and Prisma CLI must already be installed. Apply reviewed migrations and regenerate the client before tests:

```bash
pnpm --filter @aula/api prisma:migrate:deploy
pnpm --filter @aula/api prisma:generate
pnpm --filter @aula/api exec vitest run src/notifications/notifications.integration.spec.ts --pool=threads --maxWorkers=2 --minWorkers=1
pnpm --filter @aula/api typecheck
pnpm exec eslint apps/api/src/notifications
pnpm exec prettier --check apps/api/src/notifications
python scripts/ci/check_docs.py docs/notifications.md
```

The new migration creates only empty notification/delivery tables, their indexes and foreign keys. It does not rewrite or delete data. Normal foreign-key DDL may take short locks on referenced tables: schedule deployment accordingly. If application rollout is stopped, leave the additive tables in place and revert application integration; no destructive down migration is provided. Integration tests append synthetic UUID-scoped records, do not delete existing fixtures, and require the caller to dispose of the task database afterward. They prove commit/rollback, current access, child/adult-mode isolation, replay/concurrent handler uniqueness and retry behavior. They do not prove live delivery, REST recovery, email sending or production deployment.
