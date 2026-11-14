# Technical Justification (R6)

This document justifies the relevant technical choices of the project: what was chosen, why, which alternatives were considered, and what the choice costs. It develops the summary in [master §11](../master-document.md#11-justificación-arquitectónica-de-alto-nivel) and satisfies course requirement R6. It records decisions made in the [project document](../master-document.md) and the decisions listed in [section 7](#7-architecture-decisions-recorded-on-2026-11-02), which were approved by Agustin (decision owner) on 2026-11-02, plus [D13](#d13-production-compute-on-a-single-ec2-host), approved on 2026-11-05. Choices that are still undecided are marked **Open**.

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

- **Decision:** AWS with Amplify Hosting for the frontend and, for NestJS and Colyseus, a single EC2 host running Docker Compose behind a Caddy reverse proxy ([D13](#d13-production-compute-on-a-single-ec2-host), which supersedes the original ECS on Fargate behind an Application Load Balancer), ECR for images, RDS in private subnets, S3 for objects, Secrets Manager, IAM least privilege, CloudWatch, and Budgets. See [AWS infrastructure](../rules/aws-infrastructure.md) and [Deployment and operations](../rules/deployment-and-operations.md).
- **Why:** Colyseus needs long-running processes and WebSocket connections, which a container host supports and Lambda does not suit. One cloud provider also hosts the database and the AI service.
- **Alternatives:** A managed PaaS; ECS on Fargate behind an ALB (the original design, superseded by D13 for cost); see D13 for the full comparison.
- **Trade-off:** The EC2 host and RDS have continuous cost even at low traffic, so a budget and cleanup ownership are required; D13 lists the availability and operations costs of the single host.
- **Infrastructure as code:** Terraform defines the AWS resources, with remote state in S3 and reviewed plans; see [Infrastructure as code](../rules/infrastructure-as-code.md). AWS CDK in TypeScript was the main alternative: it shares the application language but relies on CloudFormation, whose failed rollbacks can block deployments. Terraform was chosen for its explicit plan, its industry adoption, and state the team controls, at the cost of learning HCL and operating the state backend.
- **Decided and approved by Agustin on 2026-11-02:** repository layout ([D3](#d3-repository-layout)), contract distribution ([D4](#d4-contract-distribution)), AWS region ([D5](#d5-aws-region)), and pipeline authentication ([D6](#d6-pipeline-authentication-to-aws)); see [API contracts](../rules/api-contracts.md). Production compute was decided later, on 2026-11-05 ([D13](#d13-production-compute-on-a-single-ec2-host)).
- **Open:** Domain and DNS name (Let's Encrypt needs one), and the Amazon Bedrock model with in-Region inference in `us-east-2` (see D5).

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
- **Update 2026-11-09 (join credential transport, approved by Agustin):** the client sets `client.auth.token` (Colyseus SDK), which is sent as `Authorization: Bearer <access token>` on the matchmake HTTP request and reaches `static onAuth(token, options, context)`; join options carry only `classroomId`. Rationale: it is the framework-native path (Colyseus docs, auth/room), it has the same Bearer shape as REST, it keeps credentials out of room options (lower log exposure), and the token never travels in URLs. Alternative rejected: access token in the join options, for those reasons. The internal call is `POST /internal/realtime/join-verification` with the `x-internal-service-secret` header and fails closed.

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
- **Outcome:** `us-east-2` (US East, Ohio).
- **Rationale:** The product is sold in Argentina and realtime latency matters.
- **Alternatives:** `us-east-1`, cheaper and with the widest Amazon Bedrock model availability, but with higher latency from Argentina (rejected because realtime responsiveness matters for the target market).
- **Trade-off:** Higher cost is accepted.
- **Affected contracts:** [AWS infrastructure](../rules/aws-infrastructure.md), [Infrastructure as code](../rules/infrastructure-as-code.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Update (2026-11-04):** The AWS account was created with the "Sign up for AWS (new)" experience, which assigns the project Region by contact country (Argentina: `us-east-2`) and denies every other Region through AWS-managed service control policies; the Region cannot be changed ([AWS documentation](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html)). The previous choice of `sa-east-1` and its latency rationale are superseded. Latency from Argentina is higher; this is an accepted trade-off. Approved by Agustin on 2026-11-04.
- **Update (2026-11-05):** Verified in the [AWS documentation of services supported on the new sign-up plan](https://docs.aws.amazon.com/accounts/latest/reference/supported-services-sign-up-new.md): Amazon Bedrock is available on the Free plan, but global and geographic cross-Region inference are not supported on it. The bot **MUST** therefore use a model with in-Region on-demand inference in `us-east-2`.
- **Open:** Which model offers in-Region on-demand inference in `us-east-2` **MUST** be checked in the console before choosing the bot model.

### D6. Pipeline authentication to AWS

- **Question:** How does the GitHub Actions pipeline authenticate to AWS?
- **Outcome:** GitHub Actions OIDC federation to an IAM role; no long-lived access keys.
- **Rationale:** Short-lived credentials leave no stored keys to leak or rotate.
- **Alternatives:** IAM user access keys in GitHub Secrets, rejected.
- **Affected contracts:** [AWS infrastructure](../rules/aws-infrastructure.md), [Infrastructure as code](../rules/infrastructure-as-code.md), [Deployment and operations](../rules/deployment-and-operations.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Implementation:** The role `aula-virtual-prod-github-actions` trusts only workflows on the `main` branch of this repository (exact `sub` match, audience `sts.amazonaws.com`) and starts with least-privilege access to the prod state. A read-only role for pull request plans is deferred. See [infra/README.md](../infra/README.md#github-actions-oidc-role). Trust scope approved by Agustin on 2026-11-03.
- **Update (2026-11-04):** In the current AWS account, an AWS-managed service control policy denies `iam:CreateOpenIDConnectProvider`, so the OIDC provider cannot be created. The provider, role, and policy stay in code behind the variable `enable_github_oidc` (default `false`). Until it is enabled, Terraform is applied locally with short-lived credentials from `aws login`; no long-lived access keys exist anywhere. Pipeline deployment through OIDC is deferred until the account's advanced features are activated ([AWS documentation](https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html); this requires a paid plan, removes the spend limit, and is irreversible), after which the variable is set to `true`. Approved by Agustin on 2026-11-04.

### D7. Invitation model

- **Question:** RN-02, RF-AUL-002, and HU-AUL-002 allow joining by email invitation or by a shareable code/link, while [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md) and [Data](../rules/data.md) allowed only single-use email invitations. Which mechanisms are valid?
- **Outcome (option B):** two mechanisms.
  1. **Email invitation** (rules unchanged): bound to one target (school or classroom), one role, and one email address; hashed secret, expiry, revocable, single use. It is mandatory for teachers invited by Owner or Admin and for parent/tutor invitations (parents are always invited by email, single use).
  2. **Classroom join code:** per classroom, shareable by the teacher (Owner or Admin **MAY** also manage it). It grants only the `Student` role in that classroom, never Teacher, Parent, or a school role. The secret is stored hashed and shown once on creation or regeneration (regenerating shows a new code and invalidates the previous one). It has an expiry, can be revoked or regenerated, and has an optional maximum number of uses with a use counter. Acceptance requires an authenticated account. Membership creation is atomic and idempotent: an already-enrolled student is not enrolled twice and does not consume a use. Attempts are rate-limited against brute force, the code has enough entropy for that, and every join is recorded (who and when) for audit.
- **Rationale:** Loading 30 emails one by one blocks classroom onboarding, and a shareable code (as in Google Classroom) is the norm in schools. The risk of a leaked code is bounded by the Student-only role, expiry, revocation, maximum uses, rate limiting, and authenticated joins.
- **Alternatives:** Email single-use only (A), rejected because of onboarding friction; an unrestricted permanent link, rejected because it has no expiry or revocation.
- **Affected contracts:** The invitation data model (target email is required for email invitations; the join code has no target email), membership endpoints, HU-AUL-002, RN-02, RF-AUL-002, [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md), and [Data](../rules/data.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.
- **Outcome update (2026-11-05, issue #14):** Decided as a single `Invitation` entity with a `kind` discriminator (`email` vs `join_code`), paired with a child `JoinCodeUsage` table to record each join code redemption (who and when). Database-level CHECK constraints enforce valid targets and max uses.

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

### D9. Contract-first stubs and mocking

- **Question:** How can the frontend build screens before the backend implements an endpoint, without drifting from the real contract?
- **Outcome:** This repository publishes each endpoint's DTOs and OpenAPI entry (a stub returning `501` is allowed) in a pull request before or together with its implementation. The committed `openapi.json` ([D8](#d8-committed-rest-and-realtime-contract-artifacts)) carries it, and the frontend builds its mock handlers from that contract (FD9).
- **Rationale:** The frontend and backend work in parallel from one authoritative contract, and contract changes stay visible in pull requests.
- **Alternatives:** The frontend waits for backend merges (rejected: serializes the teams); hand-written mocks without a contract (rejected: drift).
- **Trade-off:** Contract authoring moves to the start of each endpoint, and stubs **MUST** be replaced by the implementation before the endpoint is considered done.
- **Affected contracts:** [API contracts](../rules/api-contracts.md), D8, and the frontend decision FD9 in its repository's `docs/technical-justification.md`.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D10. Deadline time zone

- **Question:** In which time zone are activity deadlines stored, evaluated, and shown?
- **Outcome:** Timestamps are stored in UTC and the API returns ISO 8601 UTC instants. Each School has a persisted IANA time zone, defaulting to `America/Argentina/Buenos_Aires`; independent teachers' classrooms use the same default. The frontend displays deadlines in the school's time zone and indicates the zone (FD11). The server decides lateness using UTC.
- **Rationale:** Students and teachers of one school see the same deadline time, and server-side evaluation on UTC instants is unambiguous. This replaces the earlier reading that dates are "stored" in the Buenos Aires zone.
- **Alternatives:** Display in each viewer's browser time zone (rejected: students and teachers could see different deadline times).
- **Affected contracts:** [Data and time](../rules/data-and-time.md), [Data](../rules/data.md) (School entity), [Activities and grading](../rules/activities-and-grading.md), and the frontend decision FD11. The daily briefing keeps its own fixed `America/Argentina/Buenos_Aires` policy.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D11. Auto-graded multiple choice scope

- **Question:** Is automatic grading of multiple-choice questions part of MVP Core or MVP Extendido?
- **Outcome:** Multiple-choice questions inside activities and exams are evaluated server-side and graded automatically; this is **MVP Core** (RF-ACT-001, RF-ACT-003). Optional self-assessed practice quizzes, meaning ungraded quizzes for self-study, remain **MVP Extendido**.
- **Rationale:** The core academic path (publish, submit, grade, award points) needs exam grading that does not depend on manual correction, and the requirements already place multiple choice in the core. The ungraded practice quiz is a separate, optional feature.
- **Alternatives:** Treating all quizzes as MVP Extendido (rejected: contradicts RF-ACT-001 and RF-ACT-003 and leaves exams without automatic grading).
- **Trade-off:** The core carries the answer-key storage, hiding, and grading logic; the number of attempts and partial credit stay open.
- **Affected contracts:** [Activities and grading](../rules/activities-and-grading.md), the requirements document (`docs/functional-requirements.md`, section 1.3), and the frontend decision FD12 in its repository's `docs/technical-justification.md`.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D12. Classroom member directory

- **Question:** How does a client list the members of a classroom (for example for @mention autocomplete) without exposing personal data?
- **Outcome:** `GET /classrooms/:id/members` is readable by every member of the classroom, teacher and students. It returns only the user id, display name, classroom role (Teacher or Student), and avatar summary. It **MUST NOT** return emails, parent links, grades, points, or other personal data, and parent or tutor accounts are not listed. A non-member receives `404` (uniform policy). The response is paginated and accepts an optional `q` case-insensitive display-name prefix filter. Tracked in backend issue #52 and consumed by frontend issue #51 (chat mention autocomplete).
- **Rationale:** Mention autocomplete needs a roster that every member can read, and a minimal projection keeps minors' data inside the classroom boundary.
- **Alternatives:** Restricting the roster to teachers (rejected: students cannot autocomplete mentions); returning full user records (rejected: exposes personal data); resolving mentions client-side without a roster (rejected: the server resolves mentions and the client needs suggestions).
- **Trade-off:** Every member can see the classroom's display names, roles, and avatars; the page size and the maximum `q` length are set in the contract.
- **Affected contracts:** [Classrooms, roles, and permissions](../rules/classrooms-and-roles.md), [Communication and notifications](../rules/communication-and-notifications.md), [API contracts](../rules/api-contracts.md), and the frontend decision FD12.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-02.

### D13. Production compute on a single EC2 host

- **Question:** Where do NestJS and Colyseus run in production, given that the AWS account uses the credit-based Free plan?
- **Outcome:** One EC2 host replaces ECS on Fargate, the Application Load Balancer, and the NAT gateway. RDS PostgreSQL stays a separate managed database. Target design:
  1. **Network:** a VPC in `us-east-2` with one public subnet for the host and private subnets in at least two Availability Zones for the RDS DB subnet group. No NAT gateway, no load balancer, no ACM.
  2. **Host:** `t3.small` (x86_64, Free-plan eligible), Amazon Linux 2023, encrypted gp3 volume, IMDSv2 required, and an Elastic IP (a public IPv4 address has an hourly charge).
  3. **Runtime:** Docker Compose with `caddy`, `api` (NestJS), and `realtime` (Colyseus). Caddy is the only public entry: automatic Let's Encrypt TLS, HTTP to HTTPS redirect, API paths to NestJS, and the reserved path or host to Colyseus with WebSocket upgrade. The internal NestJS and Colyseus channel stays on the private Docker network and is not routed.
  4. **Access:** host security group inbound 443 and 80 only; no SSH (administration through SSM Session Manager); RDS inbound 5432 only from the host security group. The instance profile grants least privilege: ECR pull, specific Secrets Manager secrets, CloudWatch Logs, SSM, and Bedrock later. Secrets are read from Secrets Manager on the host at deploy or start and injected as container environment variables.
  5. **Operations:** containers log with the Docker `awslogs` driver to CloudWatch with explicit retention; alarms cover EC2 status checks, CPU, container health, and RDS; AWS Budgets stays.
  6. **Deploy:** the keyless pipeline (CodePipeline, CodeBuild, CodeConnections; backend issue #58) has CodeBuild push immutable-tagged images to ECR, then an SSM Run Command stage pulls them and runs `docker compose up -d`, followed by a health check.
- **Rationale:** The account uses the credit-based Free plan (`us-east-2` only; the account closes after 6 months or when credits run out). An ALB, two Fargate services, and a NAT gateway are fixed hourly costs (roughly USD 60 to 100 per month with RDS, an unverified estimate) that would exhaust the credits in about 2 to 3 months. A single `t3.small` costs roughly USD 10 to 15 per month plus RDS.
- **Alternatives:**
  1. ECS on Fargate behind an ALB (the previous design): managed, scalable, and health-checked, but the fixed cost is too high for the credits.
  2. API Gateway in front of the API: rejected. Its WebSocket API terminates connections and invokes per-message integrations, so it cannot proxy Colyseus' persistent WebSocket to its own server (rooms live in process memory); it has connection limits (2 hours maximum, 10 minutes idle) and per-message pricing, and it would still need a second HTTPS entry for Colyseus.
  3. PostgreSQL in a container on the same host: rejected. RDS stays for managed backups and point-in-time recovery, survival of host failure, and a clear fit with course requirement R4 (cloud-hosted database).
- **Trade-off:** The host is a single point of failure for the API and realtime. The team patches the OS and Docker itself, and scaling is vertical only. Colyseus multi-instance scaling stays open (gap 22). Recovery is to re-provision the host from Terraform and redeploy; data is protected by RDS automated backups.
- **Affected contracts:** [AWS infrastructure](../rules/aws-infrastructure.md), [Infrastructure as code](../rules/infrastructure-as-code.md), [Realtime and presence](../rules/realtime-and-presence.md), [Architecture](../rules/architecture.md), and the deployment sections of the project document. Supersedes the compute and public-entry parts of section 5.
- **Approval:** Approved by Agustin (decision owner) on 2026-11-05.
- **Open:** Domain and routing. Path versus host routing for Colyseus remains open (gap 20). Let's Encrypt needs a DNS name that points to the Elastic IP; a free wildcard DNS name (for example sslip.io) is a candidate interim option, not decided.

### D14. Realtime presence and movement policy

- **Question:** Which tick rate, duplicate-connection policy, access-change propagation, reconnection window, and message contract does the live classroom use (issue #25, gaps 3 to 5)?
- **Outcome:**
  1. **Movement:** clients send direction intents; the server simulates at 20 Hz with a fixed speed and collision checks and patches state at 20 Hz; the frontend interpolates; no client prediction for now. Each connection is limited to 30 messages per second and the excess is dropped silently.
  2. **Duplicate connections:** one avatar per user shared by up to 3 simultaneous connections; the last input wins; the user appears once; the avatar is removed when the last connection leaves; connected time counts the union of the intervals. A 4th connection is closed with `4002`.
  3. **Access changes:** NestJS writes an outbox event on membership removal and on logout or session revocation; its handler calls an internal Colyseus endpoint (same `x-internal-service-secret` scheme, not routed by the proxy) that closes the user's connections with `4001` and blocks reconnection. No periodic polling.
  4. **Reconnection:** a 20 second window (configurable) through `allowReconnection`; the avatar stays with `status: 'reconnecting'`; reconnection re-verifies access with NestJS; the client backs off 1, 2, 4, and 8 seconds and then offers a manual "Reconnect"; disconnected seconds are not counted as connected time. Nothing resumes (input, status, time) until the re-verification succeeds; a definitive denial closes with `4001` and a verification that could not complete closes with `4100` so the client can retry.
  5. **Contracts:** `avatar:input` `{ x, z }` in `[-1, 1]` (zero stops); state `avatars` keyed by `userId` with `Avatar { userId, displayName, role, x, z, rotation, status }`; close codes `4001` (access revoked), `4002` (too many connections), and `4100` (verification unavailable, retryable).
- **Rationale:** Server-side intents and a fixed step keep movement authoritative and cheap to validate; a shared avatar avoids ghost duplicates when a user opens several screens; an outbox event is already the project's way to announce a committed change, so eviction needs no new infrastructure and survives a transient failure through retries; a short reconnection window covers network switches without keeping avatars alive for long.
- **Alternatives:** Client-authoritative positions or client prediction (more complex, easier to cheat); one avatar per connection (duplicates in the presence list); periodic re-verification of every connection (load, delay); a longer reconnection window.
- **Trade-off:** The close codes `4001` and `4002` are also used by Colyseus (server shutdown and protocol errors), so clients read the close reason too; `4100` was chosen because it is outside every Colyseus code (`4000` to `4003`, `4010`). Reconnection re-verifies with the verified user and session identifiers through a second internal endpoint, because the access token may have expired. Connected time is reported once per presence session and is not retried, so it can undercount after a failure. Evictions have their own outbox budget (12 attempts, about 2.8 hours) and a permanent failure is logged at error level, but there is no periodic fallback (decision 3): after a longer API-to-realtime outage a revoked connection can stay open until it drops, and its reconnection is re-verified. This is the accepted residual risk.
- **Affected contracts:** [Realtime and presence](../rules/realtime-and-presence.md), [API contracts](../rules/api-contracts.md#realtime-contract), [Architecture](../rules/architecture.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-10. The walkable surface (a 16 by 12 classroom with 13 obstacle boxes, shared in `packages/contracts`) is a temporary fixed layout for every classroom; per-classroom layout generation is open and tracked in issue #79.

### D15. Activity publishing defaults

- **Question:** How are activities deleted and edited, and which defaults and limits apply to creating and publishing them (RF-ACT-001)?
- **Outcome:**
  1. **Deletion:** always logical (`deletedAt`, RN-18); a row is never physically removed, so history survives submissions and grades.
  2. **Questions and options:** editable until the first submission exists. Submissions do not exist yet, so they are always editable; issue #30 must add the lock (`409`).
  3. **Defaults:** title 1-120 characters; description at most 5000; multiple choice has 1-50 questions of 2-6 options with exactly one correct; `weightMultiplier` 0.5-3 defaulting to 1; an exam has an optional `opensAt` and a required `dueAt`, a TP has only `dueAt`; a single attempt; the whole classroom is the audience.
  4. **Out of scope:** study material upload (#46) and the realtime `activity:published` emission (transport open).
- **Rationale:** Logical deletion satisfies "do not delete activities with submissions or grades" now and later without a special case; the freeze-on-first-answer rule keeps teacher fixes possible until students answer, without changing answers already given.
- **Alternatives:** Physical deletion when no submissions exist (rejected: two deletion paths and a race with the first submission); freezing questions at publish (rejected: blocks fixing typos after publishing).
- **Trade-off:** A published activity can still be edited and cannot be unpublished. The questions lock was added with #30 ([D16](#d16-file-submission-defaults)).
- **Affected contracts:** [Activities and grading](../rules/activities-and-grading.md), [Data](../rules/data.md), [Data and time](../rules/data-and-time.md), [Communication and notifications](../rules/communication-and-notifications.md), and the [activities guide](activities.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-13.

### D16. File submission defaults

- **Question:** How do students submit files to an activity (RF-ACT-001, HU-ACT-003, issue #30): how many submissions, which files, how they are uploaded, what happens after the deadline, how retries are handled and what freezes once someone submitted?
- **Outcome:**
  1. **One submission per (activity, student)** in the MVP, with no resubmission or history.
  2. **Files:** content-detected allow-list of PDF, PNG, JPEG and DOCX (the client MIME type is not trusted), at most 10 MB each, 1 to 5 files, name at most 255 characters. Malware scanning is out of scope.
  3. **Upload:** multipart through the API, not a presigned PUT, so the server validates the real bytes. Objects are private, and reads return short-lived signed URLs (`STORAGE_SIGNED_URL_TTL`).
  4. **Late policy:** the server clock decides. After `dueAt` with `allowLate = false` the submission is rejected; with `allowLate = true` it is stored with `isLate = true`. Before `opensAt` it is rejected.
  5. **Idempotency:** the `Idempotency-Key` header is required. The same key returns the stored submission (`200`), a different key after a submission exists is `409`, and a race is resolved by the unique index.
  6. **Conflicts:** rule violations are `409` with the reason in `details` through `RequestConflictException`, so the envelope message stays fixed.
  7. **Shared lock:** submitting takes `FOR SHARE` on the activity row; teacher update, publish and deactivate take `FOR UPDATE`. Once any submission exists, question edits and deletion are `409`.
  8. **Event:** a timely submission records the outbox event `submission.submitted-on-time` (payload version 1) in the same transaction. A no-op handler acknowledges it until the streak engine (HU-GAM-002), which must backfill from `submissions`.
- **Rationale:** Validating bytes on the server is the only way to enforce the allow-list; a single submission keeps the grading model simple and matches the single-attempt default of D15; a deadline decided on the server clock cannot be bypassed by the client; a client-generated key makes network retries safe; a shared lock lets a deadline rush proceed in parallel while still freezing teacher edits; the dispatcher treats an event without a handler as a failure, so a no-op handler avoids five failed attempts and error logs per submission.
- **Alternatives:** Presigned PUT directly to S3 (rejected: the server would see the bytes only afterwards, so an invalid file would already be stored); an exclusive row lock on submit (rejected: all students of one activity serialize and a rush exceeds the transaction timeout); `422` or `403` for window violations (rejected: `409` with details is the project's conflict shape); recording no event until HU-GAM-002 (rejected: earlier submissions would be missing from the streak history).
- **Trade-off:** Files pass through API memory (at most 5 x 10 MB per request). Resubmission and history are not possible yet. More than 5 files returns multer's generic `400`. A connection lost after the commit can make the error path delete the objects of a stored submission (accepted edge case). Events recorded before HU-GAM-002 are acknowledged without effect and cannot be replayed, so that story backfills from `submissions`.
- **Affected contracts:** [Activities and grading](../rules/activities-and-grading.md), [Data](../rules/data.md), [Data and time](../rules/data-and-time.md), the [activities guide](activities.md) and the [submissions guide](submissions.md).
- **Approval:** Approved by Agustin (decision owner) on 2026-11-13.

## 8. Known conflicts and notes

- The [derived design views](./diagrams/README.md) are proposed design aligned with the school model. Where they differ, the domain rules prevail; they are not competing requirements.
- The requirements state that dates are "stored" in the Buenos Aires zone; [D10](#d10-deadline-time-zone) decides UTC storage with presentation in the school's time zone, so the requirements wording is superseded for storage.
