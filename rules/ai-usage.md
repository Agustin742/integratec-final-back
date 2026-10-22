# Responsible AI Usage

AI may assist development, but contributors remain responsible for understanding, checking, and explaining every delivered change.

## Human responsibility

- Contributors **MUST** review AI-generated code and documentation before including them in the project.
- Each contributor **MUST** understand their contributions and prepare to explain the application's code and decisions during the individual defense.
- AI output **MUST NOT** establish product scope, architecture, or technology decisions without team agreement.
- Claims about tests, files, deployment, or behavior **MUST** be supported by observed evidence. Generated claims are not verification.
- AI-assisted changes **MUST** follow the same [quality](./quality-and-testing.md), [security](./security.md), and [Git](./git-workflow.md) rules as human-written changes.

## Data handling

- Contributors **MUST NOT** submit API keys, passwords, connection strings, private tokens, or real personal data to AI tools.
- Examples **MUST** use synthetic or appropriately anonymized data.
- Prompts and AI outputs **MUST** be checked for accidental sensitive information before sharing them.

## Declaration of use

The repository **MUST** include an AI usage declaration for the course submission. Contributors **MUST** retain concise, non-sensitive evidence while working so the declaration can describe:

- Tools used and the tasks they supported.
- One successful case and why it helped.
- One case that required correction, how the problem was detected, and how it was resolved.
- Human verification of the resulting work.

The planned deliverable is `docs/ai-usage.md`; this rule does not claim that file already exists. The declaration records actual experience, not invented examples.

## AI in the product

The [course requirements](./project-requirements.md#mandatory-ai-process-declaration), extracted from section 7 of the course brief, require documenting AI use in the development process; a model-powered product feature is recommended, not mandatory for the course. Product-specific commitments remain separate.

If an AI feature is implemented, model API credentials **MUST** remain in the backend. Model output **MUST NOT** bypass authorization or input validation. The integration **MUST** handle provider failures and enforce usage limits; users **MUST** receive clear feedback when it is unavailable.
