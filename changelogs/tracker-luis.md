# Tracker — Luis

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
