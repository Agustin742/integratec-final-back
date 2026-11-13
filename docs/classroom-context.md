# Classroom panel availability

`GET /classrooms/:id` adds required `availablePanels: ClassroomPanelKey[]` alongside unchanged `myRole`, `capabilities` and classroom state. The backend owns this contract for the frontend #26 panel registry; the generated [OpenAPI document](../apps/api/openapi.json) is the integration source.

## Role projection

The shared access module projects panels from the already-authorized role derived from persisted school membership, classroom membership or parent links. It adds no query or stored state and never trusts a client-supplied role.

| Resolved role | Exact panel order |
| --- | --- |
| OWNER / ADMIN / TEACHER | `activities`, `material`, `grades`, `chat`, `notices`, `bot`, `members`, `settings` |
| STUDENT | `activities`, `material`, `grades`, `chat`, `notices`, `shop`, `bot`, `members` |
| PARENT | `grades` |

Arrays are unique, deterministic and freshly projected. Their order is stable for the contract; the frontend registry decides visual order. `pet` is the tenth known key, reserved and **never emitted** in delivery A, even when existing classroom pet summary data is present.

Only `GET /classrooms/:id` acquires this field. Classroom creation, updates, `GET /classrooms` and `GET /me/classrooms` keep their prior response shapes.

## Availability is not authorization

An absent panel is not offered. A present panel may be empty and does **not** authorize all its operations. For example, staff see activities for management without gaining student submission authority; a student sees members without gaining the private staff roster. The members panel refers to the [D12 directory](../rules/classrooms-and-roles.md#member-directory), not guardian or private roster data.

Parents receive no shell panel outside grades. Every child-resource endpoint must still enforce the current linked-child check; this list neither grants access to other children nor adds parent access to material, chat, notices, bot or directory. Existing classroom state fields are unchanged. See the [permission rules](../rules/classrooms-and-roles.md) and [master role matrix](../master-document.md#22-roles-permisos-e-invitaciones).

## Access and failures

The existing global session guard and shared authorization remain authoritative:

- `200`: school Owner/Admin in scope, the classroom's teacher, an active enrolled student, or an active linked parent outside adult mode.
- `401`: missing, malformed, expired or revoked authentication.
- `404`: malformed/missing classroom, deleted classroom/school, stranger, foreign-school actor, another classroom's teacher, removed member or unlinked parent. Parent access is also absent in adult mode.
- Insufficient operation role remains `403` on visible resources (for example, a parent's classroom update). Panel availability does not change endpoint status semantics.

Delivery B (context invalidation/SSE) is **unimplemented**. This REST projection adds no subscriptions, invalidation, transport, D14 or frontend changes. Clients can refetch the detail endpoint; no push freshness guarantee is introduced.

## Verification boundary

Exact-array helper tests cover all five roles, fresh arrays, mutation isolation and reserved pet exclusion. HTTP tests use the actual controller, classroom service, access service and established session guard with predicate-aware in-memory Prisma fixtures; they cover role projection, ID/role tampering, denial statuses and unchanged role/capability semantics without modifying stored data. These fixtures do not prove PostgreSQL behavior or frontend rendering.
