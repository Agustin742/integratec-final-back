# Communication and Meetings (Server Side)

Chat history, announcements, and meetings are persisted resources whose access follows office and room permissions. Live delivery is a convenience on top of the stored record.

## Authority and scope

- [Master §2.4](../master-document.md#24-comunicación-y-reuniones) and [§6.2](../master-document.md#62-canales-y-propiedad-de-los-datos) define chat, announcements, meetings, and channel ownership; behavior is specified by RF-CHA-001 to RF-CHA-010 and RF-CAR-001 to RF-CAR-012 in the [functional requirements](../docs/functional-requirements.md).
- Role permissions come from [Rooms and permissions](./rooms-and-permissions.md); this rule does not redefine them.

## Chat

- There are two channels: the **office channel** (all active members) and a **room channel** (members with access to that room). Direct messages are evolution and **MUST NOT** be implemented in the MVP (RF-CHA-009).
- A message belongs to exactly one channel and has one author. The server **MUST** set author and timestamp; clients **MUST NOT**.
- Reading and writing a channel **MUST** require current membership of the office, and for room channels current access to the room (RF-CHA-001, RF-CHA-002).
- History **MUST** be returned only to users with current access. A user who loses access cannot read the history; if access is restored, the full history becomes readable again (RN-12, RF-CHA-007, assumption P-11).
- Expelling or leaving does not delete messages; they remain attributed (RN-13).
- History endpoints **MUST** be paginated with a defined stable ordering so older messages load progressively (RF-CHA-006).
- Message bodies **MUST** be validated server-side: non-empty after trimming and bounded in length (limit **open**). Content is stored and returned as text; the backend **MUST NOT** interpret or render it as HTML.
- Persistence precedes broadcast: a message **MUST** be stored before it is announced to connected clients, and a client that missed messages during a disconnection **MUST** be able to recover them from history (RF-CHA-005). Whether the send path is REST followed by a Colyseus broadcast or a validated Colyseus message handled by NestJS is **open**; either way NestJS performs the authorization and persistence. See [Realtime and presence](./realtime-and-presence.md).
- Message bodies **MUST NOT** be logged; see [Observability and privacy](./observability-and-privacy.md).
- Editing and deleting messages is an evolution item. When added, authors manage their own and Administrators and Owners may delete others' (RF-CHA-010).

## Announcements

- Announcements belong to a room's bulletin board. Viewing requires room access.
- Owner, Administrator, and Leader of the room may publish; Members may not.
- Authors may edit and delete their own. Only Administrator and Owner may edit or delete announcements of others; a Leader **MUST NOT**, even in their own room (RF-CAR-003, RF-CAR-004).
- Announcements created by a user who later loses access or is expelled **MUST** be preserved (RF-HAB-010).
- Office-wide announcements are an evolution item (RF-CAR-011).

## Meetings and attendance

- A meeting belongs to a room and has a title, description, start, and end; the server **MUST** reject an end before the start (RF-CAR-005).
- Creation follows the announcement permissions. The creator may edit or cancel; Administrator and Owner may do so for any meeting; a Leader cannot change another person's meeting (RF-CAR-006).
- Cancelling **MUST** mark the meeting cancelled rather than delete it, so attendees can be informed.
- Any user with access may confirm or decline attendance and change it until the meeting is past or cancelled; the server **MUST** enforce that rule and keep at most one response per user and meeting (RF-CAR-007).
- Attendee lists **MUST** include only users with access to the room.
- Date and time handling follows [Data and time](./data-and-time.md); times are presented in America/Argentina/Buenos_Aires (RN-19). The storage representation is decided in [Data](./data.md).
- Recurring meetings and reminders are evolution items (RF-CAR-012).

## Notifications

Notifications of new meetings, changes, and assignments (RF-NOT-002) are in-app for the MVP; email notifications are evolution. Notification content **MUST** respect the recipient's current access.

## Verification

Tests **MUST** cover channel isolation between offices and rooms, access loss and restoration, pagination, role-by-role announcement and meeting edits, invalid times, attendance after cancellation, and recovery after a missed broadcast. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Message length limit and the send path (REST plus broadcast, or validated realtime message).
- Retention policy for message history.
- Whether announcements and meetings also support office-wide scope.
