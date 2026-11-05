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

# Regenerate the committed OpenAPI document (apps/api/openapi.json)
pnpm openapi:export

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

## Docker and local database

A local development stack is provided with `docker-compose.yml`.

### Local PostgreSQL

Start the health-checked PostgreSQL 16 container:

```bash
# Start PostgreSQL in background (default port 5432)
docker compose up -d postgres

# Check container status and health
docker compose ps

# Stop PostgreSQL container
docker compose down
```

The database credentials and configuration match `apps/api/.env.example` (`user: postgres`, `password: postgres`, `database: aula_virtual`, `port: 5432`). These credentials are for local development only, so the host port is published on `127.0.0.1` only (configurable via `POSTGRES_PORT`, always defaulting to `5432`; there is no automatic fallback to another port). Database state is persisted across container restarts in the Docker volume `aula_postgres_data` (declared as `postgres_data` in the compose file). To reset the database, run `docker compose down -v`.

If another PostgreSQL instance already occupies port `5432`, set `POSTGRES_PORT=5433` in the repository-root Compose `.env` before starting the container. When running the API outside Docker with `pnpm --filter @aula/api start:dev`, also update `DATABASE_URL` in `apps/api/.env` to use the chosen host port, for example `postgresql://postgres:postgres@localhost:5433/aula_virtual?schema=public` with the default local credentials. Export that updated value into the API process environment as described in [Configuration](#configuration); `start:dev` does not load `.env` automatically. The containerized API continues to use `postgres:5432` on the Compose network, regardless of `POSTGRES_PORT`.

### Running services in containers

Dockerfiles for `api` and `realtime` use multi-stage builds (`node:22.23.4-alpine`, pinned to the same immutable multi-platform image digest in every stage, pnpm via Corepack, running as non-root user `node`). Both service definitions use the `app` profile so that running `docker compose up` only starts the database by default.

The application services require `INTERNAL_SERVICE_SECRET`, and the compose file deliberately provides no default for it. Create a git-ignored `.env` file in the repository root (Docker Compose reads it automatically) with a generated secret:

```bash
echo "INTERNAL_SERVICE_SECRET=<generated-secret>" > .env
```

If the secret is missing or shorter than 32 characters, the services exit at startup with the configuration diagnostic described in [Configuration](#configuration). `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `ALLOWED_ORIGINS` can be overridden in the same file; the password is embedded in `DATABASE_URL`, so avoid URL-reserved characters such as `@`, `:`, `/` or `#`.

To start the database and all application services:

```bash
# Start postgres, api, and realtime containers
docker compose --profile app up -d --build

# Wait for all three containers to report healthy, then check both endpoints
docker compose --profile app ps
curl --fail http://localhost:3000/health
curl --fail http://localhost:2567/health

# Stop all containers and networks
docker compose --profile app down
```

To build individual container images manually:

```bash
# Build API image
docker build -t aula-api -f apps/api/Dockerfile .

# Build Realtime server image
docker build -t aula-realtime -f apps/realtime/Dockerfile .
```

The API currently validates `DATABASE_URL` but does not open a database connection. API-to-PostgreSQL connectivity verification is **not applicable yet**; a successful `/health` response does not prove database access. See the [PR #56 verification record](./docs/pr-56-verification.md) for the earlier reviewer run, the successful pinned-image checks and the remaining review limitations.

## Configuration

Both services read their configuration once at startup through a typed, validated boundary ([`apps/api/src/config`](./apps/api/src/config/api-config.ts) and [`apps/realtime/src/config`](./apps/realtime/src/config/realtime-config.ts)). If any variable is missing or invalid, the process prints one diagnostic that lists every offending variable by name (never its value) and exits with code 1. Feature code must not read `process.env` directly; ESLint enforces this outside the config modules and process entrypoints. See [Configuration and environments](./rules/configuration-and-environments.md).

Copy `apps/<app>/.env.example` to `apps/<app>/.env` and replace the placeholders. Real `.env` files are git-ignored; `.env.example` is tracked and contains placeholders only. The API does not load `.env` files on its own: export the variables in your shell or start it with `node --env-file=.env`. The realtime server loads `.env.<NODE_ENV>` and `.env` from its working directory through `@colyseus/tools` before validating them. Every variable below is read at startup, so **any change requires a restart**.

Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The `INTERNAL_SERVICE_SECRET` placeholder is deliberately too short to validate, so a service cannot start with it. Use the same value in the API and the realtime server.

### API (`apps/api`)

| Variable                  | Required / default                                | Purpose                                                                  | Classification | Restart |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | -------------- | ------- |
| `NODE_ENV`                | Default `development`; `development`, `test`, `production` | Environment name                                                | Public         | Yes     |
| `PORT`                    | Default `3000`; integer 1-65535                   | HTTP listen port                                                         | Public         | Yes     |
| `DATABASE_URL`            | Required; `postgres://` or `postgresql://` URL    | PostgreSQL connection string (includes credentials)                      | Private        | Yes     |
| `JWT_ACCESS_TTL`          | Default `15m`; `<integer>` + `s`, `m`, `h` or `d` | Access token lifetime                                                    | Public         | Yes     |
| `REFRESH_TOKEN_TTL`       | Default `7d`; same format                         | Refresh token lifetime                                                   | Public         | Yes     |
| `INVITATION_TTL`          | Default `7d`; same format                         | Default invitation lifetime                                              | Public         | Yes     |
| `INTERNAL_SERVICE_SECRET` | Required; at least 32 characters                  | Shared secret for authenticated API and realtime service-to-service calls | Private        | Yes     |
| `ALLOWED_ORIGINS`         | Required; comma-separated `http(s)` origins       | CORS allowlist (scheme, host and optional port; no path or trailing `/`) | Public         | Yes     |

### Realtime (`apps/realtime`)

| Variable                  | Required / default                                | Purpose                                                                  | Classification | Restart |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | -------------- | ------- |
| `NODE_ENV`                | Default `development`; `development`, `test`, `production` | Environment name                                                | Public         | Yes     |
| `PORT`                    | Default `2567`; integer 1-65535                   | Colyseus and HTTP listen port                                            | Public         | Yes     |
| `API_INTERNAL_URL`        | Required; absolute `http(s)` URL                  | Base URL of the API for internal calls                                   | Private        | Yes     |
| `INTERNAL_SERVICE_SECRET` | Required; at least 32 characters                  | Shared secret for authenticated API and realtime service-to-service calls | Private        | Yes     |

Blank values are treated as unset. "Public" means the value is not a credential; none of these variables is ever sent to the browser.

## Documentation

The [master document](./master-document.md) records product scope and technology choices; the [functional requirements (ERS)](./docs/functional-requirements.md) define functional behavior and permissions. [Requirements decisions](./docs/requirements-decision.md) record confirmed clarifications, and [rules](./rules/README.md) govern engineering constraints. REST conventions (error envelope, validation, pagination, OpenAPI workflow) are in [API conventions](./docs/api-conventions.md).

Design diagrams (use cases, architecture, realtime, data model, classes, and sequences) live in [`docs/diagrams/`](./docs/diagrams/README.md). Mermaid is their editable source format, not authority over requirements or approved decisions. The views are aligned with the functional baseline; technical proposals are not implemented or approved contracts merely because they appear in a diagram. The [review guide](./docs/diagrams/review-guide.md) records local review slices, observed checks, and outstanding visual/remote verification.

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

The local whitespace command checks uncommitted changes; CI checks the proposed committed diff against the PR base or push's previous SHA. Workflow validation also requires actionlint 1.7.7: `actionlint .github/workflows/ci.yml`.

When a `package.json` is present, CI requires `pnpm-lock.yaml`, sets up Node.js 22 with `pnpm` store caching, provisions an active PostgreSQL 16 service container (`localhost:5432` with healthcheck for upcoming Prisma database and integration testing), installs dependencies with `pnpm install --frozen-lockfile`, and runs `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Each step is guarded against missing scripts and reports a GitHub notice and step summary when absent. Otherwise, CI explicitly reports that no **application** tests were configured or run in both a GitHub notice and the job summary. CI-tooling tests are separate; planned application checks and deployment are not evidence of a running backend.

## Shared contracts

NestJS generates an OpenAPI document (`@nestjs/swagger`) served with the Scalar API reference UI, and the frontend generates its TypeScript types from it. The generated `openapi.json` is committed at `apps/api/openapi.json` (regenerate with `pnpm openapi:export`; see [API conventions](./docs/api-conventions.md#openapi-document-and-api-reference)) and CI fails if it is stale versus the code. Realtime room state types are generated with `@colyseus/schema` codegen and message payload types are exported from `packages/contracts`; both are committed, and the frontend pulls everything with its `pnpm api:sync` script. These decisions (D4 and D8) were made and approved by Agustin on 2026-11-02; see [API contracts](./rules/api-contracts.md). The REST side (OpenAPI document, Scalar reference outside production, committed `openapi.json`, CI staleness check) is implemented; the Colyseus schema codegen and `packages/contracts` message types are planned for future issues.
