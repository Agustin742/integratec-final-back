# Git and GitHub Workflow

Use short-lived work branches, reviewed pull requests, and traceable commits. This rule governs collaboration, not deployment configuration.

## Branches and promotion

| Branch | Purpose | Pull request source |
|---|---|---|
| `develop` | Integrate reviewed work | Short-lived work branches |
| `test` | Validate an integrated candidate | `develop` only |
| `main` | Stable, validated version | `test` only |

- Contributors **MUST** branch from an up-to-date `develop` and use English names such as `feat/task-board`, `fix/login-error`, or `docs/setup`.
- Changes **MUST** enter shared branches through pull requests, not direct pushes.
- Contributors **MUST NOT** force-push shared branches or rewrite another contributor's history.
- Fixes **MUST** follow the same promotion flow; do not bypass it with a direct fix to `test` or `main`.
- Maintainers **SHOULD** configure branch protection to enforce reviews and applicable checks. This document does not prove that protection is enabled.

## Commits

Every commit message **MUST** follow Conventional Commits and be written in English, including its body and footers when present:

```text
<type>[optional scope][!]: <description>
```

Use a type that describes the change: `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `perf`, `build`, `ci`, or `chore`. A breaking change **MUST** be identified with `!` or a `BREAKING CHANGE:` footer explaining its impact.

```text
feat(tasks): add task creation form
fix(auth): redirect expired sessions to login
docs(rules): document pull request reviews
```

- Commits **MUST** represent coherent work; unrelated changes **SHOULD** be separated.
- Each contributor **MUST** use their own Git identity and contribute real work throughout the project. Do not fabricate activity or commit under another person's identity.
- Contributors **MUST** review the staged diff before committing, including generated files and accidental secrets.
- Code language follows [Quality and testing](./quality-and-testing.md#code-language).

## Pull requests and merges

- A pull request **MUST** explain its purpose, relevant issue when one exists, changes, and verification results, including failed or unavailable checks.
- UI changes **SHOULD** include screenshots or a short recording.
- At least one other team member **MUST** review and approve the current changes before merge. Material changes after approval **MUST** be reviewed again.
- Applicable checks **MUST** pass, and blocking review comments **MUST** be resolved before merge. An absent test suite is not a passed suite.
- The author **SHOULD** resolve conflicts with the affected contributors and **MUST NOT** discard their work without agreement.
- The contributor performing the merge **MUST** confirm the target branch, approvals, checks, and preservation of contributor attribution.
- Promotion pull requests **MUST** use merge commits to preserve branch ancestry. Their merge messages **MUST** follow the commit convention above, for example `chore(release): promote develop to test`.
- Work pull requests **SHOULD** use merge commits. Squash **MAY** be used for a single-author branch when the resulting commit preserves that author's identity and follows the commit convention; multi-author work **MUST NOT** be collapsed into a single-author commit.

## Current automation boundary

[CI](../.github/workflows/ci.yml) checks pull requests into `develop`, `test`, and `main`, and pushes to `develop`. Work branches may target `develop`; promotion pull requests into `test` must come from `develop`, and those into `main` must come from `test`.

The `checks` job validates tracked Markdown inline internal links/ATX heading anchors, runs CI-tooling regression tests, and validates the workflow with actionlint 1.7.7. External links and code examples are excluded from link validation. Whitespace validation uses `git diff --check` against the PR base SHA or push's previous SHA (empty tree for an initial push), not a retroactive document policy or a clean working-tree comparison. Package/lockfile detection and conditional application install/tests remain separate; an absent package or test script is reported, not treated as a passed application suite.

Contributors **MUST** run applicable [local check commands](../README.md#ci) and attach results, including unavailable tools, before merge. These checks do not configure branch protections or prove GitHub execution.

A merge does not by itself prove a deployment occurred. Review participation is recorded in GitHub; work coordination follows the existing [tracker rules](../changelogs/README.md).
