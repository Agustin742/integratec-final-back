# Staff classroom roster (#23)

`GET /classrooms/:id/roster` requires a valid Bearer session and current teacher
access through `AccessVerificationService`: school Owner/Admin, the classroom's
school teacher, or its independent teacher. Students and linked parents receive
403; foreign teachers, strangers, removed members and out-of-scope classrooms
receive 404. Authentication failures return 401. Invalid queries return 400 using
the standard error envelope.

## Request and response

- `page`: 1–10000, default 1; `pageSize`: 1–100, default 20.
- Optional `state`: `ACTIVE` or `INACTIVE`. Omission includes both states and
  logically deleted membership rows.
- Optional `q`: case-insensitive display-name prefix, at most 100 characters.
  Empty text matches any name; `%`, `_` and backslash are literal characters.
- Fixed ordering: display name ascending, then membership ID ascending. Ordering
  follows database collation; `sort` and unknown query parameters are rejected.
- Standard envelope: `{ items, page, pageSize, total }`. `total` counts the same
  classroom/student/state/prefix predicate across all pages.
- Each student: `{ membershipId, userId, displayName, state, deletedAt, guardians }`.
  `deletedAt` is an ISO 8601 UTC instant or null.
- Each guardian: `{ id, displayName, state }`; `state` describes the ParentLink,
  not the guardian account. Empty links produce `[]`.

Only student memberships are listed. Guardian links are restricted to the listed
child through its relation and to this classroom through an explicit predicate.
Inactive links remain visible as staff history, including in adult-mode classrooms;
this grants no parent access. No emails, credentials, avatar data or other profile
fields are selected or returned. This route neither implements nor modifies the
D12 `/members` mention directory and does not mutate membership or link state.

## Integration and verification boundary

`ClassroomRosterModule` is registered in `ClassroomsModule`. It imports Prisma
and shared access verification; global authentication remains an application
responsibility. The public route is included in the generated
`apps/api/openapi.json`. No schema migration is required.

The mock HTTP specification passed **28/28** with a real session guard, validation,
error envelope and shared access verification, overriding session verification and
Prisma persistence. The PostgreSQL integration specification then passed **4/4**
(parent job 11), proving relation isolation across children/classrooms, literal
prefix escaping, case-insensitive matching, tie-break pagination, historical
state and persisted authorization denial through HTTP.

`roster.integration.spec.ts` uses real Prisma and UUID-owned transactional
fixtures/cleanup. It requires an explicitly supplied local `DATABASE_URL`, never
loads environment files, and overrides only session verification. Run
`pnpm --filter @aula/api exec vitest run src/classrooms/roster/roster.integration.spec.ts`
against an isolated migrated test database. Separate count/page reads are not a
concurrent-write snapshot. Real sessions remain outside this test boundary.
Removal PostgreSQL tests separately passed **3/3** (access, rollback and concurrent
event checks). Full-workspace and independent verification remain separate:
see [Alejo's tracker](../changelogs/tracker-alejo.md).
