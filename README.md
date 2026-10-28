# Backend

This repository currently contains project documentation and CI tooling; no backend application package or application tests are configured.

## Documentation

The [master document](./master-document.md) records product scope and technology choices; the [functional requirements (ERS)](./docs/functional-requirements.md) define functional behavior and permissions. [Requirements decisions](./docs/requirements-decision.md) record confirmed clarifications, and [rules](./rules/README.md) govern engineering constraints.

Design diagrams (use cases, architecture, realtime, data model, classes, and sequences) live in [`docs/diagrams/`](./docs/diagrams/README.md). Mermaid is their editable source format, not authority over requirements or approved decisions. Diagram alignment is in progress; technical proposals are not implemented or approved contracts merely because they appear in a diagram.

## Repository flow

Changes are promoted through pull requests: `develop` → `test` → `main`. CI accepts only `develop` as the source for `test` and `test` as the source for `main`.

## CI

The [`checks` GitHub Actions job](./.github/workflows/ci.yml) runs for pull requests into `develop`, `test`, or `main` and pushes to `develop`. It checks tracked Markdown inline internal links and ATX heading anchors, runs CI-tooling regression tests, checks proposed diff whitespace against the event base, and validates the workflow with actionlint 1.7.7. External links and code examples are excluded from link checking.

Local documentation and tooling checks (Python 3 and Git required):

```bash
PYTHONDONTWRITEBYTECODE=1 python scripts/ci/check_docs.py
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover -s scripts/ci -p 'test_*.py' -v
git diff --check
```

The local whitespace command checks uncommitted changes; CI checks the proposed committed diff against the PR base or push's previous SHA. Workflow validation also requires actionlint 1.7.7: `actionlint .github/workflows/ci.yml`.

When a `package.json` is present, CI requires `pnpm-lock.yaml`, sets up Node.js 22, installs with `pnpm install --frozen-lockfile`, and runs `pnpm test` when a test script exists. Otherwise, it explicitly reports that no **application** tests were configured or run in both a GitHub notice and the job summary. CI-tooling tests are separate; planned application checks and deployment are not evidence of a running backend.

## Shared contracts

Ownership of shared contracts across the frontend and backend repositories remains undecided.
