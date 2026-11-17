# Classroom announcements

Issue #37 adds the classroom bulletin board to the NestJS API. The backend owns publication, mention resolution and authorization; the frontend consumes the generated [OpenAPI contract](../apps/api/openapi.json). UI, live push, parent announcements and a production email provider are outside this card.

## Requests

Use the existing session token in `Authorization: Bearer <access token>`.

| Request | Success | Authority |
|---|---|---|
| `POST /classrooms/:classroomId/announcements` | `201` announcement | Classroom teaching staff or school Owner/Admin |
| `GET /classrooms/:classroomId/announcements?page=1&pageSize=20` | `200 { items, total, page, pageSize }` | Current students and teaching staff |
| `PATCH /classrooms/:classroomId/announcements/:announcementId` | `200` announcement | Author with current teaching authority, or school Owner/Admin |
| `DELETE /classrooms/:classroomId/announcements/:announcementId` | `204` | Same as edit; logical removal |

Create accepts `title` (single-line text, at most 200 characters) and `content` (plain text, at most 5,000 characters). Both are trimmed and must contain visible text; multiline content is allowed. PATCH accepts either field; explicit null is invalid. Extra fields are rejected. Identity and timestamps come from the server, never the body.

Responses contain `id`, `classroomId`, `authorId`, `title`, `content`, `mentionedUserIds`, `createdAt` and `updatedAt`. Dates are ISO 8601 UTC. Lists use the [standard pagination](api-conventions.md#pagination-and-sorting) with newest first (`createdAt DESC, id DESC`). Offset pages can shift after publication; refetch to reconcile.

Missing authentication returns `401`. Students cannot publish, edit or remove (`403`); another teacher cannot edit an author's notice (`403`). Foreign classroom/resource identifiers return `404`, without disclosing content. Parents have no announcement visibility under this card; parent-derived classroom access alone cannot read the board. Rejected mutations leave announcements, mentions and notification requests unchanged.

## Mentions and notifications

`@Display Name` is resolved case-insensitively against active classroom memberships, longest matching name first. Unresolved text stays plain text. Shared display names resolve every matching member of that classroom, never users from another classroom.

Alejo approved at most **20 distinct mentioned users per announcement** to bound notification flooding. Repeated mentions of one user count once; two users sharing a display name count twice. More than 20 rejects the entire mutation. This decision does not set the chat-message limit; see the [authoritative mention rule](../rules/communication-and-notifications.md#mentions).

Publication records the announcement, mentions, one announcement request per active student (excluding the author), and one mention request per mentioned member in one transaction. Editing updates mentions and notifies only newly mentioned users; it does not republish the announcement to every student. Removal keeps the row and mentions for history while hiding the notice from lists. Content also survives the author's departure.

The notification handler loads committed events and rechecks current access before creating in-app notices. Rollback creates no notification; removed members cannot receive new notices. [Notification-center REST](notifications.md) remains the source of truth; a notice is navigation metadata, not authorization to read the source.

## Email delivery boundary

Announcement email uses the existing transactional outbox with bounded retries/backoff and the `EMAIL_PORT` boundary. Publication does not call the provider. The committed notification schedules an email event containing only its identifier; delivery checks current recipient access and skips removed announcements. Email bodies and recipient addresses must not appear in diagnostics.

The delivery identity is `(notificationId, email)`. Retries must reuse that identity at the email-provider boundary, including when the provider accepted a message but its acknowledgement was lost. A database receipt alone cannot guarantee exactly-once delivery across an external call. The in-memory adapter is a test/development sink, not a production mail service; a future provider must honor the supplied idempotency key durably before production delivery can claim that guarantee.

## Verification prerequisites

Use an explicit disposable local PostgreSQL database through `DATABASE_URL`, apply migrations and regenerate Prisma before running the integration tests. Never load real credentials or run fixture cleanup against a shared database.

```bash
pnpm prisma:migrate:deploy
pnpm prisma:generate
pnpm --filter @aula/api exec vitest run src/announcements/announcements.integration.spec.ts src/platform/email/email.spec.ts --maxWorkers=1 --minWorkers=1
pnpm typecheck
pnpm openapi:export
```

The additive announcement migration creates empty tables, indexes and restrictive foreign keys; it does not rewrite stored data. Foreign-key DDL can briefly lock referenced tables. Leave these tables in place if application rollout is stopped; no destructive rollback is part of this card. Actual check results are recorded in [Alejo's tracker](../changelogs/tracker-alejo.md), not inferred from the existence of these commands.
