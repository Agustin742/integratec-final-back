# Relational Data Model Rules

PostgreSQL, accessed through Prisma, is the system of record for durable domain data. This rule fixes the model's constraints; [master §6.4](../master-document.md#64-modelo-de-información-general) delegates the relational model here. Identifier and time conventions are in [Data and time](./data-and-time.md) and are not repeated.

## Authority and scope

- Entities come from [master §6.4](../master-document.md#64-modelo-de-información-general) and the conceptual entities in section 7 of the [functional requirements](../docs/functional-requirements.md). Where they differ, the requirements prevail for office and room modeling.
- This rule defines entities, relationships, and invariants, not final column names or types. Anything not stated here is **open**.
- Business permissions are defined in [Rooms and permissions](./rooms-and-permissions.md).

## Entities

| Entity | Purpose | Key relationships |
|---|---|---|
| User | Account: email, display name, password hash | Has one own office, many memberships, one avatar configuration |
| Session | Server-side session record, if the chosen mechanism needs one (open) | Belongs to a user |
| AvatarConfiguration | Persistent avatar appearance | One per user |
| Office | Isolation unit; state active or deactivated with timestamp | One Owner; many memberships and rooms |
| OfficeMember | Membership with office role (Owner, Administrator, Member) and state (active or deactivated) | Joins User and Office |
| Room | Space inside an office; one is the main room | Belongs to an office |
| RoomAccess | A member's permission to enter a room | Joins OfficeMember and Room |
| RoomLeadership | Leader mark for a member in a room | Joins OfficeMember and Room |
| RoomItem | Placed interactive object | Belongs to a room |
| BoardColumn | Named, ordered column of a room's board | Belongs to a room |
| Task | Title, description, assignee, due date, priority | Belongs to a column and room; optional assignee |
| Announcement | Bulletin-board notice | Belongs to a room; has an author |
| Meeting | Event with start, end, and active or cancelled state | Belongs to a room; has a creator |
| Attendance | A user's response to a meeting | Joins User and Meeting |
| Message | Text sent to a channel | Belongs to an office (office channel) or a room (room channel); has an author |
| Notification | In-app notice with read state | Belongs to a user |
| Invitation | Hashed link secret, expiry, optional use limit, state | Belongs to an office; has a creator |
| DailyReviewDelivery | Record that a day's briefing was delivered | Joins User and a local date |
| BotConversation | Bot exchange metadata | Belongs to a user (persistence open) |

- Every durable entity **MUST** use the identifier and timestamp conventions in [Data and time](./data-and-time.md).
- A Message **MUST** reference exactly one of office or room as its channel; the constraint **MUST** be enforced in the database.
- The main room, the single Owner per office, and the default board columns **MUST** be created together with their parent in one transaction.

## Constraints and uniqueness

- User email **MUST** be unique after normalization.
- (Office, user) **MUST** be unique among memberships; (room, member) **MUST** be unique for access and for leadership.
- An office **MUST** have exactly one Owner membership, and it **MUST NOT** be reassigned.
- A user **MUST** have exactly one own office, created at registration (RN-01). Whether a user may exist without one after permanent office deletion remains open (P-05).
- Each office **MUST** have exactly one main room; additional rooms **MUST NOT** exceed the configured limit (default 5), enforced transactionally.
- Board column names **MUST** be unique within a room, and a room **MUST** keep at least one column.
- Attendance **MUST** be unique per (meeting, user).
- DailyReviewDelivery **MUST** be unique per (user, local date in America/Argentina/Buenos_Aires) so the briefing is delivered once; see [AI bot and daily briefing](./ai-bot-and-daily-briefing.md).
- Invitations **MUST** store only a hash of their secret, and the hash **MUST** be unique.
- Foreign keys **MUST** be declared. A task's assignee, when present, **MUST** have access to the task's room; this cross-table rule **MUST** be enforced in the service layer and verified by tests when the database cannot express it.
- Required, optional, and empty values **MUST** be modeled deliberately (see [Data and time](./data-and-time.md)).

## Deletion and lifecycle

| Case | Policy |
|---|---|
| Expelling a member or a member leaving | Logical deactivation of the membership; their messages, tasks, and announcements remain (RN-13) |
| Deactivating an office | Logical, with a timestamp; recoverable by the Owner for 15 days; nothing is deleted at that moment (RN-14) |
| Permanent office deletion after 15 days | Deletes the office and its rooms, tasks, announcements, meetings, messages, and related records in a controlled, idempotent job |
| Deleting an additional room | Deletes its content without recovery (assumption P-06) |
| Deleting a task | Hard delete in the MVP unless a soft-deletion decision is recorded |
| Cancelling a meeting | State change, not deletion |
| Revoking an invitation | State change; existing memberships are unaffected (RF-OFI-006) |
| Deleting a user account | **Open**; no account deletion is in the MVP scope |

- Cascading deletes **MUST** be explicit and limited to the permanent-deletion and room-deletion cases above. Ownership of user-generated content by a deactivated membership **MUST NOT** cascade into deletion.
- Retention of messages and bot conversations is **open**.

## What is not persisted

Per [master §6.4](../master-document.md#64-modelo-de-información-general): every movement frame, transient positions, active connections, and interpolated avatar states **MUST NOT** be rows. Presence lives in Colyseus ([Realtime and presence](./realtime-and-presence.md)).

## Prisma and migrations

- The Prisma schema is the single source of truth for structure; changes **MUST** be made through reviewed migrations committed to the repository. Editing a database by hand or applying `db push` to shared environments **MUST NOT** occur.
- Applied migrations **MUST NOT** be edited; corrections are new migrations.
- Each migration **MUST** be reviewed for locks, data loss, and backfills, and data-changing migrations **MUST** have an execution and recovery plan before deployment ([Deployment and operations](./deployment-and-operations.md)).
- Multi-step business changes (registration, invitation acceptance, column deletion, office deletion) **MUST** run in transactions.
- Queries **MUST** use Prisma's parameterized API; raw SQL, when unavoidable, **MUST** be parameterized ([Security](./security.md)).
- List queries **MUST** define ordering and pagination, and **SHOULD** have indexes for the access filters that use them (office, room, user, date).
- API responses **MUST** be built through DTOs; password hashes, invitation hashes, and internal columns **MUST NOT** be selected for output.
- Seed data **MUST** be synthetic and **MUST NOT** contain real credentials.

## Open decisions

- Final table and column names, enum values, and field limits.
- Session storage, if the chosen mechanism needs it ([Authentication and session](./authentication-and-session.md)).
- Message and bot-conversation retention; whether bot conversations are persisted.
- Account deletion and the effects of permanent office deletion on a user's own-office rule (P-05).
- Storage representation of instants and the exact meaning of "stored in Buenos Aires time" in the requirements (ERS section 2.4), which this project interprets as timezone-aware instants presented in that zone; to be confirmed.
- Team diagram proposals that model per-room membership roles, a fixed task status enum, or optional office-wide meetings differ from the requirements above; they are not authoritative until reconciled.
