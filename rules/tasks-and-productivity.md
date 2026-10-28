# Tasks and Productivity (Server Side)

Tasks are persisted, room-scoped records. The backend decides who may change them and keeps board columns and task positions consistent.

## Authority and scope

- [Master §2.5](../master-document.md#25-productividad) and §10 (R5) require persisted task CRUD; the behavior is specified by RF-TAR-001 to RF-TAR-014 in the [functional requirements](../docs/functional-requirements.md).
- Permissions come from [Rooms and permissions](./rooms-and-permissions.md); this rule does not redefine them.
- [Master §6.2](../master-document.md#62-canales-y-propiedad-de-los-datos) assigns persistence to NestJS/PostgreSQL and the subsequent live notification to Colyseus.

## Ownership and authority

- A task belongs to exactly one room, and to one board column of that room. The room, not the creator, determines visibility.
- Anyone with access to the room may create, edit, move, and delete its tasks (closed decision); the server **MUST NOT** add stricter ownership checks, and **MUST NOT** allow any action without room access.
- Reads, writes, and deletes **MUST** derive the task's office and room from the stored task, not from client-supplied IDs, and **MUST** check the actor's access to that room.
- Task lists **MUST** be filtered by the actor's room access, including cross-room views such as "my tasks" (RF-TAR-013).
- Colyseus **MUST NOT** persist or mutate tasks; it only announces changes NestJS has committed.

## Validation

- The server **MUST** validate every input independently of the client: title required and bounded, description bounded, valid priority, valid due date. Exact limits are **open** and **MUST** be recorded in the contract before release.
- The assignee **MUST** be null or a user with access to the task's room; the server **MUST** reject others (RF-TAR-008).
- A new task **MUST** be placed in the first column of the board (RF-TAR-002).
- Due dates follow [Data and time](./data-and-time.md): date-only versus instant semantics **MUST** be stated in the contract, and the server **MUST NOT** shift them by incidental conversion.
- Unknown or extra request fields **MUST** be rejected or ignored explicitly; clients **MUST NOT** set room, creator, or timestamps.

## Board columns and state consistency

- The task state is the column it sits in. There is no separate status field that can disagree with the column; any derived "done" semantic (for example overdue calculation, RF-TAR-012) **MUST** be computed from the column position, not stored twice.
- A new room's board **MUST** be created with the default columns "Pendiente", "En curso", and "Hecho" in that order (RF-TAR-006, P-14).
- A move **MUST** target a column of the same room as the task; cross-room moves **MUST** be rejected.
- Column names **MUST** be unique within a board; a board **MUST** always keep at least one column.
- Deleting a column with tasks **MUST** require a destination column and **MUST** move the tasks in the same transaction (RF-TAR-007).
- Column configuration is limited to Leader, Administrator, and Owner (see [Rooms and permissions](./rooms-and-permissions.md)).
- Ordering within a column is **open**. If persisted ordering is adopted, concurrent reorderings **MUST** leave a consistent order.

## Orphaned tasks

- When the assignee loses room access or leaves the office, the task **MUST** remain and be flagged as having no active assignee; the former assignee **MUST NOT** read or edit it. Reassigning clears the flag (RF-TAR-009, RN-12).

## Concurrency and live updates

- Simultaneous edits of one task **MUST** leave a coherent state and let the losing client learn its change was not applied (RF-TAR-011). The mechanism (for example a version check) is **open**; silent last-write-wins on moves and edits **MUST NOT** be described as merged.
- Persistence precedes broadcast: the live notification **MUST** be sent only after the commit, and its loss **MUST NOT** affect stored data; see [Architecture](./architecture.md).
- Task deletion is permanent in the MVP unless the team records a soft-deletion decision. The confirmation prompt belongs to the client; the server **MUST NOT** depend on it.

## Verification

Tests **MUST** cover CRUD with and without room access, foreign task and room IDs, invalid assignee, cross-room move, column deletion with tasks, orphaning, concurrent edits, and persistence across restart. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Field limits, priority vocabulary, and due-date semantics.
- Within-column ordering and the concurrency protocol.
- Hard versus soft task deletion.
