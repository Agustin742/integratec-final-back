# Live Classroom Tools (Server Side)

Live classroom tools are teacher-driven controls and collaboration channels that act on a running classroom. The server authorizes every control, enforces its effect, and never trusts a client to apply a restriction on itself or on others.

## Authority and scope

- [Master §2.8](../master-document.md#28-controles-de-aula-y-herramientas-en-vivo) defines the controls (freeze, mute everyone, chat mute, collaboration lock, game disable) and the tools (video and voice calls, live presentations, collaborative whiteboard, charts, and LaTeX); [§6.2](../master-document.md#62-canales-y-propiedad-de-los-datos) assigns each to its authority and channel.
- Who may use each control comes from [Classrooms, roles, and permissions](./classrooms-and-roles.md): only a user with teacher-level authority over that classroom (its teacher, or the school Owner or Admin) at that moment.
- Live state and broadcast mechanics are in [Realtime and presence](./realtime-and-presence.md); chat mute persistence is in [Communication and notifications](./communication-and-notifications.md); game disabling is in [Points and shop](./points-and-shop.md).

## Classroom controls

- Every control is a message from a teacher-level user. The server **MUST** verify identity, classroom, and current role on each message, not only at join time, and **MUST** ignore the message otherwise. Students and parents **MUST NOT** be able to trigger, cancel, or alter any control.
- Controls that persist across reconnection (chat mute, collaboration lock, game disable) **MUST** be stored as classroom state by NestJS and **MUST** be applied on join. Controls that only make sense for the live session (freeze) are ephemeral in Colyseus; a restart clears them.
- Each control **MUST** be idempotent: repeating "freeze" or "mute" leaves the same state. Each **MUST** have an explicit reverse operation.
- Controls **MUST** be rate limited and logged as audit events (actor, classroom, control, outcome), without content.

### Freeze and seat lock

- **Freeze** sends every avatar to its assigned seat and locks it there. The server owns the seat assignment (one seat per avatar, assigned by the server) and the lock; it **MUST** reject movement input from frozen avatars rather than rely on clients to stop sending it.
- Avatars that join or reconnect while the classroom is frozen **MUST** be placed at a seat and locked. Avatars that cannot be seated (more users than seats) are an **open** case.
- Whether the teacher is exempt from the lock (the default is that teacher-level users are exempt) and whether students may still use seat-bound interactions (chat, desk, bot) while frozen are **open**; the rule recorded **MUST** be enforced by the server.
- Unfreezing releases the lock and restores free movement without teleporting avatars.

### Mute everyone

- **Mute everyone** silences the voice and video-call audio of all students. The server enforces it by withholding or revoking publish permission in the media service, not only by asking clients to mute.
- Students **MUST NOT** be able to unmute themselves while the classroom is muted. Whether a student can raise a hand or be selectively unmuted by the teacher is **open**.

### Chat mute

- Chat mute is persisted classroom state checked on every message send; see [Communication and notifications](./communication-and-notifications.md). Live notice of a change is broadcast as `chat:muted`.

### Collaboration lock

- The teacher can lock collaboration on the whiteboard, charts, and LaTeX. While locked, student edits **MUST** be rejected by the server; the teacher keeps edit rights. The lock is classroom state and **MUST** hold across reconnection.
- The lock **MUST** be checked on every edit message, not at tool open.

### Disable mini-games

- The teacher disables mini-games at will. The state is persisted and broadcast; the server rejects game sessions when disabled. See [Points and shop](./points-and-shop.md).

## Calls and live presentations

- Video calls, voice calls, and live presentations use a **media service**. The service is a **candidate**: LiveKit or Amazon Chime SDK, to be decided and justified in `docs/technical-justification.md`. This rule is independent of the choice.
- NestJS issues **short-lived access credentials** for a media session only after verifying that the requester has current access to the classroom. A client-supplied room name **MUST NOT** select the session; the server maps a classroom to a media session.
- Credentials **MUST** carry only the permissions the role needs: teachers may publish and moderate; students' publish permission follows the mute-everyone state and the presentation rule. Credentials **MUST NOT** be logged and **MUST NOT** appear in URLs that are logged.
- Access loss, expulsion, session end, or logout **MUST** remove the participant from the media session promptly.
- A live presentation is started and ended by teacher-level staff; whether a student may present when the teacher allows it is **open**.
- Recording of calls and presentations is **not in scope**. If added later it needs a decision covering minors, consent, and retention.
- Media traffic does not pass through NestJS or Colyseus; the media service handles it. Network and security-group requirements are in [AWS infrastructure](./aws-infrastructure.md).
- If the media service is unavailable, the classroom, chat, and activities **MUST** keep working, and the client **MUST** receive a clear non-technical error.

## Collaborative whiteboard, charts, and LaTeX

- The whiteboard, chart tool, and LaTeX editor are collaborative. The synchronization mechanism is a **candidate**: Colyseus synchronized state or a CRDT library (for example Yjs), to be decided; see [Realtime and presence](./realtime-and-presence.md).
- Edits **MUST** be accepted only from users who are in the classroom and permitted by the collaboration lock; identity comes from the authenticated session, never from the payload.
- Edit messages **MUST** be validated for shape, size, and rate; document size **MUST** be bounded. LaTeX and other text content **MUST** be rendered by clients as data and **MUST NOT** be interpreted as HTML or executed.
- Whether the content is persisted (to keep a board after the session, to share it as material, or to export) is **open**. If persisted, saving is a NestJS operation after authorization, and the snapshot belongs to the classroom with an author and timestamp.
- Live edit streams **MUST NOT** be written to PostgreSQL per operation; only snapshots, if adopted.
- Each tool belongs to a classroom board; boards of different classrooms **MUST NOT** share state.

## Abuse prevention

- Per-connection and per-user rate limits apply to control messages, edit messages, and media credential requests.
- A malformed or unauthorized control message **MUST** be dropped without side effects and without revealing the existence of other classrooms.

## Verification

Tests **MUST** cover: each control rejected for student, parent, other-classroom teacher, and unauthenticated senders; accepted for the classroom's teacher and for the school Owner or Admin; freeze applying to later joins and rejecting movement input; controls persisting across reconnection; collaboration lock rejecting student edits; media credentials denied without classroom access; credentials expiring; and removal from the media session after access loss. Provider calls in tests **MUST** use fakes. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Media service (LiveKit or Amazon Chime SDK) and credential format.
- Collaborative sync approach (Colyseus state or a CRDT such as Yjs) and persistence of boards.
- Seat assignment when seats are fewer than users, teacher exemption, and what students may do while frozen.
- Hand raising and selective unmuting; student presenters.
- Recording of calls (not in scope).
