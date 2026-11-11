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

## Classroom member management

- [Private student roster](docs/classroom-roster.md): `GET /classrooms/:id/roster`, paginated student state and guardian links for classroom staff only; separate from the D12 mention directory.

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

### Database and Prisma workflows

With local PostgreSQL running (`docker compose up -d postgres`), run database migrations and seeding:

```bash
# Apply pending database migrations
pnpm prisma:migrate:deploy

# In development: create and apply a migration from schema changes
pnpm prisma:migrate:dev

# Seed database with realistic synthetic school data
pnpm prisma:seed

# Regenerate Prisma Client
pnpm prisma:generate
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

### Local object storage (MinIO)

Start the S3-compatible object store and create the development bucket (the one-shot `minio-init` container exits when done):

```bash
docker compose up -d minio minio-init
```

The API talks to it with `S3_ENDPOINT=http://localhost:9000`, `S3_FORCE_PATH_STYLE=true`, `S3_BUCKET=aula-virtual-dev` and the local-only credentials `minioadmin` / `minioadmin` (override with `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` in the Compose `.env`, and keep `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` equal to them). The API and console ports are published on `127.0.0.1` only (`MINIO_PORT`, `MINIO_CONSOLE_PORT`). Data persists in the volume `aula_minio_data`. Upstream MinIO images are no longer available (`minio/minio` on Docker Hub denies access and `quay.io/minio/minio` is gone) and the Bitnami images are unmaintained, so Compose uses `cgr.dev/chainguard/minio` and `cgr.dev/chainguard/minio-client`. Chainguard's free tier only publishes `latest`, so both are pinned by index digest (`image:latest@sha256:...`) in `docker-compose.yml`. To bump them, resolve the new digests and replace them in that file:

```bash
docker buildx imagetools inspect cgr.dev/chainguard/minio:latest        # use the top-level "Digest"
docker buildx imagetools inspect cgr.dev/chainguard/minio-client:latest
```

The server health check uses the bundled `mc ready local`, and `minio-init` runs a single idempotent `mc mb --ignore-existing` (the client image has no shell; URL-encode special characters if you set a custom `MINIO_ROOT_PASSWORD`). It is a development stand-in only and production uses AWS S3 with the instance role. The `StoragePort` integration spec runs against this container, locally and in CI.

### Running services in containers

Dockerfiles for `api` and `realtime` use multi-stage builds (`node:22.23.4-alpine`, pinned to the same immutable multi-platform image digest in every stage, pnpm via Corepack, running as non-root user `node`). Both service definitions use the `app` profile so that running `docker compose up` only starts the database by default.

The application services require `INTERNAL_SERVICE_SECRET` (and the API also `JWT_SECRET`), and the compose file deliberately provides no default for them. Create a git-ignored `.env` file in the repository root (Docker Compose reads it automatically) with generated secrets:

```bash
echo "INTERNAL_SERVICE_SECRET=<generated-secret>" > .env
echo "JWT_SECRET=<another-generated-secret>" >> .env
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

Service-to-service calls to the API send it in the `x-internal-service-secret` header. The only internal route today is `POST /internal/realtime/join-verification` (body `{ accessToken, classroomId }`), which the realtime server calls from `onAuth`; it is excluded from the public OpenAPI document and must not be routed by the reverse proxy (Caddy must never expose `/internal/*`; this is infrastructure work). If the internal call fails, times out, or returns a malformed response, the realtime server rejects the join (fail closed).

The client sets the access token with the Colyseus SDK (`client.auth.token`); it arrives as `Authorization: Bearer <access token>` on the matchmake request and as the `token` argument of `onAuth`. Join options carry only `classroomId`; the token is never read from options or URLs (see [D2](./docs/technical-justification.md#d2-nestjs-and-colyseus-integration)).

Realtime room state types are generated into `packages/contracts/src/realtime/generated` with `pnpm realtime:codegen`; `pnpm realtime:codegen:check` regenerates them and fails if the result differs from what is committed, including new untracked files (CI runs the same check). `@aula/contracts` is loaded as TypeScript source, so `packages/contracts/src/index.ts` must not use extensionless relative imports.

### API (`apps/api`)

| Variable                  | Required / default                                | Purpose                                                                  | Classification | Restart |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | -------------- | ------- |
| `NODE_ENV`                | Default `development`; `development`, `test`, `production` | Environment name                                                | Public         | Yes     |
| `PORT`                    | Default `3000`; integer 1-65535                   | HTTP listen port                                                         | Public         | Yes     |
| `DATABASE_URL`            | Required; `postgres://` or `postgresql://` URL    | PostgreSQL connection string (includes credentials)                      | Private        | Yes     |
| `JWT_ACCESS_TTL`          | Default `15m`; `<integer>` + `s`, `m`, `h` or `d` | Access token lifetime                                                    | Public         | Yes     |
| `REFRESH_TOKEN_TTL`       | Default `7d`; same format                         | Refresh token lifetime                                                   | Public         | Yes     |
| `REFRESH_REUSE_GRACE`     | Default `30s`, max `5m`; `0s` disables            | Window in which a rotated refresh token is retried without revoking      | Public         | Yes     |
| `PASSWORD_RESET_TTL`      | Default `1h`, max `24h`; same format              | Lifetime of an emailed password reset link (single-use)                  | Public         | Yes     |
| `PASSWORD_RESET_URL_BASE` | Required with HTTPS in production; default `http://localhost:5173/reset-password` outside production; absolute `http(s)` URL without query or fragment | Frontend page that finishes a reset; the emailed link is `<base>?token=<token>` | Public | Yes |
| `INVITATION_TTL`          | Default `7d`; same format                         | Default invitation lifetime                                              | Public         | Yes     |
| `OUTBOX_POLL_INTERVAL`    | Default `5s`; same format                         | How often the outbox dispatcher looks for pending events (not polled when `NODE_ENV=test`) | Public | Yes |
| `OUTBOX_MAX_ATTEMPTS`     | Default `5`; integer 1-20                         | Delivery attempts per outbox event before it is marked failed            | Public         | Yes     |
| `AUTH_DATA_RETENTION`     | Default `30d`; same format; not shorter than `REFRESH_TOKEN_TTL` | How long past expiry (or rotation/use) sessions, rotated refresh tokens and reset tokens are kept before cleanup | Public | Yes |
| `AUTH_CLEANUP_INTERVAL`   | Default `24h`, max `7d`; same format              | Pause between auth data cleanup runs (not scheduled when `NODE_ENV=test`) | Public         | Yes     |
| `AUTH_CLEANUP_BATCH_SIZE` | Default `1000`; integer 1-10000                   | Maximum rows removed by one cleanup `DELETE` statement                   | Public         | Yes     |
| `INTERNAL_SERVICE_SECRET` | Required; at least 32 characters                  | Shared secret for authenticated API and realtime service-to-service calls | Private        | Yes     |
| `JWT_SECRET`              | Required; at least 32 characters                  | HS256 signing key of access tokens (API only; never shared with the realtime server) | Private | Yes     |
| `ALLOWED_ORIGINS`         | Required; comma-separated `http(s)` origins       | CORS allowlist (scheme, host and optional port; no path or trailing `/`) | Public         | Yes     |
| `S3_BUCKET`               | Required; 3-63 lowercase letters, digits, dots or hyphens | Object storage bucket (local default in Compose: `aula-virtual-dev`) | Public         | Yes     |
| `S3_REGION`               | Default `sa-east-1`; AWS region name              | Region used to sign storage requests                                     | Public         | Yes     |
| `S3_ENDPOINT`             | Optional; `http(s)` origin without path           | Set only for an S3-compatible service such as MinIO (`http://localhost:9000`); unset means AWS S3 | Public | Yes |
| `S3_FORCE_PATH_STYLE`     | Default `false`; `true` or `false`                | Path-style bucket addressing; `true` for MinIO                           | Public         | Yes     |
| `S3_ACCESS_KEY_ID`        | Optional; set together with `S3_SECRET_ACCESS_KEY` | Static storage credential for local MinIO; leave both unset in AWS so the EC2 instance role is used | Private | Yes |
| `S3_SECRET_ACCESS_KEY`    | Optional; set together with `S3_ACCESS_KEY_ID`    | Static storage credential for local MinIO; never commit a real value     | Private        | Yes     |
| `STORAGE_SIGNED_URL_TTL`  | Default `5m`; same format, 1s to 1h               | Default lifetime of signed download URLs                                 | Public         | Yes     |

### Realtime (`apps/realtime`)

| Variable                  | Required / default                                | Purpose                                                                  | Classification | Restart |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | -------------- | ------- |
| `NODE_ENV`                | Default `development`; `development`, `test`, `production` | Environment name                                                | Public         | Yes     |
| `PORT`                    | Default `2567`; integer 1-65535                   | Colyseus and HTTP listen port                                            | Public         | Yes     |
| `API_INTERNAL_URL`        | Required; absolute `http(s)` URL                  | Base URL of the API for internal calls                                   | Private        | Yes     |
| `INTERNAL_SERVICE_SECRET` | Required; at least 32 characters                  | Shared secret for authenticated API and realtime service-to-service calls | Private        | Yes     |

Blank values are treated as unset. "Public" means the value is not a credential; none of these variables is ever sent to the browser.

## Own profile and base avatar

Authenticated users can read `GET /users/me`, change their display name with `PATCH /users/me/profile`, and replace their complete base appearance with `PATCH /users/me/avatar`. Body, hair and ordinary base tops are free; accessories/shop equip and realtime broadcasts are out of scope. See the [profile/avatar integration guide](./docs/profile-avatar.md) for supported IDs, defaults, examples and error semantics. The contract is included in the committed [OpenAPI document](./apps/api/openapi.json).

## Platform ports

Shared infrastructure that stories consume through a port (an interface plus an injection token), never through a provider. Code lives in `apps/api/src/platform`. None of the modules is imported in `AppModule`: the first feature module that needs one imports it.

### Email

Port in [`email`](./apps/api/src/platform/email/email.port.ts). Only an in-memory stub exists: it records messages and logs without the body or recipient, and makes no network call. The provider, digest, opt-out and bounce policy are open (gap 7).

```ts
@Module({ imports: [EmailModule] /* ... */ })
export class PasswordResetModule {}

constructor(@Inject(EMAIL_PORT) private readonly email: EmailPort) {}
await this.email.send({ to, subject, text });
```

### Transactional outbox

Port in [`outbox`](./apps/api/src/platform/outbox/outbox.writer.ts). Use it for domain events that must exist if and only if the business change commits. Importing `OutboxModule` also starts the dispatcher polling (`OUTBOX_POLL_INTERVAL`).

```ts
// Producer: record inside the same transaction as the change.
await this.prisma.$transaction(async (tx) => {
  await tx.announcement.create({ data });
  await this.outbox.record(tx, { type: 'classroom.announcement.created', payload: { id } });
});

// Consumer: register in onModuleInit; event.id is stable across redeliveries.
onModuleInit() {
  this.registry.register('classroom.announcement.created', async (event) => { /* ... */ });
}
```

- Delivery is **at-least-once**: handlers **must be idempotent** (deduplicate on `event.id`). Throw to request a retry; never put personal data in the error, it is stored in `lastError`.
- Retries back off 5s, 10s, 20s... up to 1h, for `OUTBOX_MAX_ATTEMPTS` attempts. An exhausted event keeps `failedAt` and stays in the table for inspection.
- An event type with no registered handler counts as a failed attempt (it is not dropped), so a missing registration never loses events silently.
- Handlers run outside any transaction with a 30s timeout; a timeout is a failed attempt. A claimed row is leased for 5 minutes, so a crashed process only delays redelivery.
- Polling is off when `NODE_ENV=test`; tests call `OutboxDispatcher.dispatchPending()` explicitly.

### Object storage

Port in [`storage`](./apps/api/src/platform/storage/storage.port.ts) with an S3 adapter. Import `StorageModule` and inject `STORAGE_PORT`.

```ts
constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}
await this.storage.put(`materials/${classroomId}/${fileId}`, bytes, { contentType: 'application/pdf' });
const url = await this.storage.getSignedDownloadUrl(key); // default TTL: STORAGE_SIGNED_URL_TTL
```

- Keys are opaque strings chosen by the caller and validated: non-empty, at most 1024 bytes, no leading `/`, no `\`, no control characters, no empty, `.` or `..` segments (`InvalidStorageKeyError`). Reading a missing key throws `StorageObjectNotFoundError`; deleting one succeeds.
- Content validation (type allow-list, size, count) belongs to the calling story, not to the port.
- Signed URLs are short-lived bearer credentials: hand them to the client, never log or persist them.
- In production credentials come from the instance role (leave `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` unset). Locally use MinIO: `docker compose up -d minio minio-init` (see [Local object storage](#local-object-storage-minio)). MinIO was chosen over LocalStack because only S3 is needed and it is lighter.

## Authentication and sessions

Endpoints live under `/auth` (`register`, `login`, `refresh`, `logout`, `password-reset/request`, `password-reset/confirm`); request and response shapes are in the committed [OpenAPI document](./apps/api/openapi.json). Policy lives in [Authentication and session](./rules/authentication-and-session.md). Code is in `apps/api/src/auth`.

- **Login:** returns a short-lived access JWT (HS256, signed with `JWT_SECRET`, claims `{ sub, sid }`, lifetime `JWT_ACCESS_TTL`) and an opaque refresh token. Only the hash of the refresh token is stored, in `RefreshToken`, tied to a session id.
- **Refresh:** rotates the refresh token on every use. Presenting an already-rotated token is treated as reuse and revokes the whole session, except inside the `REFRESH_REUSE_GRACE` window (default 30s, `0s` disables), which tolerates a client retrying after a lost response.
- **Logout:** revokes the current session.
- **Password reset:** `request` always answers `202` whether or not the account exists (no enumeration) and records a transactional outbox event; a handler sends the email through `EmailPort` with the link `PASSWORD_RESET_URL_BASE?token=<token>`. The token is random, stored hashed, single-use and expires after `PASSWORD_RESET_TTL`. `confirm` sets the new password and revokes all of the user's sessions.
- **Data cleanup:** an in-process job (`AuthDataCleanupScheduler`) prunes auth rows nobody can use any more, so the tables do not grow without bound. It runs about a minute after startup and then every `AUTH_CLEANUP_INTERVAL` (default 24h), and deletes in bounded batches of `AUTH_CLEANUP_BATCH_SIZE` rows. It removes sessions that expired more than `AUTH_DATA_RETENTION` ago (their refresh tokens are deleted first, in the same bounded batches), rotated refresh tokens rotated more than that ago unless their session is still live (not expired and not revoked, judged by the stored session state rather than the current `REFRESH_TOKEN_TTL`, so replaying such a token still revokes the session), and password reset tokens used or expired more than that ago. `AUTH_DATA_RETENTION` (default 30d) must not be shorter than `REFRESH_TOKEN_TTL`, so a live session never loses the rotated tokens that reuse detection relies on. Each run logs only counts per table and its duration, never tokens or user data; a failed run is logged and retried at the next interval.

Known limitations: login and reset requests are not throttled yet (planned for #19 or later), and `EmailPort` is still the in-memory stub, so no real email is sent.

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

When a `package.json` is present, CI requires `pnpm-lock.yaml`, sets up Node.js 22 with `pnpm` store caching, provisions an active PostgreSQL 16 service container (`localhost:5432` with healthcheck for upcoming Prisma database and integration testing), starts MinIO and its bucket bootstrap from `docker-compose.yml` for the object storage integration spec, installs dependencies with `pnpm install --frozen-lockfile`, and runs `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Each step is guarded against missing scripts and reports a GitHub notice and step summary when absent. Otherwise, CI explicitly reports that no **application** tests were configured or run in both a GitHub notice and the job summary. CI-tooling tests are separate; planned application checks and deployment are not evidence of a running backend.

## Shared contracts

NestJS generates an OpenAPI document (`@nestjs/swagger`) served with the Scalar API reference UI, and the frontend generates its TypeScript types from it. The generated `openapi.json` is committed at `apps/api/openapi.json` (regenerate with `pnpm openapi:export`; see [API conventions](./docs/api-conventions.md#openapi-document-and-api-reference)) and CI fails if it is stale versus the code. Realtime room state types are generated with `@colyseus/schema` codegen and message payload types are exported from `packages/contracts`; both are committed, and the frontend pulls everything with its `pnpm api:sync` script. These decisions (D4 and D8) were made and approved by Agustin on 2026-11-02; see [API contracts](./rules/api-contracts.md). The REST side (OpenAPI document, Scalar reference outside production, committed `openapi.json`, CI staleness check) is implemented, and so is the room state codegen with its CI staleness check; the frontend `api:sync` also fetches the realtime contracts (front PR #70), and message payload types in `packages/contracts` are planned for future issues.
