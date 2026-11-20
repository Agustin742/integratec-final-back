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

## REST history

`GET /classrooms/:id/messages` requires the same current classroom access as send:
students and staff may read; linked parents receive 403, unrelated/removed users
and invalid/foreign classrooms receive 404, and missing credentials receive 401.
Mute does not prevent reading. ParentLink conversations are never included.

Only `page` and `pageSize` are accepted (defaults 1/20, maxima 10,000/100,
positive integers). Unsupported `sort` or other query fields return 400
`VALIDATION_FAILED`. The standard response is `{ items, page, pageSize, total }`,
ordered latest first by `createdAt DESC, id DESC`, including stable timestamp ties.
An out-of-range page returns empty items while retaining the filtered total.

History items contain the send response fields plus `hiddenAt` and `hiddenById`:
both are explicitly null for visible messages. Students omit hidden rows entirely,
including their text and mentions; staff receive full retained text, mentions and
moderator/time audit. Totals reflect that role's visibility. Membership removal
revokes access but leaves the original author attribution and mention history.

Count, selected items and resolved mention rows use one PostgreSQL RepeatableRead
snapshot. Offset pages are stable within each response, not a frozen multi-request
feed: new messages between requests can shift offsets. POST response fields are
unchanged. Moderation now performs these writes through `DELETE`; read tests keep
seeding moderation state directly through Prisma.

## REST moderation

`DELETE /classrooms/:id/messages/:messageId` performs teacher moderation as a
logical state change: the message row is never deleted or rewritten. Current
classroom staff only — school Owner/Admin without a classroom membership, the
classroom's teacher, or an independent teacher of their own classroom. Linked
parents and enrolled students receive 403 `FORBIDDEN`; unrelated or removed
users, foreign or invalid classroom ids and unknown message ids receive 404
`NOT_FOUND` without revealing existence, and missing credentials receive 401.
A message that belongs to another classroom is unreachable through this
classroom's path.

On success the server assigns both audit fields itself: `hiddenAt` from the
database UTC clock at millisecond precision and `hiddenById` from the acting
moderator, written atomically in one UPDATE while the row is still visible. The
response is 204 with an empty body. Moderation is idempotent: hiding an already
hidden message returns 204 without overwriting the original actor/time, so the
audit pair records only the first moderation. There is no unhide operation.
Moderation neither consumes nor consults the send rate limit.

After moderation students stop seeing the row entirely, including its text and
mentions; teacher-level staff keep the full history with body, author, mentions,
moderator and time.

## Realtime delivery (#48)

The browser sends messages through `POST /classrooms/:id/messages`; it does not
send chat commands through Colyseus. NestJS writes the message, mentions,
notifications, participation metric and a minimal realtime outbox event in the
same transaction. The outbox stores only `classroomId` and `messageId`, not a
second copy of the message body. Right after the transaction commits, NestJS
asks the outbox dispatcher to deliver exactly that event (best effort, never
awaited by the REST response); the regular poll stays as the retry path. Its
handler reads the persisted message and mentions and calls Colyseus
`POST /internal/chat-events` with the service secret. Colyseus validates the shared contract and broadcasts only to
live rooms registered for that classroom. A Colyseus outage never undoes the
REST write; outbox retries delivery and the paginated history endpoint is the
recovery source. `chat:message.hidden` gets the same larger retry budget as
eviction (12 attempts, about 2.8 hours) because students keep seeing a
moderated message until it lands; `chat:message` keeps the default budget since
history recovers a missed live message.

The server-to-client `chat:message` event carries the persisted send DTO. The
`chat:message.hidden` event carries only `messageId` and `hiddenAt`; students
remove that row, while staff reload history for the moderator audit fields.
Outbox delivery is at least once and events may be duplicated or reordered.
Clients deduplicate by message ID, retain a hidden-ID tombstone if the hide
event arrives before creation, and do not resurrect an older `createdAt`.
Clients treat REST history as authoritative, including after reconnect.
Message bodies and identifiers are not written to failure logs.

## Send application service

`ChatService.send` reuses shared access verification and the existing exported
announcement mention matcher. It rejects linked parents, invalid/blank text,
unsafe controls, excess length and more than 20 distinct roster matches. It reads
persisted mute state on every call; students are denied while staff may send.
Message, deduplicated mentions, notification outbox requests and the author's daily
participation metric (`messageCount` of the message's UTC day) commit atomically.

A non-blocking PostgreSQL transaction advisory lock (`pg_try_advisory_xact_lock`)
guards each normalized user/classroom pair across service instances. A concurrent
send for the same user and classroom is rejected with 429 instead of queued, so a
burst never pins pooled connections waiting; nothing is persisted. After acquiring
the lock, access is rechecked and the classroom row is share-locked while mute
state is read. The database clock is sampled **after** taking the lock, at the
millisecond precision persisted through Prisma.
Admission counts all messages (including hidden ones) newer than `now - 10s`;
the same `now` is persisted on acceptance. At most five are admitted; excess or
concurrent sends fail with 429 without consuming quota. No process-local admission state exists.
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

Realtime delivery belongs to #48;
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
pnpm --filter @aula/api exec vitest run src/platform/realtime/realtime-chat.spec.ts src/openapi/openapi.spec.ts
pnpm --filter @aula/realtime exec vitest run src/internal/chat-events-route.spec.ts src/rooms/room-directory.spec.ts src/rooms/classroom-room.spec.ts
pnpm --filter @aula/contracts exec vitest run src/index.spec.ts
```

Storage-constraint tests roll back every synthetic fixture. Service/HTTP tests
retain uniquely identified synthetic fixtures only in the disposable test database.
Together they cover storage invariants, send validation/access/mute, mention
atomicity, admission across clients/HTTP requests, and post-lock clock sampling.
Rejection checks compare public history before/after (including total, items and
mentions), supplemented by database counts. Invalid sends are followed by five
accepted sends to verify quota preservation. Read tests cover pagination ties,
role-filtered audit, retained attribution, and concurrent count/items/mention consistency.
Realtime tests cover transactional outbox metadata, post-commit message lookup,
authenticated internal delivery, classroom isolation, moderation idempotency
under concurrent requests, and fallback to REST history.
