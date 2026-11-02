# Communication and Notifications (Server Side)

Chat history, announcements, direct messages with parents, mentions, and notifications are persisted resources whose access follows classroom and parent-link permissions. Live delivery and email are conveniences on top of the stored record.

## Authority and scope

- [Master §2.3](../master-document.md#23-herramientas-del-profesor), [§2.5](../master-document.md#25-vista-de-padres), [§2.12](../master-document.md#212-comunicación), and [§6.2](../master-document.md#62-canales-y-propiedad-de-los-datos) define chat, announcements, mentions, parent messages, notifications, and channel ownership.
- Role permissions come from [Classrooms, roles, and permissions](./classrooms-and-roles.md); this rule does not redefine them. The user-interface side of notifications lives in the frontend repository.

## Classroom chat

- Each classroom has one **classroom channel**. Enrolled students and the classroom's teaching staff can read and write it. The chat is open between students; the teacher moderates it and has the full history. Direct student-to-student messages are not part of the scope.
- A message belongs to exactly one classroom and has one author. The server **MUST** set author and timestamp; clients **MUST NOT**.
- Reading and writing **MUST** require current access: enrollment or teacher-level authority (teacher, or school Owner or Admin). Parents **MUST NOT** read or write the classroom chat.
- History **MUST** be returned only to users with current access and **MUST** be paginated with a stable ordering. Teacher-level staff see the whole history, including moderated messages and who removed them.
- Expelling or leaving does not delete messages; they remain attributed.
- Message bodies **MUST** be validated server-side: non-empty after trimming and bounded in length (limit **open**). Content is stored and returned as text; the backend **MUST NOT** interpret or render it as HTML.
- Persistence precedes broadcast: a message **MUST** be stored before it is announced, and a client that missed messages **MUST** be able to recover them from history. Whether the send path is REST followed by a Colyseus broadcast or a validated Colyseus message handled by NestJS is **open**; either way NestJS performs authorization and persistence. See [Realtime and presence](./realtime-and-presence.md).
- Message bodies **MUST NOT** be logged; see [Observability and privacy](./observability-and-privacy.md).
- Sending **MUST** be rate limited per user and classroom to bound abuse.

### Moderation and chat mute

- Teacher-level staff may hide or delete a message. Moderation **MUST** be a recorded state change (who, when, optional reason) rather than a physical deletion, so the teacher keeps the history. Students see moderated messages as removed.
- The teacher can **mute the chat** for a classroom. The mute is a persisted classroom state, checked by the server on every send, so it holds across reconnection and across clients. While muted, students' sends **MUST** be rejected; teaching staff **MAY** still write. Unmuting restores sending. The live broadcast of the change is described in [Realtime and presence](./realtime-and-presence.md).
- Muting a single student is not in the scope and is **open**.
- Automated content filtering (profanity, links) is **open**; if added, it **MUST** run on the server.

## Mentions

- `@` mentions in a message or announcement refer to members of the same classroom. The server **MUST** resolve mentions against the classroom roster and persist a Mention for each resolved member; unresolved text stays plain text.
- A mention creates a notification for the mentioned user only if that user currently has access to the classroom. Mentions **MUST NOT** reveal content to users without access.
- A bound on mentions per message is **open** and **MUST** exist to prevent notification flooding.

## Announcements

- Announcements belong to a classroom's bulletin board. Viewing requires classroom access; parents see announcements of the classrooms their linked children attend only if the product decision allows it (**open**).
- Only teacher-level staff of the classroom may publish. Authors may edit and delete their own; Owner or Admin of the school may edit or delete any announcement of the school's classrooms.
- Announcements created by a user who later leaves are preserved.
- School-wide announcements are an evolution item.

## Parent messages

- Parents can exchange messages with the teacher and with their child. A conversation is bound to one ParentLink (parent and child) and, for the teacher, to the classroom of the child; the server **MUST** verify the link on every read and write.
- A parent **MUST NOT** message or read the messages of unlinked children, other students, or other parents.
- Adult education mode disables parent messaging and links; see [Classrooms, roles, and permissions](./classrooms-and-roles.md).
- Parent-to-teacher and parent-to-child conversations are visible only to their participants and, for audit and safeguarding, to school-level staff. Whether Owner or Admin may read them is **open**; until decided the default is that they **MUST NOT**.
- The same body validation, rate limiting, and logging restrictions as the classroom chat apply.

## Notifications

- Notifications are **in-app** for all roles, and **also by email for parents**. The in-app Notification is the durable record with a read state; email is a delivery channel for it.
- A Notification belongs to one user and is created by NestJS after the triggering change is committed (for example grade published, activity published, mention, new parent message, classroom announcement, invitation). It **MUST NOT** be created by Colyseus or by the client.
- Content **MUST** respect the recipient's current access: a recipient who lost access **MUST NOT** receive new notifications or see old content from that classroom.
- Parent notifications about a child's state **MUST** go only to parents linked to that child and **MUST** carry the minimum data needed, linking to the application for detail.
- Live delivery of `notification:created` is best effort. REST remains the source of truth; clients reconcile through it.

### Email delivery

- Email goes through an external email service invoked from NestJS. The service is a **candidate**, Amazon SES, pending confirmation and justification in `docs/technical-justification.md`. Credentials and sender identity are configuration; see [Configuration and environments](./configuration-and-environments.md).
- Sending **MUST** be asynchronous relative to the request that triggers it and **MUST NOT** block or roll back the committed change. A job or outbox with bounded retries and backoff **MUST** be used; sending **MUST** be idempotent per (notification, channel) so a retry does not duplicate the email.
- Delivery failures **MUST** be recorded (outcome, not content) and surfaced to operators; bounces and complaints **MUST** suppress further mail to that address. The mechanism is **open**.
- Invitation emails carry the invitation link only and **MUST NOT** contain grades or other personal data.
- Email bodies and recipient addresses **MUST NOT** be logged; log the notification identifier and outcome.
- Frequency limits and a digest versus immediate policy for parents are **open**.
- Whether users can opt out of non-essential email is **open**; invitations and security messages are always sent.

## Verification

Tests **MUST** cover: access to the classroom channel by enrollment, staff, and an unrelated user; a parent denied the classroom chat; moderation keeping history for the teacher; chat mute across reconnection; mention resolution and no notification for users without access; parent messages limited to linked children and disabled in adult mode; notification creation only after commit; email retry without duplicates; and recovery after a missed broadcast. Provider calls in tests **MUST** use fakes. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Message length limit and the send path (REST plus broadcast, or validated realtime message).
- Retention of message history and of parent conversations.
- Per-student mute, content filtering, and whether Owner or Admin may read parent conversations.
- Parent visibility of announcements.
- Email service confirmation, digest policy, opt-out, and bounce handling.
