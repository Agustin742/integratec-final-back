# Backend

This repository contains the backend services and shared contracts for the 3D Virtual Classroom platform, organized as a `pnpm` workspaces monorepo.

## Monorepo layout

```text
backend/
├── apps/
│   ├── api/          # NestJS REST API and persistence layer
│   └── realtime/     # Colyseus realtime multiplayer server (presence, movement, classroom controls)
├── packages/
│   └── contracts/    # Shared TypeScript contracts and domain interfaces
├── docs/             # Functional specifications, decisions, and architecture diagrams
├── rules/            # Canonical engineering and workflow rules
└── scripts/          # CI tooling and regression checks
```

## Local setup and development

Requirements: **Node.js 22** and **pnpm >= 10**.

```bash
# Install workspace dependencies
pnpm install

# Run Vitest test suites across all packages
pnpm test

# Typecheck all workspace packages
pnpm typecheck

# Check code formatting and linting
pnpm format:check
pnpm lint

# Build all packages
pnpm build
```

To run individual services locally:

```bash
# Start NestJS API in dev mode (default port 3000)
pnpm --filter @aula/api start:dev

# Start Colyseus server in dev mode (default port 2567)
pnpm --filter @aula/realtime start:dev
```

## Documentation

The [master document](./master-document.md) records product scope and technology choices; the [functional requirements (ERS)](./docs/functional-requirements.md) define functional behavior and permissions. [Requirements decisions](./docs/requirements-decision.md) record confirmed clarifications, and [rules](./rules/README.md) govern engineering constraints.

Design diagrams (use cases, architecture, realtime, data model, classes, and sequences) live in [`docs/diagrams/`](./docs/diagrams/README.md). Mermaid is their editable source format, not authority over requirements or approved decisions. The [review guide](./docs/diagrams/review-guide.md) records local review slices, observed checks, and outstanding visual/remote verification.

## Repository flow

Changes are promoted through pull requests: `develop` → `test` → `main`. CI accepts only `develop` as the source for `test` and `test` as the source for `main`.

## CI

The [`checks` GitHub Actions job](./.github/workflows/ci.yml) runs for pull requests into `develop`, `test`, or `main` and pushes to `develop`. It checks tracked Markdown inline internal links and ATX heading anchors, runs CI-tooling regression tests, checks proposed diff whitespace against the event base, and validates the workflow with actionlint 1.7.7. External links and code examples are excluded from link checking.

Local documentation and tooling checks (Python 3 and Git required):

```bash
PYTHONDONTWRITEBYTECODE=1 python scripts/ci/check_docs.py
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s scripts/ci -p 'test_*.py' -v
git diff --check
```

CI installs dependencies with `pnpm install --frozen-lockfile` on Node.js 22 and runs `pnpm test`.

## Shared contracts

NestJS generates an OpenAPI document (`@nestjs/swagger`) served with the Scalar API reference UI, and the frontend generates its TypeScript types from it. The generated `openapi.json` is committed in this repository (planned path `apps/api/openapi.json`) and CI validates freshness. Realtime room state types are generated with `@colyseus/schema` codegen and message payload types are exported from `packages/contracts`; both are committed, and the frontend pulls everything with its `pnpm api:sync` script. See [API contracts](./rules/api-contracts.md).
