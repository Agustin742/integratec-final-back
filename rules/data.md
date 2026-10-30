# Relational Data Model Rules

PostgreSQL, accessed through Prisma, is the system of record for durable domain data. This rule fixes the model's constraints; [master §6.4](../master-document.md#64-modelo-de-información-general) delegates the relational model here. Identifier and time conventions are in [Data and time](./data-and-time.md) and are not repeated.

## Authority and scope

- Entities come from [master §6.4](../master-document.md#64-modelo-de-información-general) and the product scope in [master §2](../master-document.md#2-alcance-funcional-del-producto). The `docs/` requirement documents still describe the earlier office and room model and are pending realignment; they are not authoritative for this model.
- This rule defines entities, relationships, and invariants, not final column names or types. Anything not stated here is **open**.
- Business permissions are defined in [Classrooms, roles, and permissions](./classrooms-and-roles.md).

## Entities

| Entity | Purpose | Key relationships |
|---|---|---|
| User | Account: email, display name, password hash | Many memberships; one avatar configuration |
| Session | Server-side session record, if the chosen mechanism needs one (open) | Belongs to a user |
| AvatarConfiguration | Persistent avatar appearance | One per user |
| School | Isolation unit of the school path | One Owner; many members and classrooms |
| SchoolMember | Membership with school role (Owner, Admin, Teacher) and state | Joins User and School |
| Classroom | Persistent classroom; owned by a School or by an independent teacher (exactly one); adult-mode flag; chat-mute, collaboration-lock, and games-disabled state | Belongs to a School or to an independent teacher; has teachers, enrollments, content, one Pet |
| Enrollment | A student's membership in a classroom, and state | Joins User and Classroom |
| ParentLink | Link from a parent to one child, within a classroom context | Joins parent User and child User; a parent has many links |
| Invitation | Hashed secret, target email, target (school or classroom), role, expiry, state | Belongs to a School or Classroom; has a creator |
| Material | File uploaded by the teacher (stored in object storage) | Belongs to a classroom; has an author |
| Activity | TP or exam; format file or multiple choice; due date or exam window | Belongs to a classroom |
| Question / Option | Multiple-choice question and its options, with correct marking | Belong to an activity |
| Submission | A student's work for an activity (files or answers) | Joins Activity and student |
| Grade | Score for a submission | One per submission; references the converting ledger entry |
| PointsTransaction | Immutable ledger entry of points (earning, purchase, correction) | Belongs to a student; references its source |
| ShopItem | Catalog entry: kind (classroom item or pet accessory), price | Referenced by purchases |
| ClassroomItem | Item a classroom owns after purchase, with state | Belongs to a classroom; references a ShopItem |
| Pet / PetAccessory | The classroom's single pet and the accessories it owns or has equipped | Pet belongs to a classroom |
| Streak | Current and best streak per student, with last qualifying day | Belongs to a student |
| Announcement | Bulletin-board notice | Belongs to a classroom; has an author |
| Message | Text in the classroom channel, or in a parent conversation | Belongs to a classroom or a ParentLink conversation; has an author; moderation state |
| Mention | Resolved `@` reference in a message or announcement | References the source and the mentioned user |
| Notification | In-app notice with read state and email-delivery state | Belongs to a user |
| BotConfig / AllowedMaterial | Teacher's bot configuration and which Materials the bot may use | Belong to a classroom |
| BotConversation | Bot exchange metadata | Belongs to a user and classroom (persistence open) |
| DailyReviewDelivery | Record that a day's review was delivered | Joins User and a local date |
| ActivityMetric | Aggregated connected time, submissions, and participation | Per student and classroom, per interval |
| Medal | Achievement awarded to a student | Joins student and a medal type (catalog open) |

- Every durable entity **MUST** use the identifier and timestamp conventions in [Data and time](./data-and-time.md).
- The pet and the AI bot are independent: no entity links Pet or PetAccessory to BotConfig or BotConversation.
- A Message **MUST** belong to exactly one context, the classroom channel or a parent conversation; the constraint **MUST** be enforced in the database.
- A Classroom **MUST** reference exactly one of School or independent teacher; the constraint **MUST** be enforced in the database.
- The school Owner, the classroom's Pet, and default records **MUST** be created together with their parent in one transaction.

## Authorization model

- A school **Owner or Admin has teacher-level authority over every classroom of that school**. This is derived from SchoolMember and the classroom's school; it **MUST NOT** require, and the model **MUST NOT** create, a per-classroom membership for them.
- A **Teacher** has authority only over classrooms in which they are recorded as a teacher.
- A **Parent** reads only data of children linked by a ParentLink; the link is the only path.
- Queries for any of these **MUST** express the rule through the same shared authorization service so that REST, Colyseus-driven checks, and the bot apply one implementation; see [Architecture](./architecture.md).

## Constraints and uniqueness

- User email **MUST** be unique after normalization.
- (School, user) **MUST** be unique among school memberships; a school **MUST** have exactly one Owner membership, which **MUST NOT** be reassigned except through the transfer operation.
- (Classroom, student) **MUST** be unique among enrollments.
- (Parent, child, classroom context) **MUST** be unique among parent links. ParentLink creation **MUST** be rejected for a classroom in adult mode.
- A Classroom **MUST** have exactly one Pet. Accessory ownership **MUST** be unique per (pet, shop item).
- A Submission **MUST** be unique per (activity, student) unless resubmission history is adopted (open); a Grade **MUST** be unique per submission.
- A PointsTransaction **MUST** be unique per (source type, source id) for earnings, and entries **MUST** be immutable.
- Streak **MUST** have one row per student, and the qualifying-day record **MUST** be unique per (student, local day).
- Mention **MUST** be unique per (source, mentioned user).
- AllowedMaterial **MUST** be unique per (classroom, material).
- DailyReviewDelivery **MUST** be unique per (user, local date in America/Argentina/Buenos_Aires) so the review is delivered once; see [AI bot and daily briefing](./ai-bot-and-daily-briefing.md).
- Notification delivery **MUST** be unique per (notification, channel) to make email sending idempotent.
- Invitations **MUST** store only a hash of their secret, and the hash **MUST** be unique.
- Foreign keys **MUST** be declared. Cross-table rules that the database cannot express (for example a submission's student being enrolled in the activity's classroom, or a purchase staying within the balance) **MUST** be enforced in the service layer inside a transaction and verified by tests.
- Required, optional, and empty values **MUST** be modeled deliberately (see [Data and time](./data-and-time.md)).

## Deletion and lifecycle

| Case | Policy |
|---|---|
| Removing a member or a member leaving | Logical deactivation; their messages, submissions, grades, and announcements remain |
| Archiving or deleting a classroom | **Open**; no deletion path is defined in the MVP |
| Deleting a school | **Open**; the effect on classrooms and records requires a decision (including minors' data) |
| Deleting an activity | Refused when submissions or grades exist; otherwise decided per [Activities and grading](./activities-and-grading.md) |
| Moderating a message | State change (hidden with actor and time); the teacher keeps the history |
| Revoking an invitation | State change; existing memberships are unaffected |
| Points correction | New compensating PointsTransaction; entries are never edited or deleted |
| Deleting a user account | **Open**; no account deletion is in the MVP scope |

- Cascading deletes **MUST** be explicit and limited to cases the policy defines. Ownership of user-generated content by a deactivated membership **MUST NOT** cascade into deletion.
- Retention of messages, bot conversations, submissions, and files is **open**. Data of minors **MUST** be limited to what features require.

## What is not persisted

Per [master §6.4](../master-document.md#64-modelo-de-información-general): every movement frame, transient positions, active connections, and interpolated avatar states **MUST NOT** be rows. Connected time is aggregated into ActivityMetric, never stored per instant. Presence, freeze lock, and collaborative edit streams live in Colyseus or the collaboration service ([Realtime and presence](./realtime-and-presence.md), [Live classroom tools](./live-classroom-tools.md)); only the persisted classroom states named above are stored.

## Prisma and migrations

- The Prisma schema is the single source of truth for structure; changes **MUST** be made through reviewed migrations committed to the repository. Editing a database by hand or applying `db push` to shared environments **MUST NOT** occur.
- Applied migrations **MUST NOT** be edited; corrections are new migrations.
- Each migration **MUST** be reviewed for locks, data loss, and backfills, and data-changing migrations **MUST** have an execution and recovery plan before deployment ([Deployment and operations](./deployment-and-operations.md)).
- Multi-step business changes (registration, invitation acceptance, grading with points, purchases) **MUST** run in transactions.
- Queries **MUST** use Prisma's parameterized API; raw SQL, when unavoidable, **MUST** be parameterized ([Security](./security.md)).
- List queries **MUST** define ordering and pagination, and **SHOULD** have indexes for the access filters that use them (school, classroom, user, date).
- API responses **MUST** be built through DTOs; password hashes, invitation hashes, correct-answer markings for students, and internal columns **MUST NOT** be selected for output.
- Seed data **MUST** be synthetic and **MUST NOT** contain real credentials or real minors' data.

## Open decisions

- Final table and column names, enum values, and field limits.
- Session storage, if the chosen mechanism needs it ([Authentication and session](./authentication-and-session.md)).
- Ledger scope (per classroom or global) and medal catalog.
- Resubmission history and grade history representation.
- Message, bot-conversation, and file retention; whether bot conversations are persisted.
- School, classroom, and account deletion effects.
- Storage representation of instants; this project interprets "Buenos Aires time" as timezone-aware instants presented in that zone, to be confirmed.
- Whether one user may hold a school path and an independent-teacher path under one account.
