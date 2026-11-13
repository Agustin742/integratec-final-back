# Classroom student removal

Staff can remove a student's classroom membership without deleting the account or its history. The student's desk and parent access derived from that child are released atomically. Access through another active child or another classroom is preserved (confirmed by Alejo for issue #23).

## HTTP contract

`DELETE /classrooms/:id/students/:studentId` requires the existing bearer session. Both path values are UUIDs; `studentId` is a **user ID**, not a membership ID. There is no request or response body.

| Status | Meaning |
| --- | --- |
| `204` | Removed, or the student membership was already inactive/deleted |
| `401` | Missing or invalid session |
| `403` | Related student/parent without teacher authority |
| `404` | Malformed UUID, unknown/foreign classroom, or unknown/nonstudent target |

The shared authorization service grants access to School Owner/Admin and the classroom's Teacher. A teacher of another classroom receives `404`. The private [student roster](classroom-roster.md), not the D12 mention directory, retains the removed membership and historical guardian links for staff.

## Atomic lifecycle

One Prisma transaction:

1. Conditionally changes an ACTIVE, nondeleted student membership to INACTIVE and sets `deletedAt`.
2. Releases the Desk referencing that membership.
3. Deactivates ACTIVE ParentLinks for exactly that classroom and child; preserves all link rows.
4. Records the following transactional outbox event.

```json
{
  "type": "classroom.membership.removed",
  "payload": {
    "classroomId": "00000000-0000-4000-8000-000000000001",
    "membershipId": "00000000-0000-4000-8000-000000000004",
    "userId": "00000000-0000-4000-8000-000000000003"
  }
}
```

The realtime eviction handler consumes this event and closes the removed student's live connections in that classroom (same outbox retry budget as other evictions). Only the winning conditional transition records an event. Duplicate/concurrent losers do not rewrite timestamps or create events. A failure rolls back membership, desk, links and event together. Subsequent classroom HTTP reads return `404` for the student and a parent whose last active child link was removed.

Historical memberships already INACTIVE or with nonnull `deletedAt` are terminal no-ops, including legacy INACTIVE rows without `deletedAt`. Repeating DELETE does not repair pre-existing inconsistent desks/links, reactivate, or reenroll. Such repair requires separate authorization.

The existing OutboxDispatcher provides after-commit, at-least-once delivery; future consumers must deduplicate by outbox event ID. There is **no live transport consumer or active-room disconnect** in this issue. See [architecture](../rules/architecture.md) and [data lifecycle](../rules/data.md).

## Verification

The module is registered in `ClassroomsModule`; its generated contract is in `apps/api/openapi.json`.

```bash
pnpm --filter @aula/api exec vitest run src/classrooms/removal/classroom-removal.spec.ts
# Supply DATABASE_URL for an isolated, migrated local PostgreSQL database first:
pnpm --filter @aula/api exec vitest run src/classrooms/removal/classroom-removal.integration.spec.ts
```

The integration spec requires an explicitly supplied `DATABASE_URL` on localhost, a loopback address or the Compose `postgres` host; it never reads `.env` or falls back to a default database. It creates UUID-scoped synthetic fixtures atomically and cleans up only those exact rows, in foreign-key order. It does not provision infrastructure, migrate, seed or truncate tables.

Observed parent/writer evidence:

- Mock HTTP: observed RED, then final **20/20 passed**; authorization, idempotency and injected rollback-stage assertions.
- PostgreSQL HTTP: **3/3 passed**; student/parent access revocation, other-child/classroom isolation, historical roster retention, desk release, concurrent/repeated single event and rollback after a real event insertion.
- API typecheck passed after regenerating the existing Prisma client. The earlier stale-client errors remain recorded in Alejo's tracker rather than being counted as a pass.

The tests mock verified-session identity, not authorization or PostgreSQL transactions. Integration disables outbox polling: dispatcher delivery itself is not claimed here. Concurrent DELETE does not force lock contention or scheduling order. Desk/outbox effects need scoped database assertions because no public endpoints exist for them. Academic/message tables do not yet exist: tests prove retention of users, memberships and links, not persisted submissions, grades or messages. The implementation performs no hard delete or history rewrite. Full-workspace and independent-verifier evidence is recorded separately in [Alejo's tracker](../changelogs/tracker-alejo.md).
