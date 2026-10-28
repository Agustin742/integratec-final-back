# Tracker — Agustin

## 2026-10-27 — Add backend domain rules and project docs

- **Status:** completed
- **Area / files:** `rules/` (architecture, authentication-and-session, rooms-and-permissions, tasks-and-productivity, communication-and-meetings, ai-bot-and-daily-briefing, realtime-and-presence, data, aws-infrastructure), `docs/technical-justification.md`, `docs/ai-usage.md`, `docs/architecture.md`, `master-document.md`, `AGENTS.md`
- **Change:** Added the backend domain, data, and AWS infrastructure rules following the functional requirements; added the technical justification, AI usage declaration, and architecture docs; aligned the master document rule index; required tracker updates in agent instructions. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The backend had no domain rules, although master document section 13 plans them and delegates the data model and NestJS/Colyseus integration to them.
- **Next step:** Resolve conflicts between `docs/proyect-diagrams` and the ERS (roles, room model, task states, bot writes, join requests); decide the session mechanism; fill the real cases in `docs/ai-usage.md`; open a pull request to `develop`.
