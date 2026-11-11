# Tracker — Agustin

## 2026-11-10 — Classroom presence and movement, server side (#25)

- **Status:** in-progress (seven work-unit commits on `feat/25-classroom-presence`; PR not opened yet)
- **Area / files:** `packages/contracts/src/index.ts` and `src/realtime/generated/`, `apps/realtime/src/` (`rooms/classroom-room.ts`, `rooms/classroom-state.ts`, `rooms/room-directory.ts`, `presence/`, `movement/`, `time/`, `internal/eviction-route.ts`, `join/`, `config/realtime-config.ts`), `apps/api/src/internal/realtime/` (re-verification, connected-time), `apps/api/src/platform/realtime/` (eviction events and handler), `apps/api/src/auth/` (session revocation events), `apps/api/prisma/` (`activity_metrics` migration), `apps/api/src/config/api-config.ts`, `rules/realtime-and-presence.md`, `rules/api-contracts.md`, `docs/technical-justification.md` (D14), `README.md`, `docker-compose.yml`
- **Change:** Recorded the five realtime decisions approved on 2026-11-10 as D14. The classroom room now keeps one avatar per user shared by up to three connections (the fourth closes with `4002`), moves avatars from validated `avatar:input` intents on a fixed 20 Hz step with a fixed speed and wall and desk collisions (30 messages per second per connection, the excess dropped), holds dropped connections for a configurable window (`RECONNECTION_WINDOW_SECONDS`, default 20) and re-verifies access with the API when they return, reports one aggregate connected time per presence session to a new internal endpoint that adds it to a per-user, per-classroom, per-UTC-day `activity_metrics` row, and evicts users from live rooms (`4001`) when a session is revoked through an outbox event and an internal realtime route. Fixed a latent #24 defect: `client.auth.sessionId` made Colyseus reuse the account session id as the connection id, so two connections of one user collided; it is now `authSessionId`.
- **Reason:** Issue #25 needs the realtime classroom to be authoritative, to survive reconnection and access loss, and to feed the activity metric without writing per movement.
- **Open points for the PR:** the walkable layout (16 by 12 with 13 desks) is a proposal to confirm; close codes `4001` and `4002` also exist in Colyseus (clients must read the close reason); membership removal does not exist yet, so only the recorder hook is in place; the reverse proxy must never route `/internal/*`.
- **Review fixes (native review warnings):** A reconnecting connection now stays held until the API re-verification succeeds, so its `avatar:input` is ignored meanwhile. A definitive denial still closes with `4001` (`access_revoked`), while a verification that could not complete (network, timeout, 5xx, throttling) closes with the new retryable `4100` (`verification_unavailable`), documented in `rules/api-contracts.md` and D14. Eviction outbox events got their own retry budget (12 attempts, about 2.8 hours) with an error log when one is given up on, the eviction client keeps the failure kind and HTTP status and logs them (no identifiers or secrets), and the eviction integration suite is scoped to its own rows so it no longer races with other specs. The `activity_metrics` foreign keys stay `ON DELETE RESTRICT` like every other table, because `rules/data.md` leaves account and classroom deletion open and requires cascades to be policy-defined.
- **Open points for the PR (added):** decide what deleting a user or classroom should do with `activity_metrics` once the deletion policy exists; evictions are still lost after a realtime outage longer than about 2.8 hours (no periodic fallback by decision).
- **Next step:** Open the PR into `develop` and ask the team to confirm the layout and the close-code overlap.

## 2026-11-09 — Colyseus skeleton with join authorization through an internal API endpoint (#24)

- **Status:** in-progress (PR #77 review fixes pushed; awaiting re-review)
- **Area / files:** `apps/api/src/internal/realtime/` (controller, `InternalServiceGuard`, DTO, module), `apps/realtime/src/` (`rooms/classroom-room.ts`, `rooms/authenticate-join.ts`, `join/api-join-verifier.ts`, `app.config.ts`), `packages/contracts/` (join options, generated room state), `scripts/check-generated-clean.mjs`, `.github/workflows/ci.yml`, `package.json`, `rules/realtime-and-presence.md`, `rules/authentication-and-session.md`, `docs/technical-justification.md` (D2), `docs/diagrams/`, `README.md`
- **Change:** Added `POST /internal/realtime/join-verification`, which checks the access token and classroom access through the existing session and access services, is authenticated by `x-internal-service-secret` (constant-time compare), is hidden from the public OpenAPI document, and returns the verified identity. Added `ClassroomRoom` (one room per `classroomId`) whose static `onAuth` takes the token from the Colyseus `client.auth.token` (`Authorization: Bearer` on the matchmake request), re-checks `classroomId` on every join path, and rejects with a generic error on a missing token, API denial, error, timeout, or malformed response. Added the `@colyseus/schema` state codegen (`pnpm realtime:codegen`, `realtime:codegen:check`) with a CI step that now fails on modified and on new untracked generated files. Documented the credential transport as an update of D2 (2026-11-09).
- **Reason:** NestJS must be the single authorization service (D2); without the gate a stolen, expired, revoked, or foreign-classroom token could enter a live room. The header path was chosen over join options because it is framework-native, has the same Bearer shape as REST, and keeps credentials out of room options and URLs. Unblocks #25, #48, and #59.
- **Verification:** Tests written first (RED then GREEN) including end-to-end joins against a real Colyseus server; realtime suite 67/67, contracts 3/3. Known flakes: `src/auth/refresh.spec.ts` concurrent reuse-grace test failed once under full-suite load and passes alone 3/3 (auth untouched by this branch); `python -m unittest discover -s scripts/ci` fails on Windows because of the WSL relay and also fails on the base branch.
- **Review fixes (PR #77, reported by Mati):** Linked parents were admitted into the live room because `verifyClassroomAccess` resolves `PARENT` under `requiredRole: 'ANY'`; the join verification now answers `403` for a parent, and `PARENT` was removed from the response DTO and from the realtime `CLASSROOM_ROLES`, so the room also denies it if the API ever returned it (`rules/realtime-and-presence.md`, Join authorization). Added the required "Parent denied a live join" tests on both sides (RED then GREEN). Updated the outdated README note: the frontend `api:sync` now fetches the realtime contracts (front PR #70).
- **Next step:** Team re-review of PR #77. Frontend counterpart in front PR #70 (FD3 update and `api:sync` realtime path, front #71). Infra follow-up: Caddy must never route `/internal/*`.

## 2026-11-08 — PR #76 review fixes: classroom authorization and list contract (#21)

- **Status:** in-progress (fixes pushed to `feat/21-virtual-classroom`; PR #76 awaiting review)
- **Area / files:** `apps/api/src/access/access-verification.service.ts`, `apps/api/src/classrooms/`, `apps/api/src/http/visible-text.ts`, `apps/api/src/users/profile.dto.ts`, `apps/api/src/app.module.ts`, `apps/api/openapi.json`
- **Change:** Merged `develop` into the branch (kept `UsersModule` and `ClassroomsModule`, regenerated OpenAPI). Moved classroom creation and listing authorization into `AccessVerificationService` (`resolveClassroomCreationTarget`, `listAccessibleClassrooms`, shared `deriveClassroomAccessRole`), so detail and list resolve the same role and nothing falls open. Unrelated and nonexistent schools now return the same `404`; `403` only for a student or parent related to that school; a user with several schools must send `schoolId` (`400`); independent teachers can always create their own classroom. Adopted the shared pagination contract on `GET /classrooms` and `GET /me/classrooms` (`page`, `pageSize`, `sort`; `{items,page,pageSize,total}`). Extracted a shared `@VisibleText` validator and applied it to classroom name and subject; an empty `PATCH` body is now `400`. Rejection tests assert that nothing is written. Commits: `19c9acc`, `6bd34b5`, `0b36fef`.
- **Reason:** Review of PR #76 found an existence leak between `403` and `404` (reported by Alejo), authorization duplicated outside the shared service, an arbitrary school picked for multi-school users, and a list contract that diverged from `docs/api-conventions.md`.
- **Next step:** Re-review of PR #76. Team decisions: initial desk count (12), default pet and control states, PR size. Follow-up for the invitation flow: invited learners must not get the `INDEPENDENT_TEACHER` registration path.

## 2026-11-07 — Periodic cleanup of expired auth sessions and tokens (#70)

- **Status:** completed (merged in PR #72)
- **Area / files:** `apps/api/src/auth/` (`auth-data-cleanup.service.ts`, `auth-data-cleanup.scheduler.ts`), `apps/api/prisma/` (cleanup indexes migration), `apps/api/src/config/api-config.ts`, `apps/api/src/openapi/export.ts`, `apps/api/.env.example`, `docker-compose.yml`, `README.md`
- **Change:** Added `AuthDataCleanupService`, which deletes expired sessions (their refresh tokens first, in batches, so the foreign key cascade removes nothing unbounded), rotated refresh tokens older than a retention window unless their session is still live by stored state (so reuse detection survives a shortened `REFRESH_TOKEN_TTL`), and used or expired password reset tokens, in bounded batches without a long transaction, and `AuthDataCleanupScheduler`, an in-process job that runs shortly after startup and then at a fixed interval (skips overlapping runs, never throws out of the timer, not scheduled when `NODE_ENV=test`). Each run logs only counts and duration; a failed run logs the error class and Prisma code, never the message. New variables `AUTH_DATA_RETENTION` (30d), `AUTH_CLEANUP_INTERVAL` (24h, max 7d) and `AUTH_CLEANUP_BATCH_SIZE` (1000), passed through Compose; retention must not be shorter than `REFRESH_TOKEN_TTL`. Added indexes on the filtered timestamp columns.
- **Reason:** Sessions, rotated refresh tokens and reset tokens were never deleted, so the tables grew without bound; rotated tokens are kept for the retention window to preserve reuse detection.
- **Next step:** Open the PR into `develop`. Follow-up: throttling for login and reset request.

## 2026-11-06 — Authentication and session lifecycle (#18)

- **Status:** completed (pending PR review)
- **Area / files:** `apps/api/src/auth/`, `apps/api/prisma/` (`RefreshToken` and `PasswordResetToken` models and migrations), `apps/api/src/config/api-config.ts`, `apps/api/openapi.json`, `apps/api/.env.example`, `docker-compose.yml`, `README.md`
- **Change:** Added login (HS256 access JWT with `sub` and `sid`, opaque refresh token stored hashed), refresh rotation with reuse detection and a configurable `REFRESH_REUSE_GRACE` window, logout, and password reset request and confirm (always `202` on request, outbox event, single-use expiring token, all sessions revoked on confirm). Added the new configuration variables, passed `REFRESH_REUSE_GRACE` through Compose, and documented the session lifecycle in the README.
- **Reason:** Frontend and later stories need authenticated sessions that follow decision D1 and the authentication rule.
- **Next step:** Open the PR into `develop`. Follow-ups: throttling for login and reset request, cleanup of expired refresh-token rows, and stabilizing flaky concurrency tests (`outbox.spec.ts` SKIP LOCKED, refresh concurrency, register concurrency).

## 2026-11-05 — Platform ports: email, transactional outbox, object storage (#45)

- **Status:** in-progress (implementation and docs done; PR pending)
- **Area / files:** `apps/api/src/platform/` (`email`, `outbox`, `storage`), `apps/api/prisma/` (`OutboxEvent` model and migration), `apps/api/src/config/api-config.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`
- **Change:** Added the shared ports that later stories consume. Email: `EmailPort` with an in-memory stub (no provider, gap 7). Transactional outbox: `OutboxWriter.record(tx, ...)` inside the caller's transaction, handler registry and a dispatcher with at-least-once delivery, backoff, per-handler timeout and lease, and `failedAt` on exhaustion. Storage: `StoragePort` with an S3 adapter, key validation, short-lived signed URLs and S3 settings validated in `api-config.ts`. Local MinIO and bucket bootstrap in Compose using Chainguard images pinned by digest, also started in CI. Documented how stories consume each port in the README. MinIO was chosen over LocalStack (S3 only, lighter); the outbox was chosen over direct in-process events (user decision 2026-11-05). Commits: `fa073d0`, `7f966e4`, `2dcfe1b`, `0d8b14b`, `5ed3ed3`.
- **Reason:** #18, #22, #37, #23, #27, #28, #30 and #46 depend on email, domain events and storage; stories depend on interfaces so the provider and the real bucket can be chosen later.
- **Verification:** Tests written first (RED) then GREEN per commit: outbox spec 16/16, storage spec 18/18 against local MinIO, API suite 187 passed with Postgres and MinIO; `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `check_docs.py` and actionlint pass. `scripts/ci` has 13 failures that already exist on the base branch (WSL relay, environment). The MinIO CI step has not run on GitHub Actions yet. `.env.example` lines for the new variables are pending (not editable by the agent).
- **Next step:** Open the PR into `develop`, request review, and add the `.env.example` placeholders for the outbox and S3 variables.

## 2026-11-05 — PR #65 review fixes: seed allowlist and Prisma client in the runtime image

- **Status:** completed
- **Area / files:** `apps/api/prisma/seed.ts`, `apps/api/prisma/seed-guard.ts`, `apps/api/prisma/seed-guard.spec.ts`, `apps/api/Dockerfile`
- **Change:** Replaced the seed denylist (`production`/`staging`) with an allowlist evaluated before any deletion: the seed now runs only when `DATABASE_URL` points to `localhost`, `127.0.0.1`, `::1`, or the compose `postgres` host, and still refuses `production`/`staging`. Error messages show the host only, never credentials. Added unit tests that need no database. In the API Dockerfile the builder now stages only the generated `.prisma/client` output at its original path and the runtime stage copies that, instead of copying the contents of `@prisma+client*` over `.pnpm/`, which overwrote pnpm's hoisted links.
- **Reason:** With `NODE_ENV` unset and `DATABASE_URL` pointing to a real database, the seed would wipe every table; the old Dockerfile copy only worked by accident. Verified by building the image, loading `PrismaClient` in it, and getting `/health` 200 against a throwaway Postgres.
- **Next step:** None

## 2026-11-05 — Move production compute to a single EC2 host (D13)

- **Status:** in-progress (documentation done; pending PR review)
- **Area / files:** `docs/technical-justification.md` (D13, D5, section 5), `master-document.md` (section 7), `rules/` (aws-infrastructure, infrastructure-as-code, realtime-and-presence, architecture), `docs/architecture.md`, `docs/functional-requirements.md` (RNF-008), `docs/diagrams/` (deployment-and-network, core-flows, gaps, README files), `infra/README.md`
- **Change:** Recorded D13: production compute moves from ECS Fargate behind an Application Load Balancer (plus NAT) to one `t3.small` EC2 host running Docker Compose with Caddy (Let's Encrypt TLS), NestJS, and Colyseus; RDS stays a separate managed database; no SSH (SSM Session Manager); deploys through the keyless CodePipeline flow and SSM Run Command. Updated the services, network, identity, delivery, and observability rules, the diagrams, and the Spanish project document to match. Updated D5 and gaps 20 to 23: Bedrock is available on the Free plan but global and geographic cross-Region inference are not supported, so the bot needs an in-Region on-demand model in `us-east-2` (to confirm in the console). Decision approved by Agustin on 2026-11-05.
- **Reason:** The account uses the credit-based Free plan; the fixed hourly cost of an ALB, two Fargate services, and a NAT gateway (roughly USD 60 to 100 per month with RDS, unverified estimate) would exhaust the credits in about 2 to 3 months, while a single host costs roughly USD 10 to 15 per month plus RDS.
- **Next step:** PR review into `develop`; then implement the network, host, and pipeline in backend issues #59 to #62. Decide the domain and DNS name for Let's Encrypt (gap 20) and the in-Region Bedrock model (gap 21).

## 2026-11-05 — OpenAPI document and REST error envelope baseline (#15)

- **Status:** in-progress
- **Area / files:** `apps/api/src/http/`, `apps/api/src/openapi/`, `apps/api/openapi.json`, `.gitattributes`, `.github/workflows/ci.yml`, `docs/api-conventions.md`, `README.md`
- **Change:** Added a global validation pipe (unknown fields rejected, per-field details), a single error envelope with stable codes and `x-request-id` correlation, a JSON request log, pagination and sort conventions, the OpenAPI builder with Scalar at `/docs` outside production, `pnpm openapi:export` with the committed `apps/api/openapi.json`, a CI staleness check, and `docs/api-conventions.md`.
- **Reason:** Frontend and backend need one observable error and list contract, and the committed OpenAPI file (D8, D9) must exist before endpoints are implemented.
- **Next step:** Push the branch, open the PR into `develop`, and get teammate review. Close #15 manually after merge because closing keywords only fire on `main`.

## 2026-11-04 — Terraform skeleton, remote state, and GitHub OIDC role (#16)

- **Status:** completed
- **Area / files:** `infra/bootstrap/`, `infra/envs/prod/`, `infra/README.md`, `.github/workflows/ci.yml`, `scripts/ci/test_checks.py`, `.gitignore`, `docs/technical-justification.md` (D5, D6), `docs/architecture.md`, `docs/diagrams/`, `rules/aws-infrastructure.md`, `rules/infrastructure-as-code.md`
- **Change:** Added a bootstrap root for the hardened S3 state bucket, the `prod` root with an S3 backend using the native lockfile, the GitHub Actions OIDC provider and a `main`-only least-privilege CI role, `terraform test` suites with a mocked provider, a CI job running fmt, validate, and tests per root, and the infra README. Update 2026-11-04: the account assigns `us-east-2` and blocks the OIDC provider through AWS-managed policies, so D5 moved from `sa-east-1` to `us-east-2` and the OIDC provider, role, and policy are gated by `enable_github_oidc` (default `false`); Terraform is applied locally with short-lived `aws login` credentials and the OIDC pipeline deploy is deferred. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** Later infrastructure issues need remote state, keyless pipeline authentication (D6), and validated Terraform.
- **Verification:** `terraform fmt -check`, `validate`, and `terraform test` pass for both roots (bootstrap 3, prod 12); docs checks pass. Applied in `us-east-2` with explicit approval: bootstrap created the state bucket (6 resources) and prod wrote its first remote state (0 resources, OIDC disabled); a second plan of each root shows no changes, and the bucket's versioning and public access block were confirmed with the AWS CLI. The OIDC trust (only `main` can assume the role) is not verified in AWS because the role is not created in this account.
- **Next step:** Open the PR into `develop`. Decide the keyless deploy pipeline (for example CodePipeline with a GitHub connection) in its own issue.

## 2026-11-03 — Typed environment configuration for api and realtime (#12)

- **Status:** completed
- **Area / files:** `apps/api/src/config/`, `apps/realtime/src/config/`, `eslint.config.mjs`, `apps/*/.env.example`, `README.md`, `.gitignore`
- **Change:** Added zod-validated `loadApiConfig` / `loadRealtimeConfig`, fail-fast startup with an aggregated diagnostic, a lint rule against direct `process.env` reads, `.env.example` files, a `.env.*` ignore rule, and a Configuration section in the README. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** Rule `configuration-and-environments.md` requires a typed boundary and clear diagnostics; the apps previously read `process.env` ad hoc and enabled CORS for any origin.
- **Next step:** Open the PR for #12 into `develop`; wire the typed config into persistence and token services as they land.

## 2026-11-02 — Record multiple-choice scope and classroom member directory (D11, D12)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `docs/functional-requirements.md`, `master-document.md`, `rules/` (classrooms-and-roles, communication-and-notifications, activities-and-grading)
- **Change:** Recorded D11: auto-graded multiple choice in activities and exams is MVP Core, while ungraded self-assessed practice quizzes stay MVP Extendido; fixed the requirements wording that listed self-assessed quizzes inconsistently. Recorded D12: `GET /classrooms/:id/members` is readable by every classroom member and returns only user id, display name, classroom role, and avatar summary (no emails, parent links, grades, or points; parents not listed), `404` for non-members, paginated, optional `q` display-name prefix filter. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The requirements contradicted themselves on multiple-choice scope, and the frontend needs a minimal roster for @mention autocomplete (issues #52 backend, #51 frontend).
- **Next step:** Implement the endpoint in #52 and publish its OpenAPI entry first (D9).

## 2026-11-02 — Record contract-first stubs and school time zone for deadlines (D9, D10)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/` (api-contracts, data-and-time, data, activities-and-grading), `docs/architecture.md`, `docs/diagrams/` (gaps, conventions, README files, deployment-and-network)
- **Change:** Recorded D9: the backend publishes each endpoint's DTOs and OpenAPI entry (a `501` stub is allowed) before or with its implementation so the frontend can mock from the contract. Recorded D10: instants stored in UTC, API returns ISO 8601 UTC, each School has a persisted IANA time zone (default `America/Argentina/Buenos_Aires`), the server decides lateness in UTC. Closed gap 16. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The frontend needs to proceed ahead of backend implementation, and deadline display needs one unambiguous time zone for students and teachers.
- **Next step:** Add the School time zone field in the Prisma baseline schema work item.

## 2026-11-02 — Record committed REST and realtime contract artifacts (D8)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/` (api-contracts, architecture, realtime-and-presence), `README.md`, `docs/architecture.md`, `docs/diagrams/` (gaps, realtime-colyseus, deployment-and-network, class-design, README files)
- **Change:** Recorded D8: the backend commits `openapi.json` (CI fails if stale), generates Colyseus room state types with `schema-codegen` and exports message payload types from `packages/contracts`, all committed; the frontend pulls them with `pnpm api:sync`. Closed the open item on realtime type distribution. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The frontend needs contract changes visible in pull requests and a build that does not depend on a running backend.
- **Next step:** Fix the exact artifact paths and the CI staleness check in the monorepo bootstrap.

## 2026-11-02 — Record client-side token storage

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/authentication-and-session.md`, `docs/diagrams/05-reference/gaps.md`, `docs/diagrams/02-system-architecture/deployment-and-network.md`, `docs/diagrams/04-behavioral/core-flows.md`
- **Change:** Closed the D1 open item: the frontend stores both tokens in `sessionStorage` and sends a bearer header; recorded the backend-side mitigations (short access tokens, rotation, refresh reuse revocation, no cookie authentication). Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** D1 required agreeing client-side storage with the frontend before release; the frontend decision FD1 was taken.
- **Next step:** Implement in #18 (login, refresh, logout).

## 2026-11-02 — Approve D1–D6 and record invitation model (D7)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/` (classrooms-and-roles, data, authentication-and-session, architecture, api-contracts, aws-infrastructure, infrastructure-as-code), `docs/diagrams/` (gaps, data-model, README files, review-guide, use-cases, class-design), `README.md`
- **Change:** Marked D1–D6 as approved by Agustin (decision owner) on 2026-11-02, without claiming team-wide approval. Recorded D7: email invitations (mandatory for teachers and parents) plus a per-classroom join code that grants only the Student role (hashed, expiry, revocable, optional max uses, rate limited, audited). Updated the invitation and session rows in the data rules. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** RN-02, RF-AUL-002, and HU-AUL-002 allowed a shareable code while the rules allowed only email invitations; the Session entity was still marked open although D1 decided it.
- **Next step:** Decide the join code entity shape in the Prisma baseline schema work item; align `master-document.md` §2.1/§2.2 (still email-only) with D7.

## 2026-11-02 — Add rule routing index for agents

- **Status:** completed
- **Area / files:** `rules/index.md`, `rules/README.md`, `AGENTS.md`
- **Change:** Added a routing index that maps task types and touched areas to the rules to read and when to skip each one; pointed agent instructions and the rules README to it. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** Agents were reading every rule for every task, wasting context; the existing README list describes rules but not when they apply.
- **Next step:** Keep the index in sync when rules are added or renamed.

## 2026-11-02 — Record architecture decisions

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `docs/architecture.md`, `rules/` (authentication-and-session, architecture, api-contracts, aws-infrastructure, infrastructure-as-code), `README.md`, `master-document.md`
- **Change:** Recorded six decisions made by Agustin: JWT access plus hashed rotating refresh token, Colyseus `onAuth` verification through an internal NestJS endpoint, pnpm monorepo, OpenAPI with Scalar, `sa-east-1`, and GitHub OIDC for the pipeline. Removed them from the open-decision lists. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** These open decisions blocked implementation work items.
- **Next step:** Team approval of the six decisions; agree client-side token storage with the frontend; verify Bedrock availability in `sa-east-1`.

## 2026-11-02 — Align remaining docs with the school niche model

- **Status:** completed
- **Area / files:** `docs/architecture.md`, `docs/technical-justification.md`, `rules/classrooms-and-roles.md`, `rules/authentication-and-session.md`, `rules/data.md`, `docs/diagrams/README.md`, `docs/diagrams/05-reference/gaps.md`
- **Change:** Replaced office/room wording with school/classroom roles and entities; stated that the derived design views still describe the earlier office and room model and are pending realignment (the requirement documents are already aligned). Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** These documents contradicted the school niche source of truth.
- **Next step:** Realign `docs/diagrams/` (data model, class design, use cases, flows, deployment) to the school model.

## 2026-10-30 — Record resolved classroom, grading and points decisions

- **Status:** completed
- **Area / files:** `rules/` (classrooms-and-roles, authentication-and-session, activities-and-grading, points-and-shop, data, live-classroom-tools, realtime-and-presence)
- **Change:** Recorded the user's decisions as rules: foreign resources respond `404` (`403` only for insufficient role on a visible resource), invitation email need not match, at most 2 guardians per student, adult mode keeps parent links but disables parent actions, one account may hold both paths, 0-100 grades, teacher-configured resubmission, per-student points ledger, classroom items bought by students, streak breaks when the activity requirement is unmet, one seat per enrolled student, freeze does not lock the teacher. Admin versus Owner delegation and point weights stay deferred. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** These were open decisions blocking implementation.
- **Next step:** Align the frontend rules; decide Admin delegation during the roles implementation.

## 2026-10-30 — Realign backend rules with the school niche

- **Status:** completed
- **Area / files:** `rules/` (classrooms-and-roles, activities-and-grading, communication-and-notifications, points-and-shop, live-classroom-tools, data, ai-bot-and-daily-briefing, realtime-and-presence, architecture, authentication-and-session, README), `master-document.md` (pet/bot separation, section 13), `docs/architecture.md` (link paths only)
- **Change:** Renamed the office/room, task, and meeting rules to the school model and rewrote them; added the points-and-shop and live-classroom-tools rules; rewrote the data model (schools, classrooms, enrollments, parent links, activities, points ledger, shop, pet, notifications, bot configuration); updated the bot (RAG over approved material, exam block, guide-only rule), realtime (classroom controls, freeze, collaboration sync candidate), architecture (candidate external services), and authentication (organization paths, invitations, adult mode). Pet and AI bot are documented as independent. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The master document v0.3 narrowed the product to schools; the rules had to match it before implementation.
- **Next step:** Realign the frontend rules, then the `docs/` requirement and design documents.

## 2026-10-30 — Rewrite master document for the school niche

- **Status:** completed
- **Area / files:** `master-document.md`
- **Change:** Rewrote the product scope for schools (teachers, students, parents, school owner/admin): organization paths, roles, activities and grades, points and shop, classroom controls, 2D classic mode, RAG-based AI bot, MVP split into core and extended, updated R1-R8 checks, and version 0.3. Removed offices/rooms, Kanban, generic tasks, and meetings. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The team narrowed the product to an education niche; the master document must match before the data model and rules are derived from it.
- **Next step:** Realign the `rules/` files with the new scope (classrooms and roles, activities and grading, points and shop, live classroom tools, notifications, data, AI bot); decide the candidate technologies in `docs/technical-justification.md`.

## 2026-10-28 — Adopt Terraform for infrastructure as code

- **Status:** completed
- **Area / files:** `rules/infrastructure-as-code.md`, `rules/aws-infrastructure.md`, `rules/README.md`, `rules/documentation-and-decisions.md`, `docs/technical-justification.md`, `master-document.md`, `.gitignore`
- **Change:** Added the Terraform rule (location in `infra/`, pinned versions, S3 remote state with locking, secrets, reviewed plans, drift handling); linked it from the AWS rule, index, justification, and master document; ignored Terraform state and variable files; fixed leftover "rendering technology unresolved" wording. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** AWS infrastructure had no reproducible definition; Terraform was chosen over AWS CDK.
- **Next step:** Team to confirm the decision in the pull request; resolve open points (task definition ownership with the image pipeline, Amplify management, pipeline authentication); create `infra/`.

## 2026-10-27 — Add backend domain rules and project docs

- **Status:** completed
- **Area / files:** `rules/` (architecture, authentication-and-session, rooms-and-permissions, tasks-and-productivity, communication-and-meetings, ai-bot-and-daily-briefing, realtime-and-presence, data, aws-infrastructure), `docs/technical-justification.md`, `docs/ai-usage.md`, `docs/architecture.md`, `master-document.md`, `AGENTS.md`
- **Change:** Added the backend domain, data, and AWS infrastructure rules following the functional requirements; added the technical justification, AI usage declaration, and architecture docs; aligned the master document rule index; required tracker updates in agent instructions. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The backend had no domain rules, although master document section 13 plans them and delegates the data model and NestJS/Colyseus integration to them.
- **Next step:** Resolve conflicts between `docs/proyect-diagrams` and the ERS (roles, room model, task states, bot writes, join requests); decide the session mechanism; fill the real cases in `docs/ai-usage.md`; open a pull request to `develop`.
