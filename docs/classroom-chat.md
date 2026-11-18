# Classroom chat persistence

## Implemented storage foundation

`Message` stores plain text, author, creation/update instants, and optional hidden
actor/time audit fields. PostgreSQL enforces exactly one context: `classroomId`
**or** `parentLinkId`, never both or neither. The ParentLink alternative reserves
storage compatibility only; parent messaging is not implemented.

`hiddenAt` and `hiddenById` must be set together or both null. Moderation updates
state rather than physically deleting the row. Author, moderator and context
foreign keys use `RESTRICT`; there is no membership-owned cascading deletion.
Logical membership removal retains message text, attribution and mentions.

History indexes support stable `(createdAt, id)` ordering. A separate
`(classroomId, authorId, createdAt, id)` index supports persisted admission counts,
including hidden messages. No rate-limit table or automatic purge is added.

Mentions reuse the existing polymorphic `Mention` table with source type
`message` and the message id. The existing unique
`(sourceType, sourceId, mentionedUserId)` constraint deduplicates recipients;
announcement and forum source namespaces are unchanged. As with existing sources,
the polymorphic source is not a database foreign key. The send service writes
messages, resolved mentions and notification requests atomically.

## REST send

`POST /classrooms/:id/messages` requires a bearer session and current classroom
access. Students, classroom teachers, independent teachers and school Owner/Admin
may send. Linked parents receive 403; unrelated or removed users, foreign classrooms
and invalid/nonexistent classroom UUIDs receive 404.

The only accepted request field is `body`, for example `{ "body": "Hello @Teacher" }`.
Unknown fields, including client-supplied author/time/context metadata, return
400 `VALIDATION_FAILED`. Author and creation time always come from the server.
Successful sends return 201 with exactly `id`, `classroomId`, `authorId`, trimmed
`body`, distinct `mentionedUserIds`, and UTC ISO `createdAt`. Text is never rendered
as HTML; repeated resolved names count once and unresolved tokens remain text.

Failures use the standard error envelope with correlation id: 401
`UNAUTHENTICATED`, 403 `FORBIDDEN` for parents or muted students, 404 `NOT_FOUND`,
400 `VALIDATION_FAILED` with field details, or 429 `TOO_MANY_REQUESTS` on excess
admission. Rejected sends do not persist message/mention/outbox rows or consume quota.
The committed [OpenAPI contract](../apps/api/openapi.json) describes the route.

## Send application service

`ChatService.send` reuses shared access verification and the existing exported
announcement mention matcher. It rejects linked parents, invalid/blank text,
unsafe controls, excess length and more than 20 distinct roster matches. It reads
persisted mute state on every call; students are denied while staff may send.
Message, deduplicated mentions and notification outbox requests commit atomically.

A PostgreSQL transaction advisory lock serializes each normalized user/classroom
pair across service instances. After acquiring it, access is rechecked and the
classroom row is share-locked while mute state is read. The database clock is
sampled **after** waiting, at the millisecond precision persisted through Prisma.
Admission counts all messages (including hidden ones) newer than `now - 10s`;
the same `now` is persisted on acceptance. Five are admitted; excess sends fail
with 429 without consuming quota. No process-local admission state exists.
Membership checks follow the existing shared service semantics; they do not
promise instantaneous serialization against every concurrent external revocation.

Service tests use real access verification, independent Prisma clients and the
real outbox recorder. A downstream failure is injected to prove rollback. HTTP
tests exercise the registered application, validation, error envelope and real
persisted authorization; only session verification is mocked. They do not prove
JWT cryptography, session expiry or revocation behavior.

## Approved policy and remaining endpoint work

Alejo approved REST send, non-empty trimmed text up to 2,000 characters, at most
20 distinct mentioned users, and 5 messages per 10 seconds per user/classroom,
including staff. Excess admission returns HTTP 429. `chat-policy.ts` records the
constants; the send application service enforces these limits.

History and moderation endpoints remain subsequent work. Realtime delivery belongs to #48;
frontend, parent conversations and mute controls remain excluded. Final retention
policy is open; there is no purge.

See [communication rules](../rules/communication-and-notifications.md) and
[data rules](../rules/data.md) for the binding lifecycle and access requirements.

## Focused verification

Use Node 22, pnpm 10, generated Prisma Client, and migrated PostgreSQL 16 with
**only synthetic data in a dedicated disposable database**. Export `DATABASE_URL`
explicitly; no environment file is loaded. Never point these checks at shared data.

```sh
pnpm --filter @aula/api exec prisma validate
pnpm --filter @aula/api exec prisma generate
pnpm --filter @aula/api exec prisma migrate deploy
pnpm --filter @aula/api exec vitest run src/chat/chat-persistence.integration.spec.ts src/chat/chat-send.integration.spec.ts src/chat/chat-http.integration.spec.ts --no-file-parallelism --pool=threads --maxWorkers=2 --minWorkers=1
```

Storage-constraint tests roll back every synthetic fixture. Service/HTTP tests
retain uniquely identified synthetic fixtures only in the disposable test database.
Together they cover storage invariants, send validation/access/mute, mention
atomicity, admission across clients/HTTP requests, and post-lock clock sampling.
Until history is implemented, rejection checks combine HTTP responses/subsequent
successful sends with database integrity counts; they do not claim public history proof.
