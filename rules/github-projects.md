# GitHub Projects and Work Coordination

GitHub Projects coordinates planned and active work. This rule defines team responsibilities, not a particular board configuration.

## Sources of truth

| Location | Responsibility |
|---|---|
| GitHub Projects | Current work status, ownership, and planning |
| Issue | Problem, scope, acceptance criteria, and discussion |
| Pull request | Proposed changes, review, and verification evidence |
| Contributor tracker | Brief work context and handoffs |
| Git history | Actual committed changes |

- Contributors **MUST** link related records rather than copy their full descriptions into every location.
- Existing [tracker responsibilities](../changelogs/README.md) remain applicable; a board update does not replace a required tracker update.

## Work items and ownership

- Meaningful work **MUST** have a Project item with a clear objective, scope, acceptance criteria, and an accountable contributor before implementation.
- Draft items **MAY** capture early ideas. Before code work begins, the item **SHOULD** reference an issue in the responsible repository.
- Cross-repository work **MUST** identify frontend/backend dependencies and link the relevant issues without implying that one repository's merge completes both.
- Contributors **MUST** check ownership and dependencies before starting. Parallel changes to the same area **MUST** be coordinated.
- Priority **SHOULD** reflect MVP impact and dependencies. Dates **MUST NOT** be invented to fill optional fields.

## Status and completion

- Contributors **MUST** use the board's agreed fields and status meanings. This document does not claim that specific columns or automations exist.
- Work **MUST NOT** be marked active merely because it is assigned, or completed merely because a PR was opened.
- Blocked work **MUST** record the blocker, its dependency or decision owner, and the next action; use the board's existing mechanism or an issue comment.
- Completion **MUST** satisfy acceptance criteria and the [definition of done](./quality-and-testing.md#definition-of-done). Partial delivery **MUST** leave remaining scope visible.
- A merge **MUST NOT** be described as a verified deployment without deployment evidence.
- Automations **MUST** be checked against their actual configuration before relying on them. Contributors **MUST** correct stale or misleading status.

## Verification

For a completed item, a reviewer **MUST** be able to find its owner, acceptance criteria, related PRs or non-code deliverable, and verification evidence. Branch and review policy belongs to [Git workflow](./git-workflow.md), not this document.
