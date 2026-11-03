# Tracker — Luis

## 2026-11-03 — Extend CI with pnpm caching and PostgreSQL service container (Issue #11)

- **Status:** completed
- **Area / files:** `.github/workflows/ci.yml`, `README.md`, `changelogs/tracker-luis.md`
- **Change:** Extended `.github/workflows/ci.yml` for Issue #11: added a health-checked `postgres:16-alpine` service container with test credentials and injected `DATABASE_URL` for future Prisma integration tests; enabled Corepack and configured `pnpm` store caching via `actions/setup-node@v4`; added defensive step guards with `$GITHUB_STEP_SUMMARY` for formatting, linting, typecheck, testing, and building; and updated `README.md` to document the CI setup.
- **Reason:** Implement issue #11 to ensure fast, deterministic CI runs with package caching and real database integration test readiness.
- **Next step:** Merge PR #11 into develop, then implement typed environment configuration (Issue #12) and Docker Compose setup (Issue #13).

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
