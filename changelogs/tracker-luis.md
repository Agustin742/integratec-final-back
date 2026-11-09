# Tracker — Luis

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
