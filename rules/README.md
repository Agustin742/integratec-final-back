# Project Rules

This directory contains the project's **permanent rules and conventions**. Its documents establish consistent expectations for design, technology usage, architecture, module responsibilities, and development practices.

Rules describe **how the project must be designed and built**. They are not implementation tasks, step-by-step tutorials, feature backlogs, or work plans.

## Relationship to the project document

- The main project document defines the product's overall scope, capabilities, and technology choices.
- The files in `rules/` define the standards and constraints that govern those choices.
- The implementation must follow both. A rule must not silently override the main project document.
- The [course requirements](./project-requirements.md) preserve academic requirements and evaluation criteria extracted from the temporary course brief; they do not depend on retaining its PDF. Section 10 of the [project document](../master-document.md#10-cumplimiento-del-enunciado-integrartec-2026) maps them to the product; do not duplicate that checklist here.
- Proposed product or technology choices require explicit team agreement before they become implementation constraints. Conflicts with the official brief must be resolved explicitly, not silently reinterpreted.

## Writing criteria

- **Write every rule in English**, including headings, explanations, and examples.
- Use English filenames for project documents and source files; use lowercase hyphen-separated names for rule documents, such as `git-workflow.md`. Keep personal names and standard filenames such as `README.md` unchanged.
- Use clear, direct, unambiguous language.
- Use **MUST** and **MUST NOT** for mandatory requirements and prohibitions; use **SHOULD** for preferred practices and **MAY** for permitted alternatives.
- Write reusable rules applicable across the project, not instructions for a specific task.
- Define responsibilities, boundaries, conventions, and restrictions only where relevant to the rule's subject.
- Explain important constraints when the rationale helps prevent misuse.
- Avoid restating the same rule in multiple files; link to its authoritative document when necessary.
- Do not introduce technologies, features, or decisions that conflict with the main project document.
- Use examples only to clarify a rule, not to introduce requirements by accident.
- Keep documents current when the underlying contract changes.

## Rule index

### Foundation and course policies

- [Course requirements and evaluation](./project-requirements.md) — academic minimums, recommendations, documentation, milestones, and evaluation criteria.
- [Git and GitHub workflow](./git-workflow.md) — branches, English Conventional Commits, pull requests, reviews, and merges.
- [Code quality and testing](./quality-and-testing.md) — English code, verification, and definition of done.
- [Security](./security.md) — secrets, permissions, validation, and frontend/backend boundaries.
- [Responsible AI usage](./ai-usage.md) — human verification, privacy, and declaration of use.

### Coordination and decisions

- [GitHub Projects](./github-projects.md) — work ownership, status, issue/PR traceability, and completion evidence without assuming board configuration.
- [Documentation and decisions](./documentation-and-decisions.md) — approved choices, proposals, exceptions, and authoritative sources.

### Architecture and integration

- [Architecture](./architecture.md) — NestJS and Colyseus boundaries, their integration, and module responsibilities.
- [API contracts](./api-contracts.md) — cross-repository ownership, payloads, compatibility, and integration evidence.
- [Data and time](./data-and-time.md) — opaque identity, optional values, dates, time zones, and persistence boundaries.
- [Data](./data.md) — relational entities, constraints, deletion policy, and migration discipline.
- [Realtime and presence](./realtime-and-presence.md) — Colyseus classroom rooms, join authorization, ephemeral state, classroom control broadcasts, and reconnection.

### Domain rules

- [Authentication and session](./authentication-and-session.md) — credentials, hashing, expiring sessions, logout, and `401` versus `403`.
- [Classrooms, roles, and permissions](./classrooms-and-roles.md) — organization paths, roles, school Owner/Admin authority, email invitations, parents, adult mode, and server-side access checks.
- [Activities and grading](./activities-and-grading.md) — TP and exam activities, file and multiple-choice submissions, grades, weighted points, and activity metrics.
- [Points, streak, and shop](./points-and-shop.md) — points ledger, streak on real activity, shop, classroom items, mini-games, pet, and medals.
- [Communication and notifications](./communication-and-notifications.md) — classroom chat, moderation and mute, mentions, announcements, parent messages, and in-app and email notifications.
- [Live classroom tools](./live-classroom-tools.md) — freeze, mute, collaboration lock, calls and presentations, and collaborative whiteboard.
- [AI bot and daily briefing](./ai-bot-and-daily-briefing.md) — Bedrock integration, RAG over approved material, exam block, guide-only rule, once-per-day review, and fallback.

### Operation and reliability

- [AWS infrastructure](./aws-infrastructure.md) — service roles, network isolation, least-privilege identity, and cost control.
- [Infrastructure as code](./infrastructure-as-code.md) — Terraform layout, pinned versions, remote state, secrets, and reviewed plans.
- [Configuration and environments](./configuration-and-environments.md) — configuration validation, secret boundaries, and environment isolation.
- [Deployment and operations](./deployment-and-operations.md) — environment-based configuration, build integrity, and deployment readiness.
- [Error handling and feedback](./error-handling-and-feedback.md) — error reporting, recovery, and sensitive data protection.
- [Observability and privacy](./observability-and-privacy.md) — runtime logging, health indicators, sensitive data redaction, and auditability.

## How to use the rules

Read the relevant rules before designing, implementing, modifying, or reviewing a part of the project. Apply them consistently regardless of whether the work is performed manually or with an AI coding assistant.

When a rule needs to change, update its source document explicitly rather than silently deviating in code.

## Document template

[`example.md`](./example.md) is a **neutral writing template**. Its headings and placeholders show a possible format only: they do not establish any technical, visual, or architectural rule. Adapt or omit sections to fit each subject.
