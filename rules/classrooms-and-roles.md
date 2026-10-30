# Classrooms, Roles, and Permissions

Every access decision is made on the server from persisted membership and role. A visible door, a client store, or a live connection never grants authority.

## Authority and scope

- [Master §2.1](../master-document.md#21-escuelas-profesores-y-aulas) and [§2.2](../master-document.md#22-roles-permisos-e-invitaciones) define the organization paths, classrooms, roles, and the capability matrix. This rule turns them into server-side constraints; where they differ, the master document prevails until the team resolves the conflict.
- [Security](./security.md) governs protected operations; [Authentication and session](./authentication-and-session.md) governs `401` versus `403` and registration; [Data](./data.md) holds the entities.
- The `docs/` requirement documents still describe the earlier office and room model and are pending realignment. They **MUST NOT** be used to derive permissions.

## Organization paths and classrooms

- At registration a user chooses one of two paths: **independent teacher** (teacher, then classrooms) or **school** (school, then teachers, then classrooms). The chosen path **MUST** be persisted and creates its structure atomically.
- A **school** is the unit of data isolation for a school path. The user who creates it is its Owner.
- A **classroom** is the persistent unit that groups its teacher, students, material, activities, chat, announcements, shop items, and pet. It belongs to exactly one organization: a school, or an independent teacher. The database **MUST** enforce that exactly one of the two is set.
- A classroom exists independently of connections. A Colyseus room is a separate, disposable concept; see [Realtime and presence](./realtime-and-presence.md).
- Data **MUST NOT** cross schools or independent-teacher accounts: no query, list, notification, or bot retrieval may return content of an organization or classroom the actor has no relationship with.
- No global administrator exists; roles are scoped to a school or to a classroom.

## Roles

| Role | Scope | Notes |
|---|---|---|
| School Owner | School | One per school; creates and manages the school, invites teachers, may transfer or delete it |
| School Admin | School | Delegated by the Owner; scope of delegation is an open decision |
| Teacher | Classrooms they teach | Independent teachers are Teachers of their own classrooms; school teachers are invited by Owner or Admin |
| Student | Classrooms they are enrolled in | Own activities, grades, points, and shop |
| Parent | Linked children | Sees only the data of linked children; may have several children |

- Owner, Admin, and Teacher are **staff roles**. A user may hold different roles in different contexts (for example Teacher in one school and Parent elsewhere); each is a separate membership and **MUST** be evaluated per context.
- **School Owner and Admin hold teacher-level authority over every classroom of their school without a per-classroom membership.** The server **MUST** derive this from the SchoolMember role of the classroom's school, not from enrollment or classroom membership.
- A **Teacher** holds teacher-level authority only over classrooms they teach. A Teacher **MUST NOT** act on another teacher's classroom, even within the same school.
- A **Parent** **MUST** only read data of children linked to them through an explicit ParentLink. The link is the sole source of that access.
- A **Student** **MUST** only read and write their own submissions, grades, points, and purchases, plus classroom content meant for students.

## Permission matrix

Server-side enforcement is required for every row. "Own classroom" means a classroom the actor teaches; Owner and Admin count as such for every classroom of their school.

| Action | Owner / Admin | Teacher | Student | Parent |
|---|---|---|---|---|
| Manage school, invite teachers, transfer or delete the school | Owner (Admin per delegation) | No | No | No |
| Create and configure classrooms | Yes | Own | No | No |
| Invite students and parents to a classroom | Yes | Own classroom | No | No |
| Publish material, announcements, and activities; grade | Yes | Own classroom | No | No |
| Moderate chat and use classroom controls (freeze, mute, lock collaboration, disable games) | Yes | Own classroom | No | No |
| Configure the bot and allowed material | Yes | Own classroom | No | No |
| View activity metrics | Any classroom of the school | Own classroom | Own only | Linked child only |
| View and submit activities, view grades, use the shop | No | No | Yes | Grades of linked child |
| Chat with classmates | Staff only for moderation | Yes | Yes | No |
| Message the teacher | Yes | Yes | Yes | Yes (teacher and child) |

Implementers **MUST NOT** extend the matrix. Changes require updating this rule and the master document together.

## Server-side checks

- Every protected read or mutation **MUST** verify authentication, then the relevant membership (school, enrollment, or parent link), then the role, in that order, from current persisted state.
- Identifiers in paths, bodies, and realtime messages **MUST** be treated as untrusted. The server **MUST** resolve the resource, derive its classroom and school, and check the actor against those, not against client-supplied identifiers (ID tampering).
- A request for a resource the actor cannot access **MUST NOT** reveal its existence. The `403` versus `404` choice is **open** and tracked in [Authentication and session](./authentication-and-session.md).
- List endpoints **MUST** filter results by the actor's access rather than rely on the caller to pass a scope.
- A rejected action **MUST NOT** change persisted state.
- Interacting with a classroom object (desk, board, shop) grants nothing on the related resource; the resource's own check always applies.
- Live classroom controls are accepted only from a user who is authorized as teacher for that classroom at that moment; see [Live classroom tools](./live-classroom-tools.md).

## Invitations and membership

- Onboarding is by **email invitation**: Owner or Admin invite teachers; teachers (and Owner or Admin) invite students and parents to a classroom. An invitation is bound to one target (school or classroom), one role, and one email address.
- The raw invitation secret **MUST NOT** be stored; only a hash **MUST** be persisted. The invitation **MUST** carry an expiry, be revocable, and be single use. Lifetime defaults are configuration, not fixed in code.
- Lookup, expiry, revocation, use, and membership creation **MUST** be validated and applied atomically so concurrent acceptances cannot create duplicate memberships.
- Acceptance **MUST** require authentication as the invited account. Whether the invited email must match the account email exactly is **open**; the default is that it **MUST** match after normalization.
- Invitation delivery goes through the email service described in [Communication and notifications](./communication-and-notifications.md). An invitation request **MUST NOT** reveal whether the address already has an account.
- Invitations **MUST NOT** be accepted for a deleted school or classroom, and accepting twice **MUST NOT** duplicate the membership.
- Expelling or removing a member is a logical deactivation: created content (messages, submissions, grades) is preserved and attributed. Loss of access **MUST** apply immediately, including to live connections.

## Parents and adult mode

- A parent is linked to each child by a ParentLink created through an invitation that the school or teacher issues; a parent **MAY** have many children and a child **MAY** have several parents or guardians (count limit is **open**).
- A classroom (or school) **MAY** run in **adult education mode**: students use their own email, and ParentLink creation, parent invitations, and parent notifications **MUST** be rejected for that classroom. The mode is a persisted classroom property.
- Switching a classroom to adult mode while parent links exist is **open**; until decided, the server **MUST** refuse the switch when active links exist.
- Data about minors **MUST** be limited to what the features require and **MUST NOT** be exposed across classrooms or schools; see [Observability and privacy](./observability-and-privacy.md).

## Verification

Tests **MUST** cover each matrix row for allowed and denied roles; Owner or Admin acting on any classroom of their school and denied on another school; a Teacher denied on another teacher's classroom; a Parent denied on unlinked children; cross-school identifiers; independent-teacher isolation; adult mode rejecting parent links; and expired, revoked, reused, and concurrent invitations. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Whether a foreign resource returns `403` or `404`.
- What Admin delegation covers compared with the Owner (transfer or deletion of the school).
- Whether the invited email must match the account email exactly.
- Maximum guardians per child, and behavior when switching a classroom to adult mode with existing links.
- Whether a user may belong to several schools or both paths with a single account.
- Account and school deletion effects on retained records.
