# Transactional classroom context producers

## Internal contract

`ClassroomContextRecorder.recordChanged(tx: Prisma.TransactionClient, classroomId: string)`
records `classroom.context.changed` through the existing transactional outbox writer.
The payload is exactly `{ classroomId }`: no identity, role, child, capability or secret.
Recording is awaited within the caller's transaction. An outbox failure rejects the
mutation; a rolled-back transaction cannot leave a deliverable event.

This is a generic invalidation hint, not an authoritative context snapshot. Consumers
must refetch the current REST classroom context, including `availablePanels`, and
tolerate duplicate or out-of-order hints. REST remains authoritative on reconnect;
this producer does not guarantee live delivery during a disconnection.

## Producers

- `ClassroomsService.update`: configuration writes and their event share one transaction.
  All effective update inputs invalidate, including name/subject/control changes and
  repeated values. This deliberately avoids an additional comparison query. Null-only
  ignored fields retain the existing update/response behavior but record no event.
  Empty input, invalid identifiers and authorization failures retain their prior errors.
- `ClassroomInvitationsService.joinWithCode` and `acceptEmailInvitation`: record after
  membership creation/reactivation and desk assignment in the existing transaction.
  Existing-enrollment retries do not record or consume additional uses. Failures before
  recording leave no event; recording failure rolls back membership, desk and counters.
  Existing expiry-state bookkeeping is unchanged (an expired attempt can mark the
  invitation expired, but never records a context change).

No event is added for classroom creation, invitation issuance/revocation or join-code
regeneration: these do not change an existing viewer's classroom context.

## Integration boundary and gaps

`ClassroomContextModule` imports `OutboxModule` and exports `ClassroomContextRecorder`.
`ClassroomsModule` imports this recorder module. The separate API-root
`ClassroomContextDeliveryModule` imports the singleton stream module so consumers
of classroom services do not acquire a second global authentication guard.
`ClassroomContextDeliveryHandler` registers an additional outbox handler for context
changes and the existing removal/access/session-revocation events, without replacing
Colyseus eviction handlers or their retry policy. Classroom-scoped hints also reach
parent subscribers affected by child removal; session hints match the verified user
and, when present, session ID. Signals close matching streams after delivery, and
clients refetch current context before deciding what remains visible.

Membership removal and session revocation reuse their existing outbox events, not
duplicate producer events. No standalone parent-link mutation or
school-role mutation is implemented in these producer services. Future such mutators
must record invalidation for affected classrooms in their own transaction; this work
adds no new permission-changing endpoints.

## Verification boundary

Focused service tests cover payload/transaction identity, creation/reactivation,
unchanged responses, active-member retries, rejected input and failure propagation.
Recorder tests exercise the exported module with the real outbox writer and a synthetic
transaction. These deterministic mocks alone do not prove PostgreSQL rollback or concurrent
behavior. The separate isolated PostgreSQL context-transaction tests exercise
committed-only scoped delivery, rollback after event insertion, parent access after
adult-mode changes and unauthorized update non-interference. Report actual test
results with the change; test presence is not execution evidence. Frontend rendering
and production proxy behavior require their own verification.
