# API and Realtime Contracts

Frontend and backend must agree on observable contracts before either side treats an assumption as integration behavior.

## Ownership and distribution

- Each consumed contract **MUST** have an identifiable backend owner and a frontend integration reference.
- Decision D4 (approved by Agustin on 2026-11-02; see [Technical justification](../docs/technical-justification.md#d4-contract-distribution)): NestJS generates an OpenAPI document through `@nestjs/swagger` decorators, served with the Scalar API reference UI, and the frontend generates its TypeScript types from that document. Shared types for the NestJS and Colyseus services live in `packages/contracts` ([Architecture](./architecture.md)).
- Decision D8 (approved by Agustin on 2026-11-02; see [Technical justification](../docs/technical-justification.md#d8-committed-rest-and-realtime-contract-artifacts)): the generated `openapi.json` is **committed** in this repository (planned path, for example `apps/api/openapi.json`; the exact path is set by the monorepo bootstrap), and CI **MUST** fail when the committed file is stale versus the code. The frontend fetches it with its sync script (`pnpm api:sync`) from the `develop` branch and commits the types it generates.
- Realtime contracts follow the same mechanism: this repository generates client-side TypeScript for Colyseus room state with `@colyseus/schema` codegen (`schema-codegen`), exports realtime message payload types from `packages/contracts`, and commits the generated artifacts (path set by the monorepo bootstrap); the frontend sync script pulls them. Contributors **MUST NOT** publish `packages/contracts` to a package registry or ask the frontend to hand-write realtime types.
- Decision D9 (approved by Agustin on 2026-11-02; see [Technical justification](../docs/technical-justification.md#d9-contract-first-stubs-and-mocking)): contributors **MUST** publish each endpoint's DTOs and OpenAPI entry (a stub returning `501` is allowed) in a pull request before or together with its implementation, so the committed `openapi.json` carries it and the frontend can build mock handlers from the contract.
- Contract decisions **MUST** identify where the authoritative specification lives and how consumers learn about changes.

## Contract content

- Contracts **MUST** specify operation or event names, authentication requirements, input/output shapes, required and nullable fields, and expected failures.
- Lists **MUST** define ordering and, when needed, filtering and pagination behavior rather than rely on client guesses.
- IDs and date values follow [Data and time](./data-and-time.md).
- Realtime contracts **MUST** distinguish commands, acknowledgements, and notifications, including duplicate or out-of-order handling where relevant.
- Frontend adapters **MUST** handle invalid or unsupported responses without silently treating them as valid domain data.
- Mocks **MUST** reflect an identified contract and include relevant failures. A passing mock **MUST NOT** be claimed as proof of backend integration.

## Realtime contract

Approved by Agustin on 2026-11-10 ([D14](../docs/technical-justification.md#d14-realtime-presence-and-movement-policy)); the room behavior is in [Realtime and presence](./realtime-and-presence.md). The types live in `packages/contracts` and the room state types are generated with `@colyseus/schema` codegen. The `npc:interact` command and the `npcs` state patches below were added with the NPC routines (#147, pull request #148) under the same D8/D14 mechanisms.

| Direction | Name | Kind | Payload | Failure or handling |
|---|---|---|---|---|
| Client to server | `avatar:input` | Command (no acknowledgement) | `{ x: number, z: number }`, each in `[-1, 1]`; `{ x: 0, z: 0 }` stops the avatar | A payload that fails validation closes the connection (Colyseus closes with its own code `4002`); a message over 30 per second per connection is dropped silently; a frozen avatar ignores it |
| Client to server | `npc:interact` | Command (no acknowledgement) | `{ npcId: 'pet' \| 'tutorBot' }` | A payload that fails validation closes the connection (Colyseus `4002`); it shares the connection's 30-messages-per-second budget with `avatar:input` and the excess is dropped silently; ignored without side effects unless the sender is a live member whose avatar is within `NPC_INTERACT_MAX_DISTANCE` (1.8 m) and outside the 4 s per-member-per-NPC cooldown, and the NPC is not already reacting |
| Server to client | state patches of `ClassroomState.avatars` | Notification | `MapSchema<Avatar>` keyed by `userId`; `Avatar { userId, displayName, role, x, z, rotation, status: 'online' \| 'reconnecting' }` | The newest state wins; there is nothing to reorder or deduplicate |
| Server to client | state patches of `ClassroomState.npcs` | Notification | `MapSchema<Npc>` keyed by `npcId`; `Npc { id, x, z, rotation, state: NpcState, emote, reaction, phraseId, reactingSessionId, reactionSeq }` | The newest state wins; patches touch only changed fields, so there is nothing to reorder or deduplicate |
| Server to client | `chat:message` | Notification | `ChatMessagePayload { id, classroomId, authorId, body, mentionedUserIds, createdAt }`, defined and validated in `packages/contracts` | Emitted after the message commit. Delivery is at least once; clients deduplicate by `id`. A missing event is recovered from `GET /classrooms/:id/messages` |
| Server to client | `chat:message.hidden` | Notification | `{ messageId, hiddenAt }`, defined and validated in `packages/contracts` | Emitted after the first moderation commit. Clients hide the row by ID; staff fetch audit details from REST history. If it arrives before `chat:message`, keep a tombstone and do not resurrect that ID from an older `createdAt`. Duplicates are harmless; REST history is authoritative |

For chat, the browser sends messages only through the authenticated REST endpoint. The NestJS outbox stores message identity rather than message content; its handler resolves the committed message before calling Colyseus. The authenticated `POST /internal/chat-events` route is service-to-service only and must not be exposed by the reverse proxy. Colyseus broadcasts to rooms mapped to the same classroom. The event payloads are validated on both sides; no client command can create or moderate a message.

| Close code | Constant | Meaning | Client action |
|---|---|---|---|
| `4001` | `CLOSE_CODE_ACCESS_REVOKED` | Access was revoked (membership removed or session ended); the close reason is `access_revoked` | Do not reconnect; refresh the session or leave the classroom |
| `4002` | `CLOSE_CODE_TOO_MANY_CONNECTIONS` | The user already holds 3 connections; the close reason is `too_many_connections` | Do not retry automatically; close another screen first |
| `4100` | `CLOSE_CODE_VERIFICATION_UNAVAILABLE` | A reconnection could not be verified because the API was unreachable, slow, or failing; the close reason is `verification_unavailable`. It says nothing about the user's access | Offer a retry (a fresh join, because the held connection is gone); do not show it as revoked access |

Colyseus itself uses `4001` for a server shutdown and `4002` for protocol errors (an invalid message or a failed join). The close **reason** disambiguates: only the values above mean revoked access or too many connections. `4100` is outside every code Colyseus uses (`4000` to `4003` and `4010`). The frontend **MUST** read the reason, not only the code.

The classroom layout (bounds, obstacle boxes, and floor props) that the server uses for collisions is built by `buildClassroomLayout(deskCount)` in `packages/contracts` so the frontend scene and the server agree; `isWalkable` blocks the props for avatars and NPCs alike. Student desks go in rows of four (minimum `MIN_CLASSROOM_DESKS` = 12); each extra row extends the room towards the back (issues #79 and #22).

## Compatibility and verification

- Producers **MUST** coordinate incompatible changes with consumers before adoption; adding a field **MUST NOT** silently change existing field meanings.
- Verification **MUST** exercise representative success and failure responses through the integration boundary.
- Contract examples **MUST** use synthetic data. Permission and transport obligations remain in [Security](./security.md).
