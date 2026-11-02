# Tracker — Luis

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

## 2026-10-26 — Synchronize shared engineering and coordination rules

- **Status:** completed
- **Area / files:** `rules/`, `AGENTS.md`, `changelogs/tracker-luis.md`
- **Change:** Integrated 8 shared engineering rules from the frontend repository (GitHub Projects coordination, API contracts, data and time, error handling, configuration, deployment, observability, and documentation decisions); updated the rules index accordingly.
- **Reason:** Maintain consistent cross-repository development practices, contracts, and board coordination without introducing frontend-specific visual or UI rules.
- **Next step:** Review backend architecture and proceed with NestJS/database implementation.

## 2026-10-26 — Align master document and add functional specification

- **Status:** completed
- **Area / files:** `master-document.md`, `docs/functional-requirements.md`, `docs/user-stories.md`, `docs/requirements-decision.md`
- **Change:** Documented complete functional requirements (ERS), user stories with acceptance criteria, and permission decisions; aligned the master document with the office/room domain model, office-scoped roles without Superadmin, expiring single-use invite links, and read-only AI bot scope for MVP.
- **Reason:** Establish a traceable functional baseline across both repositories and eliminate inconsistencies between architectural documentation and agreed product scope.
- **Next step:** Sync documentation to frontend repository and review technical architecture.
