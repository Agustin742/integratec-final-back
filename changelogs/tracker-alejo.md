# Tracker — Alejo

## 2026-10-28 — Reconcile PR #6 with merged domain rules

- **Status:** completed
- **Area / files:** `docs/diagrams/`, `master-document.md`, `docs/requirements-decision.md`, `rules/data-and-time.md`, `README.md`
- **Change:** Incorporated merged PR #5 into the PR #6 feature branch and reconciled derived views with Agustin's rules. All 25 upstream rule files remain unchanged relative to the new `develop`. Scoped timezone and foreign-resource response decisions follow those rules; mandatory registration, uniqueness and invitation constraints are no longer marked as proposals. Added authoritative links and refreshed stale architecture/justification notes instead of repeating their explanations. Five CI-tooling tests, 55-file Markdown links, full PR whitespace and 11 scoped readback assertions passed; 24 diagram blocks and both contributor histories are preserved. No automated Mermaid render is claimed.
- **Reason:** PR #6 was prepared before those rules were merged; its examples and source references must match the current baseline.
- **Next step:** Publish this reconciliation on the existing PR #6, check its new CI run and update Projects. No new PR, shared-branch merge or PR closure is authorized; review approval remains a human decision.

## 2026-10-28 — Align diagrams and documentation with the functional baseline

- **Status:** completed
- **Area / files:** `docs/diagrams/`, `master-document.md`, `rules/documentation-and-decisions.md`, `rules/data-and-time.md`, `docs/requirements-decision.md`, `README.md`
- **Change:** Aligned sources and diagrams with Luis's ERS and Alejo's confirmed Three.js/R3F, product-wide Buenos Aires timezone and non-transferable ownership decisions, with AI assistance. Updated office/room model, scoped roles/access, collaborative tasks, configurable columns, chat channels, attendance, read-only bot and lifecycle flows. Preserved the original PR #4 commits in local branch ancestry; split corrections into reviewable dependent branches. Five CI-tooling tests, Markdown links and correction-diff whitespace pass; structural readback covers 24 Mermaid blocks and nine alignment assertions. Visual Mermaid rendering/grammar and actionlint were unavailable, not passed.
- **Reason:** Diagram corrections need a consistent functional and technical baseline without treating planned architecture as implemented behavior.
- **Next step:** Publish one PR from `docs/diagram-alignment-04-handoff` to `develop`, as authorized by Alejo; retain the local slices only as review aids. See `docs/diagrams/review-guide.md` for commits and evidence. Existing CI triggers apply to the single PR. No merge is authorized; Alejo closes PR #4 himself. ERS assumptions such as office replacement after permanent deletion remain open. Application implementation is out of scope.
