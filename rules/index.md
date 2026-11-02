# Rule Routing Index

This index tells contributors and AI agents **which rules to read for a given task and which to skip**. Read only the rules whose trigger matches the work; reading every rule for every task wastes context and is not required. When a task spans several areas, read every matching rule.

Rule descriptions and writing criteria live in the [rules README](./README.md). Product scope lives in the [project document](../master-document.md).

## How to use

1. Find the task type in [Read by task](#read-by-task) and read the listed rules.
2. Check [Read by touched area](#read-by-touched-area) for every area the change touches and add those rules.
3. Skip any rule whose trigger does not match. Use the **Skip when** column to confirm.
4. If no row matches, or a rule links to another rule for a requirement you need, follow that link instead of reading unrelated rules.

[`example.md`](./example.md) is a writing template, not a rule; read it only when creating a new rule document.

## Read by task

| Task | Read |
|---|---|
| Any change that will be committed | [Git workflow](./git-workflow.md) |
| Code change (feature, fix, refactor, test) | [Quality and testing](./quality-and-testing.md), [Security](./security.md), plus the area rules below |
| Documentation-only change | [Documentation and decisions](./documentation-and-decisions.md); add area rules only if the text states their requirements |
| Recording or changing a technical or product decision | [Documentation and decisions](./documentation-and-decisions.md), plus the rules the decision affects |
| Creating or updating a rule document | [rules README](./README.md), [`example.md`](./example.md) |
| Planning work, creating issues, or updating the board | [GitHub Projects](./github-projects.md) |
| Reviewing a pull request | [Git workflow](./git-workflow.md), [Quality and testing](./quality-and-testing.md), plus the area rules the diff touches |
| Using AI assistance in delivered work | [Responsible AI usage](./ai-usage.md) |
| Checking academic compliance or preparing a milestone | [Course requirements](./project-requirements.md) |

## Read by touched area

| Rule | Read when the work touches | Skip when |
|---|---|---|
| [Architecture](./architecture.md) | Module placement, NestJS/Colyseus boundaries, service-to-service calls, monorepo layout | The change stays inside one existing module and adds no cross-module or cross-service dependency |
| [API contracts](./api-contracts.md) | REST endpoints, DTOs, OpenAPI output, status codes, payloads consumed by the frontend | No request or response shape changes |
| [Data](./data.md) | Prisma schema, migrations, entities, relations, deletion policy | No schema or persistence change |
| [Data and time](./data-and-time.md) | Identifiers, optional values, dates, time zones, serialization | No dates, IDs, or serialized values change |
| [Realtime and presence](./realtime-and-presence.md) | Colyseus rooms, `onAuth`, presence, ephemeral state, reconnection | REST-only or persistence-only work |
| [Authentication and session](./authentication-and-session.md) | Register, login, logout, refresh, tokens, guards, `401`/`403`/`404` responses | Endpoint already protected by an existing guard and auth behavior is unchanged |
| [Classrooms, roles, and permissions](./classrooms-and-roles.md) | Schools, classrooms, memberships, roles, invitations, parent links, any authorization check | No access decision is added or changed |
| [Activities and grading](./activities-and-grading.md) | Activities, questions, submissions, grades, activity metrics | Outside the academic module |
| [Points, streak, and shop](./points-and-shop.md) | Points ledger, streak, shop, classroom items, pet, medals | Outside gamification |
| [Communication and notifications](./communication-and-notifications.md) | Chat, mentions, announcements, parent messages, in-app or email notifications | No messaging or notification behavior |
| [Live classroom tools](./live-classroom-tools.md) | Freeze, mute, collaboration lock, calls, presentations, whiteboard | No live teacher control or collaboration channel |
| [AI bot and daily briefing](./ai-bot-and-daily-briefing.md) | Bedrock calls, RAG, approved material, bot tools, daily review | No bot or AI-provider code |
| [Error handling and feedback](./error-handling-and-feedback.md) | Error responses, exception filters, retries, user-visible failure states | Error behavior is unchanged |
| [Observability and privacy](./observability-and-privacy.md) | Logging, health checks, metrics, audit records, sensitive-data redaction | No logs, metrics, or health output change |
| [Configuration and environments](./configuration-and-environments.md) | Environment variables, config validation, `.env.example`, secrets loading | No configuration is added or read |
| [AWS infrastructure](./aws-infrastructure.md) | AWS services, networking, IAM, region, cost | No cloud resource or permission changes |
| [Infrastructure as code](./infrastructure-as-code.md) | Terraform files, state, plans, provider versions | No Terraform change |
| [Deployment and operations](./deployment-and-operations.md) | CI/CD deploy steps, Docker images, release and rollback, deployment evidence | Local-only or CI-check-only changes |

## Maintenance

Add a row here whenever a rule is added, renamed, or its scope changes, and keep the [rules README](./README.md) list in sync.
