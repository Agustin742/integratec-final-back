# Classroom context live hints

Backend transport for context invalidation (B), separate from panel projection (A).
The frontend implementation is coordinated separately. Context and permissions
remain authoritative in `GET /classrooms/:id`, including `availablePanels`.
See [the context contract](classroom-context.md), [API rules](../rules/api-contracts.md)
and [authorization rules](../rules/authentication-and-session.md).

## Delivery decision

Alejo selected live invalidation with authoritative REST reload on reconnect for
backend B. SSE uses the existing HTTP/Bearer-authenticated API without adding a
framework or routing context through a 3D room that parents cannot join. Durable
cursor/replay storage was not selected: clients need current authorized state,
not every intermediate change. This is the implementation decision for this work;
team approval still belongs to the PR review, and frontend consumption is separate.

## HTTP contract

`GET /classrooms/:id/context-events` uses `Authorization: Bearer <access token>`.
Use streaming `fetch`, not native `EventSource`, which cannot set that header.
Never send credentials in query parameters. No client-supplied user or session
identifier is used. The global `SessionAuthGuard` verifies identity; the shared
`AccessVerificationService` checks classroom access with `requiredRole: 'ANY'`.
This includes permitted parents and clients using the 2D interface; it grants no
3D room access or new permission.

Authentication fails with `401`; malformed, unavailable and foreign classroom IDs
fail with `404`. Access is checked before `200`/SSE headers. Setup times out after
10 seconds with `503`; unexpected backend failures use the normal API error path.
Nest 11.2.8 is installed: the controller deliberately uses `@Get`/Express `@Res`
instead of `@Sse`, to avoid committing stream headers before async authorization.

Successful responses use `text/event-stream`, `Cache-Control: no-store, no-cache,
no-transform`, `Connection: keep-alive` and `X-Accel-Buffering: no`. Proxies must
honor streaming/no-buffering and allow an idle interval greater than 15 seconds.

```text
event: classroom.context-invalidated
data: {"classroomId":"00000000-0000-4000-8000-000000000001"}

```

An initial hint is sent **after registration** and keeps the stream open. Refetch
the complete context on every connect/reconnect and hint, including that initial
hint: a change between authorization and registration must not leave stale UI.
Later invalidations send the same generic hint and close matching streams, forcing
fresh authorization on reconnect. Hints contain no roles, child IDs or user IDs.
Duplicates and out-of-order hints simply require another current REST read.
There are no event IDs, replay store, or `Last-Event-ID` recovery semantics; changes
while disconnected are recovered by REST. Do not treat a hint as a permission grant.

Every 15 seconds the stream revalidates the stored session and current access,
then writes a `: heartbeat` comment. Checks never overlap. Revocation, expiry,
access loss or backend failure sends a generic hint and closes the stream. Every
stream also expires after 60 seconds, including when a recheck hangs. On EOF,
reconcile using REST (handle `401`/`404` by closing unavailable content); reconnect
with bounded backoff and valid credentials, never a tight retry loop.

Disconnect, shutdown, errors and slow consumers clean up timers, listeners and
subscriptions. A false/throwing write destroys the connection immediately rather
than buffering more hints. No heartbeat is itself a domain invalidation.

## Integration seam and limits

`AppModule` imports `ClassroomContextDeliveryModule`, which imports the stream
module and registers committed outbox delivery through `ClassroomContextDeliveryHandler`. The stream module exports
one singleton `ClassroomContextEventsService` with
`invalidateClassroom(classroomId: string): void` and
`invalidateSession(userId: string, sessionId?: string): void`. Omitting session ID
targets all sessions of that user; otherwise both verified identifiers must match.
The outbox handler calls these ports only after committed changes; see the
[producer coverage](classroom-context-events.md). The endpoint is described in the
generated OpenAPI contract. Do not instantiate a second broker in another module.

The broker is process-local and non-durable. Multi-API-instance deployment needs
fan-out to each instance; this slice adds no shared queue or dependency. Periodic
checks/60-second renewal bound stale access but do not promise immediate delivery
of every panel/configuration change when integration delivery is unavailable.

## Verification scope

Standalone module HTTP tests use the real global guard with mocked session and
access services, and real loopback HTTP streaming. Lifecycle tests cover session
and access revalidation, setup races/cancellation/timeouts, heartbeat framing,
shutdown, maximum lifetime, target isolation and backpressure with bounded fake
timers. Streams are deterministically aborted. These tests are not database,
frontend, proxy, distributed fan-out or outbox end-to-end proof.
