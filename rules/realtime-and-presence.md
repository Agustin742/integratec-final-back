# Realtime and Presence (Colyseus)

Colyseus owns live, ephemeral classroom state. It is never the source of truth for durable data and admits only users NestJS has authorized.

## Authority and scope

- [Master §2.11](../master-document.md#211-movimiento-avatares-y-presencia), [§6.2](../master-document.md#62-canales-y-propiedad-de-los-datos), and [§7.4](../master-document.md#74-despliegue-red-y-operación) define presence, ownership, and the single-instance MVP; classroom controls are in [master §2.8](../master-document.md#28-controles-de-aula-y-herramientas-en-vivo).
- Service boundaries and the NestJS integration are in [Architecture](./architecture.md); identity rules are in [Authentication and session](./authentication-and-session.md); the controls themselves are in [Live classroom tools](./live-classroom-tools.md).

## Persistent classrooms versus live rooms

- A classroom stored in PostgreSQL is not a Colyseus `Room`. The Colyseus room is a disposable in-memory session that may be created, disposed, and recreated without losing product data.
- The server **MUST** control the mapping between a persistent classroom and a live instance. Client-supplied room, instance, or session identifiers **MUST NOT** establish that mapping.
- A live room **MUST** belong to exactly one persistent classroom, and users of different classrooms or schools **MUST NOT** share one.
- Disposing a live room when the last client leaves **MUST NOT** delete persistent data.

## Join authorization

- Joining **MUST** require a verifiable identity and current access to the target classroom, confirmed by NestJS from persisted state: enrollment (student), teacher-level authority (teacher, or school Owner or Admin), or no live access (Parent; parents do not enter the 3D classroom). A join without that confirmation **MUST** be rejected.
- Rejection **MUST** apply the same principles as `401` and `403` (no authentication, no permission) and **MUST NOT** reveal whether a foreign classroom exists.
- A user **MUST NOT** hold more simultaneous live presences than the product allows; the duplicate-connection policy is **open**.
- Access can change while connected. When a user is removed from the classroom, loses the session, or the classroom becomes unavailable, the server **MUST** remove them from the live room promptly and **MUST** reject reconnection. The propagation mechanism is **open** and is part of the [Architecture](./architecture.md) integration contract.
- Join credentials **MUST NOT** be written to logs.

## Ephemeral state

- Positions, orientation, presence status, seat assignment, freeze lock, and connection state **MUST** live only in the live room and **MUST NOT** be written to PostgreSQL per step, per frame, or per tick ([master §6.4](../master-document.md#64-modelo-de-información-general)).
- Only the validated result of a durable action (for example a message or grade) is persisted, and only by NestJS.
- Persisted avatar configuration is distinct from live position and is managed by NestJS.
- Live state **MUST** be restorable after a restart as an empty room: nothing about a correct product depends on recovering positions. Persisted classroom states (chat mute, collaboration lock, games disabled) **MUST** be reloaded from NestJS when a live room is created and when a user joins.
- Connected time is reported to NestJS as an aggregate for the activity metric, not as per-tick writes; see [Activities and grading](./activities-and-grading.md).

## Message validation and authority

- Every client message **MUST** be validated for shape, type, size, and rate before use. Unknown message types **MUST** be ignored or rejected without side effects.
- The server **MUST** validate movement plausibility (bounds, collisions, speed) and **MUST NOT** accept teleports or movement through obstacles. A frozen avatar **MUST** be rejected any movement input. Exact tick rate and reconciliation approach are **open**.
- Messages **MUST NOT** carry authority: roles, permissions, and user identity come from the authenticated session, never from the payload.
- Clients **SHOULD** send intents (for example movement input) and receive authoritative state; they **MUST NOT** set other users' state.
- Per-connection rate limits **MUST** exist to bound abuse.
- The presence list shows who is online in the same classroom; users of other classrooms or schools **MUST NOT** appear.

## Classroom controls and broadcasts

- Control messages (freeze, mute everyone, collaboration lock, disable games) are accepted only from a user whose current teacher-level authority over the classroom NestJS has confirmed; any other sender is ignored without side effects. See [Live classroom tools](./live-classroom-tools.md).
- **Freeze** assigns each avatar a seat and locks it there; the lock is ephemeral room state, applied to later joins and reconnections, and reversed by an explicit unfreeze.
- **Chat mute** and **games disabled** are persisted classroom states (the persistent write is by NestJS) and are broadcast to connected clients after the commit (`chat:muted`, a games-state event). A client that connects later receives the current state on join.
- **Mute everyone** is enforced by the media service permissions as well as announced to clients; the broadcast alone is not enforcement.
- Illustrative events such as `classroom:frozen`, `chat:muted`, and `whiteboard:update` are not final until specified under [API contracts](./api-contracts.md).

## Collaborative whiteboard sync

- Whiteboard, charts, and LaTeX collaboration needs synchronized shared state. The mechanism is a **candidate**: Colyseus synchronized state, or a CRDT library such as Yjs served alongside Colyseus. The choice is **open** and **MUST** be recorded before implementation.
- Whichever is used: each classroom has an isolated document space; edits are accepted only from classroom members permitted by the collaboration lock; edit rate and document size are bounded; and operation streams are not persisted per operation.

## Notifications of persistent changes

- Colyseus announces message, announcement, grade, notification, and similar changes only after NestJS has committed them; see [Architecture](./architecture.md). Announcements **MUST** be delivered only to clients currently authorized for the affected classroom (or, for notifications, the specific user).
- Chat may be delivered live, but its history and authorization are owned by NestJS; see [Communication and notifications](./communication-and-notifications.md).
- Event names and payloads are illustrative until agreed ([master §6.2](../master-document.md#62-canales-y-propiedad-de-los-datos)) and **MUST** be specified under [API contracts](./api-contracts.md).

## Reconnection and disconnection

- A disconnected avatar **MUST** disappear after a short, configurable interval. Reconnection **MUST** repeat authorization against current permissions and **MUST NOT** restore access that was lost.
- The reconnection window, backoff, and retries are **open** and **MUST** be bounded.
- Logout **MUST** close the user's live connections.

## Scaling and deployment

- The MVP **MUST** run one Colyseus instance to preserve room coherence. Adding instances **MUST NOT** be done by only duplicating tasks behind the load balancer; it requires a compatible presence, matchmaking, routing, and reconnection strategy, and a decision first ([master §7.4](../master-document.md#74-despliegue-red-y-operación)).
- Deployment topology is in [AWS infrastructure](./aws-infrastructure.md). WebSocket traffic **MUST** use WSS in production.
- Socket.IO is excluded for the MVP; any use needs an independent justification and **MUST NOT** substitute Colyseus.
- Video and voice media do not pass through Colyseus; see [Live classroom tools](./live-classroom-tools.md).

## Observability

Logs **MUST NOT** contain per-frame positions or message content. Summarize repeated connection failures; see [Observability and privacy](./observability-and-privacy.md).

## Verification

Tests **MUST** cover: join without a credential, with an expired credential, to a foreign classroom, and after losing access; a Parent denied a live join; implausible movement and movement while frozen; freeze applying to later joins; control messages from non-teachers ignored; chat mute and games-disabled state delivered on join; malformed messages; reconnection after access loss; presence isolation between classrooms and schools; and absence of database writes on movement. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Tick rate, movement reconciliation, and rate-limit values.
- Duplicate-connection policy and the propagation of access changes to live rooms.
- Reconnection window and backoff.
- Whether chat is sent through REST or realtime messages ([Communication and notifications](./communication-and-notifications.md)).
- Collaboration sync mechanism (Colyseus state or Yjs).
