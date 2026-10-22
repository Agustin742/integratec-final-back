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

- [Course requirements and evaluation](./project-requirements.md) — academic minimums, recommendations, documentation, milestones, and evaluation criteria.
- [Git and GitHub workflow](./git-workflow.md) — branches, English Conventional Commits, pull requests, reviews, and merges.
- [Code quality and testing](./quality-and-testing.md) — English code, verification, and definition of done.
- [Security](./security.md) — secrets, permissions, validation, and frontend/backend boundaries.
- [Responsible AI usage](./ai-usage.md) — human verification, privacy, and declaration of use.

## How to use the rules

Read the relevant rules before designing, implementing, modifying, or reviewing a part of the project. Apply them consistently regardless of whether the work is performed manually or with an AI coding assistant.

When a rule needs to change, update its source document explicitly rather than silently deviating in code.

## Document template

[`example.md`](./example.md) is a **neutral writing template**. Its headings and placeholders show a possible format only: they do not establish any technical, visual, or architectural rule. Adapt or omit sections to fit each subject.
