# Technical Justification (R6)

This document justifies the relevant technical choices of the project: what was chosen, why, which alternatives were considered, and what the choice costs. It develops the summary in [master §11](../master-document.md#11-justificación-arquitectónica-de-alto-nivel) and satisfies course requirement R6. It records decisions already made in the [project document](../master-document.md); it does not introduce new ones. Choices that are still undecided are marked **Open**.

## 1. Stack

| Area | Decision | Why | Alternatives | Trade-off |
|---|---|---|---|---|
| Frontend | React + TypeScript + Vite | Interactive authenticated UI with panels independent of the 3D world | Next.js | SSR is not a central need and is given up |
| 3D world | Three.js with React Three Fiber | A real 3D world with an isometric camera and spatial interactions | PixiJS 2.5D (discarded for aesthetic reasons) | Assets, performance, camera, and collisions must be handled by the team |
| Backend API | NestJS + TypeScript | Modules, validation, and domain authorization in a structured API | Express or Fastify directly | More structure and conventions than a minimal server |
| Language | TypeScript on both sides | One language and shared typing concepts | JavaScript, other backend languages | Compile step and configuration |
| Quality | ESLint, Prettier, Vitest, Playwright, GitHub Actions | Static analysis, formatting, tests, and CI | Other tooling | Ongoing maintenance of the pipeline |

## 2. Authentication and authorization

- **Decision:** NestJS validates credentials with salted Argon2 or bcrypt hashing, manages expiring sessions, and enforces `401` versus `403` on protected endpoints and on realtime joins. Roles are scoped per office (Owner, Administrator, Leader, Member); there is no global administrator. See [Authentication and session](../rules/authentication-and-session.md) and [Rooms and permissions](../rules/rooms-and-permissions.md).
- **Why:** Course requirement R2 demands hashing, expiring sessions, protected resources, two or more roles, and user isolation. Per-office scoping matches the product model and avoids a privileged global role.
- **Alternatives:** An external identity service (master allows "an equivalent identity service"); OAuth or social login (a recommended extra, not planned for the MVP).
- **Trade-off:** Building authentication in the application gives full control and a clear defense story, but the team owns its security.
- **Open:** The session mechanism (cookie session versus token), lifetime, renewal, and revocation are not decided.

## 3. Database and ORM

- **Decision:** Amazon RDS for PostgreSQL accessed with Prisma ORM; Prisma is the access layer, not the database. See [Data](../rules/data.md).
- **Why:** The domain is relational (users, memberships, offices, rooms, tasks, meetings, and messages with strong relationships and constraints), and the course requires related entities. Prisma gives typed queries, parameterized access, and migrations.
- **Alternatives:** MongoDB or other document stores; other ORMs or raw SQL.
- **Trade-off:** Schema changes require disciplined, reviewed migrations. RDS adds a fixed cost.

## 4. Realtime

- **Decision:** Colyseus for room sessions, presence, and avatar movement, deployed separately from NestJS. Colyseus never writes durable data; persistent changes go through NestJS and are announced afterward. See [Architecture](../rules/architecture.md) and [Realtime and presence](../rules/realtime-and-presence.md).
- **Why:** Colyseus provides room lifecycle, synchronized state, and reconnection designed for rooms.
- **Alternatives:** Socket.IO alone, which would require implementing room and state logic; it remains an option only for isolated needs.
- **Trade-off:** One more service to deploy and learn. The MVP runs one Colyseus instance; scaling out needs a presence and routing strategy that is not defined.
- **Open:** The internal transport between NestJS and Colyseus, and the final event names and payloads.

## 5. Deployment

- **Decision:** AWS with Amplify Hosting for the frontend and ECS on Fargate behind an Application Load Balancer for NestJS and Colyseus, ECR for images, RDS in private subnets, S3 for objects, Secrets Manager, IAM least privilege, CloudWatch, and Budgets. See [AWS infrastructure](../rules/aws-infrastructure.md) and [Deployment and operations](../rules/deployment-and-operations.md).
- **Why:** Colyseus needs long-running processes and WebSocket connections, which Fargate supports and Lambda does not suit. One cloud provider also hosts the database and the AI service.
- **Alternatives:** A managed PaaS or EC2.
- **Trade-off:** Fargate, ALB, and RDS have continuous cost even at low traffic, so a budget and cleanup ownership are required.
- **Infrastructure as code:** Terraform defines the AWS resources, with remote state in S3 and reviewed plans; see [Infrastructure as code](../rules/infrastructure-as-code.md). AWS CDK in TypeScript was the main alternative: it shares the application language but relies on CloudFormation, whose failed rollbacks can block deployments. Terraform was chosen for its explicit plan, its industry adoption, and state the team controls, at the cost of learning HCL and operating the state backend.
- **Open:** Contract distribution between the frontend and backend repositories (API contracts) is undecided; see [API contracts](../rules/api-contracts.md). Region, domain, and pipeline authentication are also open.

## 6. Artificial intelligence

- **Decision:** Amazon Bedrock invoked only from NestJS using IAM roles; the bot is read-only in the MVP and the daily briefing is delivered once per user and day in the America/Argentina/Buenos_Aires time zone, with a structured fallback when the provider fails. See [AI bot and daily briefing](../rules/ai-bot-and-daily-briefing.md).
- **Why:** Credentials and authorization stay on the server, the bot inherits the user's permissions, and the read-only scope limits risk in the first delivery. It also covers the recommended AI feature of the course.
- **Alternatives:** Calling a provider from the frontend (discarded for security); a different model provider.
- **Trade-off:** Dependence on AWS availability and inference cost, mitigated by limits and the fallback.
- **Open:** Specific model and numeric usage limits.

## 7. Known conflicts and notes

- The [derived design views](./diagrams/README.md) follow the merged domain rules for office roles, room leadership, and configurable columns. Their fields and contracts remain proposals only where the rules leave them open; they are not competing requirements.
- The requirements state that dates are "stored" in the Buenos Aires zone; the project plans timezone-aware instants presented in that zone, pending confirmation.
