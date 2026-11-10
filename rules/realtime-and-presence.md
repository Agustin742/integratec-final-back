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
- Rejection **MUST** apply the same principles as `401` and `403` (no authentication, no permission) and **MUST NOT** reveal whether a foreign classroom exists (foreign resources respond `404`).
- A user **MUST NOT** hold more simultaneous live presences than the product allows. **Duplicate connections (approved by Agustin on 2026-11-10):** a user has one avatar shared by up to **3** simultaneous connections (screens or tabs); a 4th connection **MUST** be closed with code `4002`. See [Presence and duplicate connections](#presence-and-duplicate-connections).
- Access can change while connected. When a user is removed from the classroom, loses the session, or the classroom becomes unavailable, the server **MUST** remove them from the live room promptly and **MUST** reject reconnection. **Propagation (approved by Agustin on 2026-11-10):** NestJS records an outbox event on membership removal and on logout or session revocation; its handler calls an internal Colyseus HTTP endpoint that closes the affected connections with code `4001` and blocks their reconnection. There is no periodic polling; the outbox retries cover transient failures. See [Live access eviction](#live-access-eviction).
- Join credentials **MUST NOT** be written to logs.
- **Credential transport (D2 update, approved by Agustin on 2026-11-09):** the client sets the access token with the Colyseus SDK (`client.auth.token`), which sends it as `Authorization: Bearer <access token>` on the matchmake HTTP request; it reaches `static onAuth(token, options, context)` as `token`. Join options carry only `classroomId`. The server **MUST NOT** read the token from join options or URLs, and **MUST** re-check `options.classroomId` on every join path (`joinById` ignores `filterBy`). This supersedes the frontend wording "access token in the join options"; see [Technical justification, D2](../docs/technical-justification.md#d2-nestjs-and-colyseus-integration).
- `onAuth` calls `POST /internal/realtime/join-verification` on the API with the header `x-internal-service-secret`. Any failure (no token, bad or foreign classroom, API denial, error, timeout, or malformed response) **MUST** reject the join with a generic error (fail closed). The endpoint **MUST NOT** be routed by the reverse proxy.

## Ephemeral state

- Positions, orientation, presence status, seat assignment, freeze lock, and connection state **MUST** live only in the live room and **MUST NOT** be written to PostgreSQL per step, per frame, or per tick ([master §6.4](../master-document.md#64-modelo-de-información-general)).
- Only the validated result of a durable action (for example a message or grade) is persisted, and only by NestJS.
- Persisted avatar configuration is distinct from live position and is managed by NestJS.
- Live state **MUST** be restorable after a restart as an empty room: nothing about a correct product depends on recovering positions. Persisted classroom states (chat mute, collaboration lock, games disabled) **MUST** be reloaded from NestJS when a live room is created and when a user joins.
- Connected time is reported to NestJS as an aggregate for the activity metric, not as per-tick writes; see [Activities and grading](./activities-and-grading.md) and [Connected time](#connected-time).

## Message validation and authority

- Message payload types are exported from `packages/contracts` and room state client types are generated with `@colyseus/schema` codegen and committed, as decided in D8 ([API contracts](./api-contracts.md)).
- Every client message **MUST** be validated for shape, type, size, and rate before use. Unknown message types **MUST** be ignored or rejected without side effects.
- The server **MUST** validate movement plausibility (bounds, collisions, speed) and **MUST NOT** accept teleports or movement through obstacles. A frozen avatar **MUST** be rejected any movement input. Tick rate and reconciliation are decided in [Movement](#movement).
- Messages **MUST NOT** carry authority: roles, permissions, and user identity come from the authenticated session, never from the payload.
- Clients **SHOULD** send intents (for example movement input) and receive authoritative state; they **MUST NOT** set other users' state.
- Per-connection rate limits **MUST** exist to bound abuse: at most **30 messages per second** per connection, with the excess dropped silently and without side effects (approved by Agustin on 2026-11-10).
- The presence list shows who is online in the same classroom; users of other classrooms or schools **MUST NOT** appear.

## Classroom controls and broadcasts

- Control messages (freeze, mute everyone, collaboration lock, disable games) are accepted only from a user whose current teacher-level authority over the classroom NestJS has confirmed; any other sender is ignored without side effects. See [Live classroom tools](./live-classroom-tools.md).
- **Freeze** assigns each student avatar a seat and locks it there (the teacher is not locked); the lock is ephemeral room state, applied to later joins and reconnections, and reversed by an explicit unfreeze.
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
- **Window and backoff (approved by Agustin on 2026-11-10):** after a non-consented drop the server holds the connection for **20 seconds** (configurable with `RECONNECTION_WINDOW_SECONDS`, validated between 1 and 120) through `allowReconnection`. While no other connection of the user is live, the avatar stays with `status: 'reconnecting'`; a consented leave skips the window. Disconnected seconds are not counted as connected time. The client retries with backoff of 1, 2, 4, and 8 seconds and then offers a manual "Reconnect" action (frontend).
- Reconnection re-verifies the user's access with NestJS from persisted state and is refused when access was lost. Because the join token may have expired, the re-verification uses the verified user and session identifiers (no token is retained) through `POST /internal/realtime/access-reverification`.
- Logout **MUST** close the user's live connections.

## Scaling and deployment

- The MVP **MUST** run one Colyseus instance to preserve room coherence. Adding instances **MUST NOT** be done by only duplicating containers behind the reverse proxy; it requires a compatible presence, matchmaking, routing, and reconnection strategy, and a decision first ([master §7.4](../master-document.md#74-despliegue-red-y-operación)).
- Deployment topology is in [AWS infrastructure](./aws-infrastructure.md). WebSocket traffic **MUST** use WSS in production.
- Socket.IO is excluded for the MVP; any use needs an independent justification and **MUST NOT** substitute Colyseus.
- Video and voice media do not pass through Colyseus; see [Live classroom tools](./live-classroom-tools.md).

## Observability

Logs **MUST NOT** contain per-frame positions or message content. Summarize repeated connection failures; see [Observability and privacy](./observability-and-privacy.md).

## Verification

Tests **MUST** cover: join without a credential, with an expired credential, to a foreign classroom, and after losing access; a Parent denied a live join; implausible movement and movement while frozen; freeze applying to later joins; control messages from non-teachers ignored; chat mute and games-disabled state delivered on join; malformed messages; reconnection after access loss; presence isolation between classrooms and schools; and absence of database writes on movement. Follow [Quality and testing](./quality-and-testing.md).

## Movement

Approved by Agustin on 2026-11-10.

- Clients send **intents**, not positions: `avatar:input` carries a direction `{ x, z }` with each component in `[-1, 1]`; `{ x: 0, z: 0 }` means stop. The server normalizes the direction and moves the avatar at a **fixed speed**, so a client cannot change its speed.
- The server simulates at a fixed step of **20 Hz** and sends state patches at **20 Hz**. Every step clamps the avatar to the classroom bounds and blocks obstacle boxes (the step is subdivided so a fast move cannot tunnel through a thin obstacle).
- Remote avatars are interpolated by the frontend. There is **no client-side prediction or reconciliation** for now; revisit it only if measured latency requires it.
- The last input received from any of a user's connections wins.
- Movement **MUST NOT** write to PostgreSQL.

## Presence and duplicate connections

Approved by Agustin on 2026-11-10.

- One user has one avatar, keyed by `userId` in the synchronized state, and appears once in the presence list however many connections they hold.
- A user may hold up to **3** simultaneous connections in the same room (connections held for reconnection count). The 4th is closed with code `4002`.
- The avatar is removed only when the user's last connection leaves.
- Presence is isolated per classroom: a room only contains users NestJS verified for that classroom.

## Live access eviction

Approved by Agustin on 2026-11-10.

- NestJS writes an outbox event, in the same transaction as the change, when a classroom membership is deactivated or removed and when a session is revoked (logout, refresh-token reuse, password reset).
- The event handler calls `POST /internal/evictions` on the realtime server with the `x-internal-service-secret` header. The route is internal: the reverse proxy **MUST NOT** route it (Caddy exposes only the matchmaking and WebSocket paths).
- The server closes every matching connection with code `4001`, rejects any pending reconnection of it, and removes the avatar when no connection remains. Delivery is at least once, so eviction is idempotent.

## Connected time

- The room tracks, per user, the union of the intervals in which at least one of their connections is live: overlapping connections count once and the reconnection gap is not counted.
- On the user's final leave, and on room disposal for anyone still tracked, the room reports one aggregate (`connectedSeconds`) to NestJS (`POST /internal/realtime/connected-time`); NestJS persists it as a per-user, per-classroom, per-UTC-day aggregate row (`ActivityMetric`), never per tick. A failed report is logged without personal data and is not retried, so the metric can undercount.

## Realtime contract

Message and close-code definitions are in [API contracts](./api-contracts.md#realtime-contract). The synchronized state is `ClassroomState.avatars`, a map keyed by `userId` whose `Avatar` entries hold `userId`, `displayName`, `role`, `x`, `z`, `rotation`, and `status` (`'online'` or `'reconnecting'`); the client types are generated with `@colyseus/schema` codegen and committed (D8).

## Open decisions

- **Proposal to confirm in the pull request of issue #25:** the walkable surface, a classroom of 16 by 12 units with a front teacher desk and 12 student desks, defined as shared data in `packages/contracts` so the frontend scene and the server agree. The frontend and the team adjust it to the real scene.
- Whether chat is sent through REST or realtime messages ([Communication and notifications](./communication-and-notifications.md)).
- Collaboration sync mechanism (Colyseus state or Yjs).
