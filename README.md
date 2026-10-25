# Backend

This repository currently contains project documentation only; no backend package or tests are configured.

## Documentation

Design diagrams (use cases, architecture, realtime, data model, classes, and sequences) live in [`docs/diagrams/`](./docs/diagrams/README.md). They are written in Mermaid, which is the single source of truth.

## Repository flow

Changes are promoted through pull requests: `develop` → `test` → `main`. CI accepts only `develop` as the source for `test` and `test` as the source for `main`.

## CI

The `checks` GitHub Actions job runs for pull requests into `test` or `main` and pushes to `develop`. When a `package.json` is present, CI requires `pnpm-lock.yaml`, sets up Node.js 22, installs with `pnpm install --frozen-lockfile`, and runs `pnpm test` when a test script exists. Otherwise, it reports that no tests were configured or run in both a GitHub notice and the job summary.

## Shared contracts

Ownership of shared contracts across the frontend and backend repositories remains undecided.
