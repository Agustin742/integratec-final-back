# Technical Justification (R6)

This document justifies the relevant technical choices of the project: what was chosen, why, which alternatives were considered, and what the choice costs. It develops the summary in [master §11](../master-document.md#11-justificación-arquitectónica-de-alto-nivel) and satisfies course requirement R6. It records decisions made in the [project document](../master-document.md) and the decisions listed in [section 7](#7-architecture-decisions-recorded-on-2026-11-02), which were approved by Agustin (decision owner) on 2026-11-02. Choices that are still undecided are marked **Open**.

## 1. Stack

| Area | Decision | Why | Alternatives | Trade-off |
|---|---|---|---|---|
| Frontend | React + TypeScript + Vite | Interactive authenticated UI with panels independent of the 3D world | Next.js | SSR is not a central need and is given up |
| 3D world | Three.js with React Three Fiber | A real 3D world with an isometric camera and spatial interactions | PixiJS 2.5D (discarded for aesthetic reasons) | Assets, performance, camera, and collisions must be handled by the team |
| Backend API | NestJS + TypeScript | Modules, validation, and domain authorization in a structured API | Express or Fastify directly | More structure and conventions than a minimal server |
| Language | TypeScript on both sides | One language and shared typing concepts | JavaScript, other backend languages | Compile step and configuration |
| Quality | ESLint, Prettier, Vitest, Playwright, GitHub Actions | Static analysis, formatting, tests, and CI | Other tooling | Ongoing maintenance of the pipeline |

## 2. Authentication and authorization

- **Decision:** NestJS validates credentials with salted Argon2 or bcrypt hashing, manages expiring sessions, and enforces `401` versus `403` on protected endpoints and on realtime joins. Roles are scoped per school or classroom (School Owner, School Admin, Teacher, Student, Parent); there is no global administrator. See [Authentication and session](../rules/authentication-and-session.md) and [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md).
- **Why:** Course requirement R2 demands hashing, expiring sessions, protected resources, two or more roles, and user isolation. Per-school and per-classroom scoping matches the product model and avoids a privileged global role.
- **Alternatives:** An external identity service (master allows "an equivalent identity service"); OAuth or social login (a recommended extra, not planned for the MVP).
- **Trade-off:** Building authentication in the application gives full control and a clear defense story, but the team owns its security.
- **Session mechanism:** decided and approved by Agustin on 2026-11-02; see [decision D1](#d1-session-mechanism).
- **Open:** Lifetimes (configuration parameters). Client-side token storage is decided with the frontend; see [decision D1](#d1-session-mechanism).

## 3. Database and ORM

- **Decision:** Amazon RDS for PostgreSQL accessed with Prisma ORM; Prisma is the access layer, not the database. See [Data](../rules/data.md).
- **Why:** The domain is relational (users, schools, classrooms, enrollments, activities, submissions, grades, points, and messages with strong relationships and constraints), and the course requires related entities. Prisma gives typed queries, parameterized access, and migrations.
- **Alternatives:** MongoDB or other document stores; other ORMs or raw SQL.
- **Trade-off:** Schema changes require disciplined, reviewed migrations. RDS adds a fixed cost.

## 4. Realtime

- **Decision:** Colyseus for live classroom sessions, presence, and avatar movement, deployed separately from NestJS. Colyseus never writes durable data; persistent changes go through NestJS and are announced afterward. See [Architecture](../rules/architecture.md) and [Realtime and presence](../rules/realtime-and-presence.md).
- **Why:** Colyseus provides room lifecycle, synchronized state, and reconnection designed for rooms.
- **Alternatives:** Socket.IO alone, which would require implementing room and state logic; it remains an option only for isolated needs.
- **Trade-off:** One more service to deploy and learn. The MVP runs one Colyseus instance; scaling out needs a presence and routing strategy that is not defined.
- **Internal transport and service authentication:** decided and approved by Agustin on 2026-11-02; see [decision D2](#d2-nestjs-and-colyseus-integration).
- **Open:** The final event names and payloads.

## 5. Deployment

- **Decision:** AWS with Amplify Hosting for the frontend and ECS on Fargate behind an Application Load Balancer for NestJS and Colyseus, ECR for images, RDS in private subnets, S3 for objects, Secrets Manager, IAM least privilege, CloudWatch, and Budgets. See [AWS infrastructure](../rules/aws-infrastructure.md) and [Deployment and operations](../rules/deployment-and-operations.md).
- **Why:** Colyseus needs long-running processes and WebSocket connections, which Fargate supports and Lambda does not suit. One cloud provider also hosts the database and the AI service.
- **Alternatives:** A managed PaaS or EC2.
- **Trade-off:** Fargate, ALB, and RDS have continuous cost even at low traffic, so a budget and cleanup ownership are required.
- **Infrastructure as code:** Terraform defines the AWS resources, with remote state in S3 and reviewed plans; see [Infrastructure as code](../rules/infrastructure-as-code.md). AWS CDK in TypeScript was the main alternative: it shares the application language but relies on CloudFormation, whose failed rollbacks can block deployments. Terraform was chosen for its explicit plan, its industry adoption, and state the team controls, at the cost of learning HCL and operating the state backend.
- **Decided and approved by Agustin on 2026-11-02:** repository layout ([D3](#d3-repository-layout)), contract distribution ([D4](#d4-contract-distribution)), AWS region ([D5](#d5-aws-region)), and pipeline authentication ([D6](#d6-pipeline-authentication-to-aws)); see [API contracts](../rules/api-contracts.md).
- **Open:** Domain, and Amazon Bedrock model availability in `sa-east-1` (see D5).

## 6. Artificial intelligence

- **Decision:** Amazon Bedrock invoked only from NestJS using IAM roles; the bot is read-only in the MVP and the daily briefing is delivered once per user and day in the America/Argentina/Buenos_Aires time zone, with a structured fallback when the provider fails. See [AI bot and daily briefing](../rules/ai-bot-and-daily-briefing.md).
- **Why:** Credentials and authorization stay on the server, the bot inherits the user's permissions, and the read-only scope limits risk in the first delivery. It also covers the recommended AI feature of the course.
- **Alternatives:** Calling a provider from the frontend (discarded for security); a different model provider.
- **Trade-off:** Dependence on AWS availability and inference cost, mitigated by limits and the fallback.
- **Open:** Specific model and numeric usage limits.

## 7. Architecture decisions recorded on 2026-11-02

Decided and approved by Agustin (decision owner) on 2026-11-02. This is not a claim of team-wide approval; per [Documentation and decisions](../rules/documentation-and-decisions.md), a conflict with the team **MUST** be resolved before dependent implementation proceeds.

### D1. Session mechanism

- **Question:** How are sessions represented, renewed, and revoked?
- **Outcome:** A short-lived JWT access token plus an opaque refresh token stored hashed in the database and rotated on use. The access token **MUST** carry a session identifier that the server checks against the stored session on every protected request; a revoked session yields `401`. Lifetimes are configuration parameters.
- **Rationale:** Short-lived access tokens limit exposure, rotated hashed refresh tokens allow renewal without interruption, and the session identifier check keeps the logout and password-reset invalidation invariants of [Authentication and session](../rules/authentication-and-session.md).
- **Alternatives:** Cookie-based opaque session (A); opaque bearer token (C).
- **Affected contracts:** [Authentication and session](../rules/authentication-and-session.md), [Security](../rules/security.md), REST authentication and the realtime join check (D2).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Client-side storage (agreed with the frontend, approved by Agustin on 2026-11-02):** the frontend stores both tokens in `sessionStorage` and sends the access token as `Authorization: Bearer`; the refresh token is sent only to the refresh endpoint. No cookies are used, so API calls need no CSRF token. Accepted trade-off: tokens are readable by scripts running in the page, so the frontend **MUST** enforce a strict Content-Security-Policy and never render unsanitized HTML; this backend keeps access tokens short-lived and rotates refresh tokens. A refresh token presented after rotation **SHOULD** revoke its session as a reuse signal. See the frontend repository's `docs/technical-justification.md` (FD1).

### D2. NestJS and Colyseus integration

- **Question:** How does Colyseus verify a user's session and access before admitting a join?
- **Outcome:** Colyseus `onAuth` calls an internal NestJS endpoint to verify the user's session and authorization. The call is authenticated with a service secret stored in AWS Secrets Manager. Colyseus rejects joins when NestJS cannot verify.
- **Rationale:** NestJS stays the single authorization service and the answer comes from current persisted state.
- **Alternatives:** Signed short-lived join ticket verified offline (B); Colyseus reading sessions from the database directly (C), rejected because it breaks the single authorization service rule.
- **Affected contracts:** [Architecture](../rules/architecture.md), [Realtime and presence](../rules/realtime-and-presence.md), [AWS infrastructure](../rules/aws-infrastructure.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D3. Repository layout

- **Question:** How are the two services and shared contracts organized in this repository?
- **Outcome:** A pnpm workspaces monorepo: `apps/api` (NestJS), `apps/realtime` (Colyseus), and `packages/contracts` (shared types).
- **Rationale:** Services stay separately deployable while sharing one toolchain and one contracts package.
- **Alternatives:** Colyseus embedded in the NestJS app; two separate backend repositories.
- **Affected contracts:** [Architecture](../rules/architecture.md), [Infrastructure as code](../rules/infrastructure-as-code.md), and CI (a `package.json` and `pnpm-lock.yaml` are required once present).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D4. Contract distribution

- **Question:** How do the frontend and backend repositories share API contracts?
- **Outcome:** NestJS generates an OpenAPI document (through `@nestjs/swagger` decorators) served with the Scalar API reference UI; the frontend generates its TypeScript types from that document.
- **Rationale:** The backend owns one authoritative specification and consumers learn about changes by regenerating types.
- **Alternatives:** A shared `contracts` npm package with zod schemas published to GitHub Packages (rejected: adds publishing, versioning, and registry authentication); manually copied types (rejected: drifts out of sync).
- **Affected contracts:** [API contracts](../rules/api-contracts.md) and the README "Shared contracts" section.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Update:** The distribution mechanism is detailed in [D8](#d8-committed-rest-and-realtime-contract-artifacts), which closes the earlier open item on realtime message and state types.

### D5. AWS region

- **Question:** Which AWS region hosts the environment?
- **Outcome:** `sa-east-1` (Sao Paulo).
- **Rationale:** The product is sold in Argentina and realtime latency matters.
- **Alternatives:** `us-east-1`, cheaper and with the widest Amazon Bedrock model availability, but with higher latency from Argentina (rejected because realtime responsiveness matters for the target market).
- **Trade-off:** Higher cost is accepted.
- **Affected contracts:** [AWS infrastructure](../rules/aws-infrastructure.md), [Infrastructure as code](../rules/infrastructure-as-code.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Open:** Amazon Bedrock model availability in `sa-east-1` **MUST** be verified; cross-region inference may be needed.

### D6. Pipeline authentication to AWS

- **Question:** How does the GitHub Actions pipeline authenticate to AWS?
- **Outcome:** GitHub Actions OIDC federation to an IAM role; no long-lived access keys.
- **Rationale:** Short-lived credentials leave no stored keys to leak or rotate.
- **Alternatives:** IAM user access keys in GitHub Secrets, rejected.
- **Affected contracts:** [AWS infrastructure](../rules/aws-infrastructure.md), [Infrastructure as code](../rules/infrastructure-as-code.md), [Deployment and operations](../rules/deployment-and-operations.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D7. Invitation model

- **Question:** RN-02, RF-AUL-002, and HU-AUL-002 allow joining by email invitation or by a shareable code/link, while [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md) and [Data](../rules/data.md) allowed only single-use email invitations. Which mechanisms are valid?
- **Outcome (option B):** two mechanisms.
  1. **Email invitation** (rules unchanged): bound to one target (school or classroom), one role, and one email address; hashed secret, expiry, revocable, single use. It is mandatory for teachers invited by Owner or Admin and for parent/tutor invitations (parents are always invited by email, single use).
  2. **Classroom join code:** per classroom, shareable by the teacher (Owner or Admin **MAY** also manage it). It grants only the `Student` role in that classroom, never Teacher, Parent, or a school role. The secret is stored hashed and shown once on creation or regeneration (regenerating shows a new code and invalidates the previous one). It has an expiry, can be revoked or regenerated, and has an optional maximum number of uses with a use counter. Acceptance requires an authenticated account. Membership creation is atomic and idempotent: an already-enrolled student is not enrolled twice and does not consume a use. Attempts are rate-limited against brute force, the code has enough entropy for that, and every join is recorded (who and when) for audit.
- **Rationale:** Loading 30 emails one by one blocks classroom onboarding, and a shareable code (as in Google Classroom) is the norm in schools. The risk of a leaked code is bounded by the Student-only role, expiry, revocation, maximum uses, rate limiting, and authenticated joins.
- **Alternatives:** Email single-use only (A), rejected because of onboarding friction; an unrestricted permanent link, rejected because it has no expiry or revocation.
- **Affected contracts:** The invitation data model (target email is required for email invitations; the join code has no target email), membership endpoints, HU-AUL-002, RN-02, RF-AUL-002, [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md), and [Data](../rules/data.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Open:** Whether the join code is a single `Invitation` entity with a kind discriminator or a separate `ClassroomJoinCode` entity is left to the Prisma baseline schema work item.

### D8. Committed REST and realtime contract artifacts

- **Question:** In what form does this repository publish its contracts so the frontend can consume them without a running backend, and how are realtime message and state types distributed?
- **Outcome:**
  1. **REST:** NestJS generates `openapi.json` and this repository **COMMITS** it (planned path, for example `apps/api/openapi.json`; the exact path is set by the monorepo bootstrap). Backend CI **MUST** fail if the committed file is stale versus the code. The frontend sync script (`pnpm api:sync`) fetches the committed file from this repository (`develop` branch, through the raw GitHub URL or a local checkout path) and regenerates its types with `openapi-typescript`; the generated types are committed in the frontend repository.
  2. **Realtime:** this repository generates client-side TypeScript for Colyseus room state with `@colyseus/schema` codegen (`schema-codegen`) and exports realtime message payload types from `packages/contracts`. The generated artifacts are committed here (path set by the monorepo bootstrap), and the same frontend sync script pulls them into the frontend repository.
- **Rationale:** One committed artifact is the authoritative contract; a stale check keeps it faithful to the code; the frontend build and its pull request diffs show contract changes without depending on a deployed backend.
- **Alternatives:** Generating types in frontend CI from the deployed backend (rejected: the build depends on backend availability and contract changes are not visible in pull requests); publishing `packages/contracts` to GitHub Packages (rejected: publishing, versioning, and registry authentication overhead); hand-written realtime types in the frontend (rejected: drift and runtime errors).
- **Trade-off:** Someone must run the frontend sync; types are stale until then.
- **Affected contracts:** [API contracts](../rules/api-contracts.md), [Architecture](../rules/architecture.md), [Realtime and presence](../rules/realtime-and-presence.md), CI (staleness check), and the README "Shared contracts" section. The frontend side is decision FD7 in its repository's `docs/technical-justification.md`.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Open:** The exact paths of the committed artifacts, set by the monorepo bootstrap.

## 8. Known conflicts and notes

- The [derived design views](./diagrams/README.md) are proposed design aligned with the school model. Where they differ, the domain rules prevail; they are not competing requirements.
- The requirements state that dates are "stored" in the Buenos Aires zone; the project plans timezone-aware instants presented in that zone, pending confirmation.
