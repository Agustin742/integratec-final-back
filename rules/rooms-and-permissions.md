# Offices, Rooms, and Permissions

Every access decision is made on the server from persisted membership and role. A visible door, a client store, or a live connection never grants authority.

## Authority and scope

- [Master §2.1](../master-document.md#21-oficinas-y-habitaciones) and [§2.6](../master-document.md#26-acceso-roles-y-permisos) define offices, rooms, and roles. The permission matrix comes from the closed decisions in [requirements decisions](../docs/requirements-decision.md) and sections 3 and 4 of the [functional requirements](../docs/functional-requirements.md) (RN-01 to RN-20). Where this rule and those documents differ, the requirements prevail until the team resolves the conflict.
- [Security](./security.md) governs protected operations; [Authentication and session](./authentication-and-session.md) governs `401` versus `403`.

## Offices and rooms

- An **office** is the unit of data and permission isolation. Each user has exactly one own office, created at registration, and may belong to many others (RN-01, RN-03).
- Each office has exactly one Owner and a **main room** that every member can enter and that cannot be deleted (RN-02, RN-04).
- An office may have at most 5 additional rooms; the limit **MUST** be enforced on the server and **SHOULD** be configurable (RN-05, RF-HAB-013).
- Room access is a binary permission per member. Joining by invitation grants membership with access to the main room only (RN-06).
- Persistent rooms and offices **MUST** exist independently of connections. A Colyseus room instance is a separate, disposable concept; see [Realtime and presence](./realtime-and-presence.md).
- No global administrator exists; roles are scoped to an office.

## Roles

| Role | Scope | Notes |
|---|---|---|
| Owner | Office | One per office, not transferable; has every permission and room access (RN-02, RN-07) |
| Administrator | Office | Named and removed only by the Owner; cannot act on the Owner (RN-08, RN-09) |
| Leader | Single room | Several per room; independent of the office role; must have access to the room (RN-10) |
| Member | Office | Participates in rooms they can access |

- An office role is single per user per office. Leader status is additive per room.
- Owner and Administrator hold Leader permissions in every room of the office.
- Loss of room access **MUST** also remove Leader status in that room.

## Permission matrix

Server-side enforcement is required for every row. "Room access" means the actor can enter that room.

| Action | Owner | Admin | Leader | Member |
|---|---|---|---|---|
| Delete or restore the office | Yes | No | No | No |
| Name or remove Administrators | Yes | No | No | No |
| Edit office data | Yes | Yes | No | No |
| Create and revoke invitations | Yes | Yes | No | No |
| Expel a member | Yes | Yes (not the Owner) | No | No |
| Leave the office | No | Yes | Yes | Yes |
| Create, edit, delete additional rooms | Yes | Yes | No | No |
| Assign or remove Leaders | Yes | Yes | No | No |
| Grant or revoke room access | Yes | Yes | Own room, existing office members only | No |
| Tasks: create, edit, move, delete | Room access | Room access | Room access | Room access |
| Configure board columns | Yes | Yes | Yes | No |
| Announcements and meetings: create | Yes | Yes | Yes | No |
| Announcements and meetings: edit or delete own | Yes | Yes | Yes | No |
| Announcements and meetings: edit or delete others' | Yes | Yes | No | No |
| Chat, attendance, bot, presence list | Yes | Yes | Yes | Yes |

Implementers **MUST NOT** extend the matrix. Changes require updating this rule and the requirements together.

## Server-side checks

- Every protected read or mutation **MUST** verify authentication, office membership, room access, and role, in that order, from current persisted state.
- Identifiers in paths, bodies, and realtime messages **MUST** be treated as untrusted. The server **MUST** resolve the resource, derive its office and room, and check the actor against those, not against client-supplied office or room IDs (ID tampering; RN-03).
- A request for a resource of an office or room the actor cannot access **MUST NOT** reveal its existence (RF-HAB-011). The `403` versus `404` choice is **open** and tracked in [Authentication and session](./authentication-and-session.md).
- Bulk and list endpoints **MUST** filter results by the actor's access rather than rely on the caller to pass a scope.
- A rejected action **MUST NOT** change persisted state.
- Interacting with a room object grants nothing on the related resource (RN-20).

## Invitations and membership changes

- An invitation is a unique, unguessable link bound to one office, with an expiry and an optional maximum number of uses; it is revocable and grants only Member status (RF-OFI-005, RF-OFI-006, RN-06). Lifetime defaults are configuration, not fixed in code (P-03).
- The raw invitation secret **MUST NOT** be stored; only a hash **MUST** be persisted. Lookup, expiry, revocation, usage count, and membership creation **MUST** be validated and applied atomically so concurrent acceptances cannot exceed the limit.
- Invitations **MUST NOT** be accepted for a deactivated office, and an already-member acceptance **MUST NOT** duplicate the membership. A previously expelled user who rejoins starts with main-room access only (RF-OFI-008).
- Expelling is a logical deactivation of the membership: created content is preserved and the user may be re-invited (RN-13). The Owner cannot leave; the office can only be deactivated (RN-15).
- Deactivating an office is logical and recoverable by the Owner for 15 days, after which the system deletes it permanently (RN-14, RF-OFI-014 to RF-OFI-016). During deactivation nobody can enter. The permanent-deletion job **MUST** be idempotent.
- Losing room access **MUST** apply immediately, including to live connections: the user stops seeing the room, cannot read its chat history, and assigned tasks become orphaned (RN-12, RF-HAB-010).
- Email invitations and access requests are evolution items and **MUST NOT** be added to the MVP without a decision.

## Verification

Tests **MUST** cover each matrix row for allowed and denied roles, cross-office identifiers, room access without office membership, expired, revoked, exhausted, and concurrent invitations, and access loss while connected. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Whether a foreign resource returns `403` or `404`.
- Whether a user may create a new own office after the previous one is permanently deleted (P-05).
- Whether Administrators may act on other Administrators; proposal P-07 reserves that to the Owner, but RN-08 only protects the Owner.
- Read-only room access (RF-HAB-012) and office-wide announcements (RF-CAR-011) are evolution items.
