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

## Approved policy, not yet endpoint behavior

Alejo approved REST send, non-empty trimmed text up to 2,000 characters, at most
20 distinct mentioned users, and 5 messages per 10 seconds per user/classroom,
including staff. Excess admission returns HTTP 429. `chat-policy.ts` records the
constants; the persistence foundation alone does not enforce these limits.

REST send/history/moderation, current membership checks, parent denial, mute
checks, mention resolution/notifications and concurrency-safe rate admission
remain for the next implementation unit. Realtime delivery belongs to #48;
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
pnpm --filter @aula/api exec vitest run src/chat/chat-persistence.integration.spec.ts --no-file-parallelism --pool=threads --maxWorkers=2 --minWorkers=1
```

The focused tests use public Prisma/database interfaces and roll back every
synthetic fixture, including on assertion failure. They cover context exclusivity,
foreign keys, moderation pairing/audit, history retention and mention uniqueness.
