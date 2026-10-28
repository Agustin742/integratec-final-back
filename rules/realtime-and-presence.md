# Realtime and Presence (Colyseus)

Colyseus owns live, ephemeral room state. It is never the source of truth for durable data and admits only users NestJS has authorized.

## Authority and scope

- [Master §2.3](../master-document.md#23-movimiento-avatares-y-presencia), [§6.2](../master-document.md#62-canales-y-propiedad-de-los-datos), and [§7.4](../master-document.md#74-despliegue-red-y-operación) define presence, ownership, and the single-instance MVP; behavior is specified by RF-MUN-007 to RF-MUN-010 in the [functional requirements](../docs/functional-requirements.md).
- Service boundaries and the NestJS integration are in [Architecture](./architecture.md); identity rules are in [Authentication and session](./authentication-and-session.md).

## Persistent rooms versus live rooms

- A product room or office stored in PostgreSQL is not a Colyseus `Room`. The Colyseus room is a disposable in-memory session that may be created, disposed, and recreated without losing product data.
- The server **MUST** control the mapping between a persistent room and a live instance. Client-supplied room, instance, or session identifiers **MUST NOT** establish that mapping.
- A live room **MUST** belong to exactly one persistent room, and users of different offices **MUST NOT** share one.
- Disposing a live room when the last client leaves **MUST NOT** delete persistent data.

## Join authorization

- Joining **MUST** require a verifiable identity and current access to the target office and room, confirmed by NestJS from persisted state. A join without that confirmation **MUST** be rejected.
- Rejection **MUST** apply the same principles as `401` and `403` (no authentication, no permission) and **MUST NOT** reveal whether a foreign room exists.
- A user **MUST NOT** hold more simultaneous live presences than the product allows; the duplicate-connection policy is **open**.
- Access can change while connected. When a user loses room access, is expelled, loses the session, or the office is deactivated, the server **MUST** remove them from the live room promptly and **MUST** reject reconnection (RF-HAB-010, RF-MUN-009). The propagation mechanism is **open** and is part of the [Architecture](./architecture.md) integration contract.
- Join credentials **MUST NOT** be written to logs.

## Ephemeral state

- Positions, orientation, presence status, and connection state **MUST** live only in the live room and **MUST NOT** be written to PostgreSQL per step, per frame, or per tick ([master §6.4](../master-document.md#64-modelo-de-información-general)).
- Only the validated result of a durable action (for example a task or message) is persisted, and only by NestJS.
- Persisted avatar configuration is distinct from live position and is managed by NestJS.
- Live state **MUST** be restorable after a restart as an empty room: nothing about a correct product depends on recovering positions.

## Message validation and authority

- Every client message **MUST** be validated for shape, type, size, and rate before use. Unknown message types **MUST** be ignored or rejected without side effects.
- The server **MUST** validate movement plausibility (bounds, collisions, speed) and **MUST NOT** accept teleports or movement through obstacles (RF-MUN-007). Exact tick rate and reconciliation approach are **open**.
- Messages **MUST NOT** carry authority: roles, permissions, and user identity come from the authenticated session, never from the payload.
- Clients **SHOULD** send intents (for example movement input) and receive authoritative state; they **MUST NOT** set other users' state.
- Per-connection rate limits **MUST** exist to bound abuse.
- The presence list shows who is online and in which room for the same office, including rooms the viewer cannot enter, without revealing room content; users of other offices **MUST NOT** appear (RF-MUN-010).

## Notifications of persistent changes

- Colyseus announces task, message, meeting, and similar changes only after NestJS has committed them; see [Architecture](./architecture.md). Announcements **MUST** be delivered only to clients currently authorized for the affected room.
- Chat may be delivered live, but its history and authorization are owned by NestJS; see [Communication and meetings](./communication-and-meetings.md).
- Event names and payloads are illustrative until agreed ([master §6.2](../master-document.md#62-canales-y-propiedad-de-los-datos)) and **MUST** be specified under [API contracts](./api-contracts.md).

## Reconnection and disconnection

- A disconnected avatar **MUST** disappear after a short, configurable interval (RF-MUN-008). Reconnection **MUST** repeat authorization against current permissions and **MUST NOT** restore access that was lost.
- The reconnection window, backoff, and retries are **open** and **MUST** be bounded.
- Logout **MUST** close the user's live connections.

## Scaling and deployment

- The MVP **MUST** run one Colyseus instance to preserve room coherence. Adding instances **MUST NOT** be done by only duplicating tasks behind the load balancer; it requires a compatible presence, matchmaking, routing, and reconnection strategy, and a decision first ([master §7.4](../master-document.md#74-despliegue-red-y-operación)).
- Deployment topology is in [AWS infrastructure](./aws-infrastructure.md). WebSocket traffic **MUST** use WSS in production.
- Socket.IO is excluded for the MVP; any use needs an independent justification and **MUST NOT** substitute Colyseus.

## Observability

Logs **MUST NOT** contain per-frame positions or message content. Summarize repeated connection failures; see [Observability and privacy](./observability-and-privacy.md).

## Verification

Tests **MUST** cover: join without a credential, with an expired credential, to a foreign room, and after losing access; implausible movement; malformed messages; reconnection after access loss; presence isolation between offices; and absence of database writes on movement. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Tick rate, movement reconciliation, and rate-limit values.
- Duplicate-connection policy and the propagation of access changes to live rooms.
- Reconnection window and backoff.
- Whether chat is sent through REST or realtime messages ([Communication and meetings](./communication-and-meetings.md)).
