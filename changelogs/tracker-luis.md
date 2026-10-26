# Tracker — Luis

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
