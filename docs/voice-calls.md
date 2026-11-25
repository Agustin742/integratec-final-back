# Voice calls (#149)

Voice-only calls for a classroom (a class call run by the teacher) and between two members of the same classroom (a direct call). Each participant is shown as their avatar by the client; the server never carries audio.

Normative rules live in [Realtime and presence](../rules/realtime-and-presence.md) and [Live classroom tools](../rules/live-classroom-tools.md). [D21](technical-justification.md#d21-bounded-p2p-voice-call-exception) records Alejo's bounded P2P decision for backend PR #151 / #149 and frontend PR #145 / #141. This page describes the implementation design; required audit policy is labeled separately and is not verification evidence.

## Architecture

- **Audio is peer-to-peer.** Every participant opens a WebRTC connection to every other one (a full mesh) and sends Opus audio only. Audio bandwidth and peer connections grow with group size; the server handles signaling and state, not media. This is a small-group voice-only exception, not the direction for future video, presentations, or scale (D21).
- **STUN only.** Peers discover their public address through public STUN servers. There is no TURN relay, so two peers behind restrictive networks (symmetric NAT, strict corporate firewalls) may fail to connect. Adding TURN is a deployment decision, not a code change on the server.
- **Signaling goes through the `call` Colyseus room** in `apps/realtime`, the same process as the classroom room. `call:signal` relays an SDP offer, answer or ICE candidate from one participant to one other participant of the same room. The sender is the connection, never the payload, and a target that is not in the room is dropped silently. Payloads are never logged (they carry network addresses).
- **The room also holds the shared call state**: participants with their public appearance, self mute, speaking flag, emote, forced mute, `allowSelfUnmute` and `focusMode` (`CallState`, generated under `packages/contracts/src/realtime/generated/`).
- **No recording.** Nothing about the audio is stored, and the server cannot hear it.

## Call keys: one call, one room

The client sends only `kind`, `classroomId` and, for a direct call, `peerUserId`. The server derives the room key from verified data in `onAuth` and matchmakes on it, so a client cannot name a room.

| Call | Key |
| --- | --- |
| Class call | `classroom:<classroomId>` |
| Direct call | `direct:<classroomId>:<lower user id>:<higher user id>` (the pair is unordered) |

A third user naming either member derives a different key and can never reach the pair's room.

## Who can start and join

- **Class call:** only a moderator (OWNER, ADMIN or TEACHER) can start it. A student joining while it does not exist is refused at matchmaking with `403 call_not_started`.
- **Direct call:** either of the two members can start it, and only those two can derive its key. Calling yourself is rejected.
- Access is verified when the seat is reserved and again in `onJoin`; a revoked member gets `4001`, an unreachable API gets `4100`.
- One connection per user: a newer connection replaces the older one (`4104`).

## Moderation and focus mode (class calls)

Only moderators of a class call can act; anyone else is ignored silently, and direct calls reject moderation.

- `call:moderate`: `mute-all`, `mute` / `unmute` one participant, `allow-self-unmute` (on or off) and `focus-mode`. Forced mute never targets a moderator.
- `call:end` ends the call for everyone (`call:ended`, reason `moderator_ended`).
- **Focus mode** locks the 3D world for students while the class call runs. It is enforced on the server: the room directory mirrors the call into the classroom room (`classCallActive`, `focusMode` in `ClassroomState`), and the classroom room ignores student movement while it is on. Moderators are never affected. If the last moderator leaves, focus mode is cleared (nobody could lift it) and the call stays alive.
- Mute is enforced by conforming senders (track disabled) and receivers (muted peers are not played); server state is the source of truth for both. The server cannot block raw P2P audio: a modified sender and receiver can ignore mute. Server-side call state, signaling, and access controls are not media-service publish revocation (D21).
- **Required audit policy, not yet verified here:** forced-mute continuity across replacement and rejoin for the call lifetime follows [the moderation rule](../rules/live-classroom-tools.md#mute-everyone); moderator lifting and existing `allowSelfUnmute` semantics remain unchanged.

## Ringing a direct call

A direct call is started from the classroom member directory, and the ring travels over the callee's classroom connection (there is no 1:1 chat in the system, so the classroom room is the only channel that reaches a user who is not in a call).

1. The caller joins the `call` room with `kind: 'direct'`. As the first participant they are the caller.
2. The server sends `call:incoming` `{ classroomId, callerUserId, callerDisplayName }` to every live classroom connection of the peer in that classroom (found through the room directory).
3. If the peer has no classroom connection, nobody can be rung: the caller gets `call:ended` with reason `unavailable` and the room closes with `4102`.
4. The peer has `CALL_RING_TIMEOUT_SECONDS` (default 30) to join. The timer is the room's own clock. On expiry the caller gets `call:ended` with reason `timeout` and the room closes.
5. **Answer:** the peer joins the same `call` room (same call key). Ringing stops.
6. **Decline:** the callee sends `call:decline` `{ callerUserId }` on the classroom room. The server acts only if a ringing direct call exists for exactly this classroom, this caller and this sender as callee, and it never reads the callee from the payload. The caller then gets `call:declined` `{ byUserId }` on their classroom connections and `call:ended` with reason `declined` in the call room, and the room closes. `call:decline` shares the classroom room's per-connection rate limit; a decline from anyone else, for another caller, or after the call was answered is ignored.
7. **Stop ringing elsewhere:** whenever a ring ends, every classroom connection of the callee gets `call:ring-canceled` `{ callerUserId, reason }`, with reason `answered`, `declined`, `timeout` or `caller_left` (the caller hung up before an answer). The connection that answered receives it too and ignores it.

A caller who replaces their own connection while it rings does not ring the peer again. Once the peer has answered, either leaving ends the call for the other (`peer_left`).

## Limits and close codes

| Limit | Value |
| --- | --- |
| Participants per class call | 12 (`CALL_MAX_PARTICIPANTS`, integer 2-24; a full classroom does not fit a P2P mesh) |
| Participants per direct call | 2 |
| Ring timeout | 30 s (`CALL_RING_TIMEOUT_SECONDS`, integer 5-120) |
| `call:signal` | 150 per second per connection (a join bursts ICE candidates to each peer) |
| `call:self`, `call:emote`, `call:moderate`, `call:end` | 20 per second per connection |

| Close code | Meaning |
| --- | --- |
| `4101` | Call is full |
| `4102` | Call ended (always preceded by `call:ended` with its reason) |
| `4104` | Replaced by a newer connection of the same user |
| `4001` / `4100` | Access revoked / verification unavailable (shared with the classroom room) |

`call:ended` reasons: `moderator_ended`, `host_left`, `peer_left`, `unavailable`, `timeout`, `declined`. A dropped connection is not held: the participant is removed right away and the client rejoins, because the mesh would have to be renegotiated anyway.

## Single-process assumption

The classroom rooms, the call rooms and the ringing registry live in one in-process `RoomDirectory`. This matches the current deployment (one realtime process on one host). Running several realtime processes would need a shared registry for the directory, the class call status and the ringing state; until then a call and a classroom connection must be served by the same process.

## Contract and API

All messages and payloads are the zod schemas in `packages/contracts/src/index.ts`. Voice calls add no HTTP endpoint and no database change, so `openapi.json` is unchanged and `openapi:export` is not needed.
