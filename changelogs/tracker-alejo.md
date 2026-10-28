# Tracker — Alejo

## 2026-10-28 — Reconcile PR #6 with merged domain rules

- **Status:** in-progress
- **Area / files:** `docs/diagrams/`, `master-document.md`, `docs/requirements-decision.md`, `rules/data-and-time.md`, `README.md`
- **Change:** Bringing merged PR #5 from `develop` into the PR #6 feature branch, preserving Agustin's domain rules and contributor history. Reconciliation will follow his timezone/authorization policies, promote already-mandatory constraints out of proposal status, and link the rules and technical justification without duplicating them.
- **Reason:** PR #6 was prepared before those rules were merged; its examples and source references must match the current baseline.
- **Next step:** Finish source/diagram reconciliation, verify, and update PR #6. No PR merge or closure is authorized.

## 2026-10-28 — Align diagrams and documentation with the functional baseline

- **Status:** completed
- **Area / files:** `docs/diagrams/`, `master-document.md`, `rules/documentation-and-decisions.md`, `rules/data-and-time.md`, `docs/requirements-decision.md`, `README.md`
- **Change:** Aligned sources and diagrams with Luis's ERS and Alejo's confirmed Three.js/R3F, product-wide Buenos Aires timezone and non-transferable ownership decisions, with AI assistance. Updated office/room model, scoped roles/access, collaborative tasks, configurable columns, chat channels, attendance, read-only bot and lifecycle flows. Preserved the original PR #4 commits in local branch ancestry; split corrections into reviewable dependent branches. Five CI-tooling tests, Markdown links and correction-diff whitespace pass; structural readback covers 24 Mermaid blocks and nine alignment assertions. Visual Mermaid rendering/grammar and actionlint were unavailable, not passed.
- **Reason:** Diagram corrections need a consistent functional and technical baseline without treating planned architecture as implemented behavior.
- **Next step:** Publish one PR from `docs/diagram-alignment-04-handoff` to `develop`, as authorized by Alejo; retain the local slices only as review aids. See `docs/diagrams/review-guide.md` for commits and evidence. Existing CI triggers apply to the single PR. No merge is authorized; Alejo closes PR #4 himself. ERS assumptions such as office replacement after permanent deletion remain open. Application implementation is out of scope.
