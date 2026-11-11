# Read the classroom desk map

`GET /classrooms/:id/desks` returns the persisted physical layout for enrolled students, classroom teachers, and the classroom school's Owner/Admin. The NestJS API owns this contract; the frontend consumes the committed [OpenAPI document](../apps/api/openapi.json).

## Response

Send the normal `Authorization: Bearer <access-token>` header. A successful response is `200`:

```json
{
  "items": [
    {
      "id": "00000000-0000-4000-8000-000000000101",
      "deskIndex": 1,
      "membershipId": "00000000-0000-4000-8000-000000000201",
      "userId": "00000000-0000-4000-8000-000000000001"
    },
    {
      "id": "00000000-0000-4000-8000-000000000102",
      "deskIndex": 2,
      "membershipId": null,
      "userId": null
    }
  ]
}
```

- `id` identifies the physical desk; `deskIndex` is its persisted 1-based layout position.
- `membershipId` identifies the assigned enrollment; `userId` identifies the student for client-side identity joins. Both are explicitly `null` for a free desk. No names, emails, avatar data or guardian information are returned; this is not the member directory.
- `items` includes every persisted desk, including released and automatically expanded desks, ordered by `deskIndex` ascending with `id` as tiebreaker. An empty layout returns `{ "items": [] }`.
- This endpoint returns **one complete layout**, not a paginated member list: missing a page would otherwise hide physical seats. There are no pagination, filtering or sorting parameters and no hidden row limit. Clients must render returned desks rather than assume 12 seats. Very large layouts have proportional response cost.

## Authorization and lifecycle

| Request | Result |
| --- | --- |
| Enrolled student, own classroom teacher, school Owner/Admin | `200` |
| Parent-only link to a visible classroom | `403 FORBIDDEN` |
| Parent-only link while adult mode is enabled | `404 NOT_FOUND` (shared service disables parental access) |
| Foreign teacher/student, nonmember, removed member, deleted/missing classroom, malformed UUID | `404 NOT_FOUND` |
| Missing or invalid authentication | `401 UNAUTHENTICATED` |

Errors use the shared [REST envelope](api-conventions.md#error-envelope). Authorization derives from the persisted classroom and memberships on every request; clicking an object or sending a classroom identifier in query parameters grants nothing.

The read does not allocate, reassign, release or repair desks. Enrollment (#22) owns lowest-free-index assignment and `max + 1` expansion; removal (#23) owns release. See [desk allocation rules](../rules/classrooms-and-roles.md#desk-allocation). No manual reassignment endpoint, realtime event, frontend interaction or `/members` change is included.

## Verification boundary

`apps/api/src/classrooms/desks/desks.http.spec.ts` exercises real Nest routing, the global session guard, shared access service, error envelope and response projection using synthetic sessions and predicate-aware mocked persistence. It checks allowed/denied scopes, free and expanded layouts, full-layout retrieval and unchanged controlled fixture state. It does **not** prove PostgreSQL constraints, allocation concurrency, live authentication or frontend integration. No database is required.

The [resource authorization test pattern](resource-authorization-testing.md) is reused by the route's tests.
