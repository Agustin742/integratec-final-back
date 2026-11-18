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
the polymorphic source is not a database foreign key. The future service must
write messages, resolved mentions and notification requests atomically.

## Send application service (not yet exposed over REST)

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
real outbox recorder. A downstream failure is injected to prove rollback. No
HTTP/authentication boundary is exercised yet, and no REST route is registered.

## Approved policy and remaining endpoint work

Alejo approved REST send, non-empty trimmed text up to 2,000 characters, at most
20 distinct mentioned users, and 5 messages per 10 seconds per user/classroom,
including staff. Excess admission returns HTTP 429. `chat-policy.ts` records the
constants; the send application service enforces these limits.

REST DTO/controller/module registration, HTTP boundary verification and OpenAPI
remain for the next unit. History and moderation endpoints remain subsequent work. Realtime delivery belongs to #48;
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
pnpm --filter @aula/api exec vitest run src/chat/chat-persistence.integration.spec.ts src/chat/chat-send.integration.spec.ts --no-file-parallelism --pool=threads --maxWorkers=2 --minWorkers=1
```

Storage-constraint tests roll back every synthetic fixture. Send-service tests
retain uniquely identified synthetic fixtures only in the disposable test database.
Together they cover storage invariants, send validation/access/mute, mention
atomicity, admission across clients, and clock sampling after a real lock wait.
