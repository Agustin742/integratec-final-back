# Tracker — Luis

## 2026-11-09 — Classroom invitations, join codes, and desk assignment (Issue #22)

- **Status:** completed
- **Area / files:** `apps/api/src/classrooms/`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #22 (HU-AUL-002: Join a classroom through email invitation or access code/link):
  - Created `ClassroomInvitationsService`, `InvitationsController`, and extended `ClassroomsController` and `ClassroomsModule` with seven endpoints:
    - `POST /classrooms/:id/invitations`: issues single-use email invitation with SHA-256 hashed secret, target email, expiration, and outbox event dispatch (`classroom.invitation-created`) for asynchronous email delivery via `EmailPort`. Preserves complete non-disclosure of existing users.
    - `GET /classrooms/:id/invitations`: paginated list of email invitations filtered by status.
    - `DELETE /classrooms/:id/invitations/:invitationId`: revokes active email invitation.
    - `POST /classrooms/:id/join-code`: generates/regenerates shareable uppercase alphanumeric join code (7 Crockford Base32 characters); automatically revokes previous active join code; stores only SHA-256 hash and exposes raw code once upon generation.
    - `DELETE /classrooms/:id/join-code`: revokes active join code.
    - `POST /invitations/accept`: accepts opaque token from email invitation, binds authenticated account to classroom membership, and assigns available desk.
    - `POST /classrooms/join`: redeems join code, enforces sliding-window in-memory rate limiting against brute-force guessing (`429 TOO_MANY_REQUESTS`), creates membership atomically, assigns lowest available desk, and auto-expands desks dynamically (`(maxDeskIndex ?? 0) + 1`) when all default 12 desks are occupied.
  - Enforced idempotency: re-joining by an already enrolled student returns existing membership and desk without consuming extra uses.
  - Implemented transactional concurrency safety and tested with `Promise.all` for max-uses race conditions, duplicate user joins, and desk allocation.
  - Added unit test suites and PostgreSQL integration test battery (`*.spec.ts` and `*.integration.spec.ts`).
  - Exported updated OpenAPI specification to `apps/api/openapi.json`.
- **Review refinements (Issue #22 review):**
  - **CRIT-01 (Desk concurrency):** Replaced bare `tx.desk.update` in `assignDesk` with atomic conditional claim `tx.desk.updateMany({ where: { id: availableDesk.id, membershipId: null }, data: { membershipId } })`. If `claimed.count === 0`, retries with next available desk or auto-expansion with retry on `(classroomId, deskIndex)` collision, preventing desk clobbering.
  - **CRIT-02 (Atomic `useCount` increment & P2004 handling):** Enforced conditional atomic increment on `tx.invitation.updateMany` bounded by `useCount: { lt: maxUses }` and transitions state to `USED` upon reaching limit. Caught Prisma constraint error `P2004` alongside `P2002` mapping to `409 Conflict`.
  - **CRIT-03 & WARN-06 (Teacher invitation authorization):** Restricted `role === TEACHER` on `createEmailInvitation` to school `OWNER` and `ADMIN`, throwing `403 Forbidden` if requested by a classroom teacher per `rules/classrooms-and-roles.md:75`. In `acceptEmailInvitation`, upserted `SchoolMember(TEACHER)` for school classrooms to guarantee active school authority.
  - **CRIT-04 & WARN-04 (Soft-deleted school & classroom check):** Included `school: { select: { deletedAt: true } }` on classroom relations in `joinWithCode` and `acceptEmailInvitation`, uniformly throwing `404 NotFound` with identical opaque error message (`Invalid or expired join code` / `Invalid or expired invitation`) to avoid information leakage.
  - **CRIT-05 (Reactivate inactive/soft-deleted memberships):** Implemented reactivation inside `$transaction` for inactive or soft-deleted memberships upon re-joining or accepting an invitation, assigning an unallocated desk if none exists and preventing duplicate insertion crashes (`P2002`).
  - **WARN-05 (Staff enrollment prevention):** Rejected attempts by independent teachers, school owners, and school administrators to join as students via join code, throwing `409 Conflict` without consuming code uses.
  - **WARN-07 (Integration test hygiene):** Removed silent skips (`try { await prisma.$connect(); } catch { return; }` and `if (!testClassroom) return;`) in `classroom-invitations.integration.spec.ts`, failing fast if database is unreachable and guaranteeing `skipped: 0`.
  - **POL-01 & POL-02 (Crockford Base32 normalization & Revocation guard):** In `normalizeJoinCode`, mapped Crockford Base32 aliases (`O` -> `0`, `I`/`L` -> `1`). In `revokeInvitation`, validated that only `PENDING` invitations can be revoked, returning `400 BadRequest` if already used or revoked.
  - **Contract refinement (Raw token return & Role restriction):** Created `CreatedClassroomInvitationResponseDto` returning the raw `token` secret once on `POST /classrooms/:id/invitations` per Issue #22 scope, while `GET` list omits it. Blocked `OWNER` and `ADMIN` roles in `CreateClassroomInvitationDto` and `createEmailInvitation`, restricting classroom invitations strictly to `STUDENT` or `TEACHER`.
- **Review round 2 (PR #78 review):**
  - **Teacher invitations removed (out of scope for #22):** `POST /classrooms/:id/invitations` now accepts only `STUDENT` (`400` for any other role), and `acceptEmailInvitation` no longer creates or reactivates a `SchoolMember`; it always enrolls the account as a classroom `Student` and treats a non-student invitation as invalid. This supersedes the CRIT-03 teacher-authorization and `STUDENT` or `TEACHER` role-restriction items above. Teacher invitations belong to HU-AUL-004. OpenAPI regenerated.
  - **Invitation token no longer persisted in plaintext:** the `classroom.invitation-created` outbox payload now carries `encryptedToken` (`{ iv, authTag, ciphertext }`, AES-256-GCM, bound to the invitation id) instead of the raw token. The key is the new required `INVITATION_TOKEN_KEY` secret (32 bytes as hex or base64, validated in `api-config.ts`, documented in `.env.example`, `docker-compose.yml`, and the README). `ClassroomInvitationCreatedHandler` decrypts it right before calling `EmailPort`. Helper: `apps/api/src/platform/crypto/secret-box.ts`.
  - **Idempotent retry with an exhausted code or used invitation:** `joinWithCode` now recognizes an actively enrolled student before rejecting a `USED` or exhausted (`useCount >= maxUses`) join code, and `acceptEmailInvitation` does the same for a `USED` invitation. The existing membership and desk are returned without consuming another use; other users, removed members, and deleted classrooms or schools are still rejected. Covered by `maxUses: 1` integration tests.
  - **Atomic revocation:** `revokeInvitation` and `revokeJoinCode` now use a conditional `updateMany` filtered by `state: PENDING` and check the affected-row count, so a concurrently accepted (`USED`) invitation or exhausted code is never overwritten with `REVOKED`. When nothing matches, the invitation is re-read and the matching error (`404`, or `400` for already used, revoked, or expired) is returned. Covered by a stale-read unit test and acceptance-versus-revocation integration tests (both orders plus a `Promise.all` race asserting the invariant).
  - **Desk auto-expansion recorded as a decision:** documented in `rules/classrooms-and-roles.md` (Desk allocation) with its basis in RF-ESP-002 and HU-ESP-002 criterion 3: one assignable desk per enrolled student, no classroom capacity, clients render desks from backend data. The existing integration test covers the 13th and 14th students receiving desks 13 and 14 (indexes are 1-based). The `deskIndex` field description in OpenAPI now states the policy.
- **Reason:** Enable teachers and school administrators to invite students via email or shareable join codes, allocate 3D desks automatically with dynamic auto-expansion, and protect joining endpoints against brute force attacks.
- **Next step:** Open PR targeting `develop` and move card #22 to `In review` on GitHub Project 3.

## 2026-11-08 — Create and configure virtual classrooms (Issue #21)

- **Status:** in-progress
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261107231500_add_classroom_subject/`, `apps/api/src/classrooms/`, `apps/api/src/app.module.ts`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #21 (HU-AUL-001): added optional `subject` column (`VARCHAR(200)`) to `Classroom` via Prisma migration `20261107231500_add_classroom_subject`. Created `ClassroomsModule`, `ClassroomsController` (`POST /classrooms`, `GET /classrooms`, `GET /classrooms/:id`, `PATCH /classrooms/:id`), `MeClassroomsController` (`GET /me/classrooms`), and `ClassroomsService` integrated with `AccessVerificationService`. Implemented atomic classroom provisioning inside `prisma.$transaction`: creates `Classroom` with default control states (`adultMode: false`, `chatMuted: false`, `collaborationLocked: false`, `gamesDisabled: false`), default `ClassroomPet` (proposed defaults: `DEFAULT_PET_NAME = 'Michi'`, `DEFAULT_PET_SPECIES = 'cat'`, `level: 1`, `experience: 0`), `DEFAULT_INITIAL_DESK_COUNT = 12` unassigned `Desk` rows (`deskIndex` `1..12`), and `ClassroomMembership(TEACHER)` for school teachers (while deriving School Owner/Admin authority from `SchoolMember` without creating per-classroom memberships per `rules/data.md`). Enforced 401/403/404 status uniformity, `UUID_PATTERN` validation, and `adultMode` toggle preserving `ParentLink` rows in DB while immediately revoking parent access. Added unit, HTTP validation, and PostgreSQL integration tests including transactional rollback and `Promise.all` concurrency tests. Exported updated OpenAPI contract.
- **Reason:** Enable independent teachers and school staff to create, list, inspect, and configure persistent virtual classrooms and their initial 3D spatial/pet state.
- **Next step:** Open PR targeting `develop` and move card #21 to `In review` on GitHub Project 3.

## 2026-11-07 — Resource isolation and server-side access verification (Issue #19)

- **Status:** completed
- **Area / files:** `apps/api/src/auth/`, `apps/api/src/access/`, `apps/api/src/app.module.ts`, `apps/api/src/health.controller.ts`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #19 (HU-AUL-005): introduced global authentication guard (`SessionAuthGuard`) enforcing session validity by default, `@Public()` metadata decorator, `@CurrentUser()` / `@CurrentSession()` parameter decorator extracting validated session identity, and protected `/auth/logout` via the guard. Created `AccessModule` and `AccessVerificationService` enforcing server-side persisted state per request: `verifySchoolAccess` (active school membership, role checks, 404 on unknown school/stranger), `verifyClassroomAccess` (exact hierarchy: School Owner/Admin authority over all classrooms in their school without per-classroom membership, teacher on own classroom with 404 for another teacher's classroom in the same school, enrolled active student, active linked parent unless adult mode is active, 403 on insufficient role, 404 for stranger/cross-school isolation without existence leakage), and `verifyStudentResourceAccess` (own resource, staff, linked parent, 403 for classmate, 404 for stranger/unlinked parent). Added capabilities computation helper deriving exact permission matrix from `rules/classrooms-and-roles.md`. Added unit test suites for `SessionAuthGuard`, `CurrentUser`/`CurrentSession`, and `AccessVerificationService` including permission matrix, isolation, adult mode, and concurrency tests.
- **Review refinements (PR #71):** Protected all access methods against non-UUID string injection with `UUID_PATTERN` early-exit to guarantee 404s instead of PostgreSQL syntax 500s. Enforced that school teachers must hold an active `SchoolMember` status to retain classroom authority. Added HTTP integration test with Supertest (`session-auth.guard.http.spec.ts`) asserting global default-deny and `@Public()` route behavior. Added real PostgreSQL matrix tests (`access-verification.integration.spec.ts`). Deliberate design decision: `ADMIN` defaults to fail-closed without `manage_school` capability pending formal Owner-to-Admin delegation scope definition.
- **Reason:** Provide foundational security boundary and contextual authorization required by all virtual classroom endpoints (#21, #22, #23, etc.).
- **Next step:** Completed and merged into `develop` via PR #71.

## 2026-11-05 — Account registration and organizational path selection (Issue #17)

- **Status:** completed
- **Area / files:** `packages/contracts/src/index.ts`, `apps/api/package.json`, `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261105230000_add_user_registration_path/`, `apps/api/src/auth/`, `apps/api/openapi.json`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #17 (HU-AUT-001): added `POST /auth/register` endpoint with atomic account creation supporting independent teacher and school paths. Exported `RegistrationPath` enum and constant array in `@aula/contracts`. Added new Prisma migration creating `registration_path` enum and column on `User` to persist the chosen organizational path. Implemented salted password hashing via bcrypt (10 rounds) and enforced password boundary limit of 72 UTF-8 bytes to prevent silent truncation. Handled school path atomically by creating `School`, automatic collision-resilient slug generation, and assigning `SchoolMember` with `OWNER` role. Created default empty `AvatarConfiguration`. Handled race conditions and uniqueness constraints returning 409 Conflict. Added comprehensive Vitest tests verifying DTO validation, UTF-8 byte boundary, transactional atomicity, persistence of registration path, and concurrent duplicate registrations (`Promise.all`). Updated OpenAPI spec.
- **Reason:** Implement account registration and path selection fulfilling HU-AUT-001, address PR #66 code review feedback, and enforce strict Definition of Done (DoD).
- **Next step:** Completed and merged into develop via PR #66.

## 2026-11-04 — Baseline Prisma schema and relational migrations (Issue #14)

- **Status:** completed
- **Area / files:** `apps/api/prisma/`, `apps/api/src/prisma/`, `apps/api/Dockerfile`, `.github/workflows/ci.yml`, `package.json`, `apps/api/package.json`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #14: set up Prisma ORM in `apps/api` with initial migration for baseline relational schema covering `User`, `Session`, `AvatarConfiguration`, `School`, `SchoolMember`, `Classroom`, `ClassroomMembership`, `Desk`, `ClassroomPet`, `ParentLink`, `Invitation`, and `JoinCodeUsage`. Enforced required database-level constraints: normalized unique email, single active owner per school partial index, exclusive ownership CHECK on `Classroom` (school OR independent teacher), invitation integrity CHECK (email required for email kind, absent for join codes with role student, use count <= max uses), and default Buenos Aires time zone. Created NestJS global `PrismaModule` and `PrismaService`. Added synthetic seed script (`prisma/seed.ts`). Authored comprehensive integration tests exercising all database constraints against PostgreSQL. Updated CI workflow with automated migration step and updated Dockerfile for container builds.
- **Reason:** Provide durable relational data model foundation, Prisma Client integration, and strict database constraint guarantees for subsequent domain modules.
- **Next step:** Merge PR for Issue #14 into develop, then proceed with authentication endpoints and session management.

## 2026-11-03 — Docker Compose local PostgreSQL and service Dockerfiles (Issue #13)

- **Status:** completed
- **Area / files:** `.dockerignore`, `docker-compose.yml`, `apps/api/Dockerfile`, `apps/realtime/Dockerfile`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Implemented Issue #13 Docker setup: added root `.dockerignore` excluding dependencies, build artifacts, environments, and docs; created `docker-compose.yml` with health-checked PostgreSQL 16 on `127.0.0.1:5432` with the `aula_postgres_data` volume matching `apps/api/.env.example`, plus optional `api` and `realtime` containers under the `app` profile (no default for `INTERNAL_SERVICE_SECRET`, which is read from a git-ignored root `.env`); authored multi-stage `apps/api/Dockerfile` and `apps/realtime/Dockerfile` on `node:22-alpine` using Corepack pnpm, non-root `USER node`, container health checks, and monorepo contract building; and updated `README.md` with Docker Compose workflows.
- **Reason:** Enable local containerized PostgreSQL database service and production-ready container builds for API and realtime microservices.
- **Next step:** Merge PR for Issue #13 into develop, then proceed with Prisma baseline schema and migrations (Issue #14).

## 2026-11-03 — Extend CI with pnpm caching and PostgreSQL service container (Issue #11)

- **Status:** completed
- **Area / files:** `.github/workflows/ci.yml`, `README.md`, `changelogs/tracker-luis.md`, `.gitattributes`, `prettier.config.mjs`
- **Change:** Extended `.github/workflows/ci.yml` for Issue #11: added a health-checked `postgres:16-alpine` service container with test credentials and injected `DATABASE_URL` (ready for Prisma integration tests in #14); enabled Corepack and configured `pnpm` store caching via `actions/setup-node@v4`; added individual defensive step guards with `$GITHUB_STEP_SUMMARY` for formatting, linting, typecheck, testing, and building; configured `.gitattributes` (`* text=auto eol=lf`) keeping Prettier on default LF; and updated `README.md` to document the CI setup.
- **Reason:** Implement issue #11 to ensure fast, deterministic CI runs with package caching and real database integration test readiness.
- **Next step:** Merge PR #54 into develop, then implement typed environment configuration (Issue #12) and Docker Compose setup (Issue #13).

## 2026-11-02 — Address review feedback on monorepo bootstrap (Issue #10)

- **Status:** completed
- **Area / files:** `package.json`, `pnpm-lock.yaml`, `.gitignore`, `README.md`, `.github/workflows/ci.yml`, `eslint.config.mjs`, `apps/api/`, `apps/realtime/`, `packages/contracts/`
- **Change:** Addressed all review comments on PR #10: untracked `.tsbuildinfo` files and added `*.tsbuildinfo` to `.gitignore`; resolved clean-clone typecheck by pointing `@aula/contracts` types at `./src/index.ts`; expanded `.github/workflows/ci.yml` to run `format:check`, `lint`, `typecheck`, `test`, and `build`; restored accurate notes and actionlint docs in `README.md`; exercised real Express app routes with `supertest` in realtime tests; upgraded Colyseus to `0.18.x`; separated NestJS bootstrap logic from `main.ts` with explicit `.catch()` error handling; and extended ESLint configuration with `js.configs.recommended` and `tseslint.configs.recommended`.
- **Reason:** Satisfy blocking and important PR review criteria before merging Issue #10 into develop.
- **Next step:** Merge PR #10 into develop, then proceed with configuration (#12) and Docker (#13).

## 2026-11-02 — Bootstrap pnpm monorepo (Issue #10)

- **Status:** completed
- **Area / files:** `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/api/`, `apps/realtime/`, `packages/contracts/`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Bootstrapped the backend monorepo with `pnpm` workspaces hosting `apps/api` (minimal NestJS application with `/health` endpoint), `apps/realtime` (minimal Colyseus server with `/health` endpoint and zero database dependencies), and `packages/contracts` (internal shared TypeScript interfaces). Configured root strict TypeScript base configuration (`tsconfig.base.json`), ESLint, Prettier, and Vitest smoke test suites across all packages. Pinned Node.js 22 and pnpm 10.
- **Reason:** Implement issue #10 and establish the foundational monorepo workspace for subsequent backend modules.
- **Next step:** Configure environment variables and Docker Compose for local PostgreSQL (Issues #12 and #13) and implement Prisma schema migrations (Issue #14).

## 2026-11-02 — Align ERS, User Stories, and Requirements Decisions with school niche (v0.3)

- **Status:** completed
- **Area / files:** `docs/requirements-decision.md`, `docs/functional-requirements.md`, `docs/user-stories.md`, `master-document.md`, `changelogs/tracker-luis.md`
- **Change:** Updated the functional requirements specification (ERS v0.2), user stories catalog (v0.2), and requirements decisions log to align 100% with the v0.3 **3D Virtual Classroom for Schools** model defined in `master-document.md` and `rules/`. Replaced the legacy office, room, and Kanban model with schools, classrooms, school-scoped roles (`Teacher`, `Student`, `Parent / Guardian`, `School Owner / Admin`), academic activities (`TP` and `Exam`), submissions, grading with transactional weighted points (`PointTransaction`), daily streak, badges, shop, classroom pet, live classroom tools, 2D Classic Mode, and the RAG Study Guide Bot over teacher-approved material.
- **Reason:** Eliminate the documentation drift between `docs/` functional specifications and the v0.3 school niche contract established in `master-document.md` and `rules/`.
- **Next step:** Align derived diagrams if needed and proceed with backend MVP Core implementation.

## 2026-11-02 — Fix documentation links and diagram references

- **Status:** completed
- **Area / files:** `docs/requirements-decision.md`, `docs/diagrams/`
- **Change:** Updated internal links and rule anchors across requirements decisions and architecture diagrams to align with realigned school domain rules (`classrooms-and-roles.md`, `activities-and-grading.md`, `communication-and-notifications.md`).
- **Reason:** Resolve broken link and anchor errors reported by `scripts/ci/check_docs.py`.
- **Next step:** Review backend architecture and proceed with implementation.
