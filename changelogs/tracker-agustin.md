# Tracker — Agustin

## 2026-10-30 — Record resolved classroom, grading and points decisions

- **Status:** completed
- **Area / files:** `rules/` (classrooms-and-roles, authentication-and-session, activities-and-grading, points-and-shop, data, live-classroom-tools, realtime-and-presence)
- **Change:** Recorded the user's decisions as rules: foreign resources respond `404` (`403` only for insufficient role on a visible resource), invitation email need not match, at most 2 guardians per student, adult mode keeps parent links but disables parent actions, one account may hold both paths, 0-100 grades, teacher-configured resubmission, per-student points ledger, classroom items bought by students, streak breaks when the activity requirement is unmet, one seat per enrolled student, freeze does not lock the teacher. Admin versus Owner delegation and point weights stay deferred. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** These were open decisions blocking implementation.
- **Next step:** Align the frontend rules; decide Admin delegation during the roles implementation.

## 2026-10-30 — Realign backend rules with the school niche

- **Status:** completed
- **Area / files:** `rules/` (classrooms-and-roles, activities-and-grading, communication-and-notifications, points-and-shop, live-classroom-tools, data, ai-bot-and-daily-briefing, realtime-and-presence, architecture, authentication-and-session, README), `master-document.md` (pet/bot separation, section 13), `docs/architecture.md` (link paths only)
- **Change:** Renamed the office/room, task, and meeting rules to the school model and rewrote them; added the points-and-shop and live-classroom-tools rules; rewrote the data model (schools, classrooms, enrollments, parent links, activities, points ledger, shop, pet, notifications, bot configuration); updated the bot (RAG over approved material, exam block, guide-only rule), realtime (classroom controls, freeze, collaboration sync candidate), architecture (candidate external services), and authentication (organization paths, invitations, adult mode). Pet and AI bot are documented as independent. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The master document v0.3 narrowed the product to schools; the rules had to match it before implementation.
- **Next step:** Realign the frontend rules, then the `docs/` requirement and design documents.

## 2026-10-30 — Rewrite master document for the school niche

- **Status:** completed
- **Area / files:** `master-document.md`
- **Change:** Rewrote the product scope for schools (teachers, students, parents, school owner/admin): organization paths, roles, activities and grades, points and shop, classroom controls, 2D classic mode, RAG-based AI bot, MVP split into core and extended, updated R1-R8 checks, and version 0.3. Removed offices/rooms, Kanban, generic tasks, and meetings. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The team narrowed the product to an education niche; the master document must match before the data model and rules are derived from it.
- **Next step:** Realign the `rules/` files with the new scope (classrooms and roles, activities and grading, points and shop, live classroom tools, notifications, data, AI bot); decide the candidate technologies in `docs/technical-justification.md`.

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
