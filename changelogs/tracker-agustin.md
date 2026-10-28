# Tracker — Agustin

## 2026-10-28 — Adopt Terraform for infrastructure as code

- **Status:** completed
- **Area / files:** `rules/infrastructure-as-code.md`, `rules/aws-infrastructure.md`, `rules/README.md`, `rules/documentation-and-decisions.md`, `docs/technical-justification.md`, `master-document.md`, `.gitignore`
- **Change:** Added the Terraform rule (location in `infra/`, pinned versions, S3 remote state with locking, secrets, reviewed plans, drift handling); linked it from the AWS rule, index, justification, and master document; ignored Terraform state and variable files; fixed leftover "rendering technology unresolved" wording. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** AWS infrastructure had no reproducible definition; Terraform was chosen over AWS CDK.
- **Next step:** Team to confirm the decision in the pull request; resolve open points (task definition ownership with the image pipeline, Amplify management, pipeline authentication); create `infra/`.

## 2026-10-27 — Add backend domain rules and project docs

- **Status:** completed
- **Area / files:** `rules/` (architecture, authentication-and-session, rooms-and-permissions, tasks-and-productivity, communication-and-meetings, ai-bot-and-daily-briefing, realtime-and-presence, data, aws-infrastructure), `docs/technical-justification.md`, `docs/ai-usage.md`, `docs/architecture.md`, `master-document.md`, `AGENTS.md`
- **Change:** Added the backend domain, data, and AWS infrastructure rules following the functional requirements; added the technical justification, AI usage declaration, and architecture docs; aligned the master document rule index; required tracker updates in agent instructions. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The backend had no domain rules, although master document section 13 plans them and delegates the data model and NestJS/Colyseus integration to them.
- **Next step:** Resolve conflicts between `docs/proyect-diagrams` and the ERS (roles, room model, task states, bot writes, join requests); decide the session mechanism; fill the real cases in `docs/ai-usage.md`; open a pull request to `develop`.
