# Tracker — Alejo

## 2026-10-28 — Align diagrams and documentation with the functional baseline

- **Status:** completed
- **Area / files:** `docs/diagrams/`, `master-document.md`, `rules/documentation-and-decisions.md`, `rules/data-and-time.md`, `docs/requirements-decision.md`, `README.md`
- **Change:** Aligned sources and diagrams with Luis's ERS and Alejo's confirmed Three.js/R3F, product-wide Buenos Aires timezone and non-transferable ownership decisions, with AI assistance. Updated office/room model, scoped roles/access, collaborative tasks, configurable columns, chat channels, attendance, read-only bot and lifecycle flows. Preserved the original PR #4 commits in local branch ancestry; split corrections into reviewable dependent branches. Five CI-tooling tests, Markdown links and correction-diff whitespace pass; structural readback covers 24 Mermaid blocks and nine alignment assertions. Visual Mermaid rendering/grammar and actionlint were unavailable, not passed.
- **Reason:** Diagram corrections need a consistent functional and technical baseline without treating planned architecture as implemented behavior.
- **Next step:** Human review and authorization to publish the local chain; see `docs/diagrams/review-guide.md` for commits, parent bases and evidence. No push, new PR publication, shared-branch merge or application implementation occurred. ERS assumptions such as office replacement after permanent deletion remain open; child-branch PR bases are not covered by the current automatic CI triggers.
