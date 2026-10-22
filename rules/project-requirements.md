# Course Requirements and Evaluation

The project **MUST** deliver a working, deployed MVP with authentication, authorization, persistent data, and an individual defense. These academic requirements apply to the complete product across frontend and backend repositories, not to frontend code alone.

Source: *IntegrarTEC 2026 — Programación Web con IA aplicada, Proyecto Integrador Final*, version 1.0, October 2026 (requirements: pp. 5–7; AI: p. 9; milestones: pp. 10–11; evaluation and delivery: pp. 11–14). This is a maintained English extraction, not the original document. The source PDF was temporary reading material and is not required in the repository. Later instructor clarifications **MUST** be recorded explicitly; unresolved scope questions **MUST** be checked with the teaching team.

## Mandatory requirements

All R1–R8 **MUST** be satisfied. Without functional authentication (R2) or deployment (R4), the project is incomplete regardless of other features.

| ID | Minimum requirement | Verification |
|---|---|---|
| R1 — Three layers | A web frontend consuming the project's own API; backend business logic; a persistent database with at least three related entities, including the user. In-memory data, local JSON files, and localStorage alone do not qualify. Separate repositories or a full-stack framework are allowed if responsibilities remain explicit. | Inspect code, architecture diagram, data relationships, and persistence after reload. |
| R2 — Authentication and authorization | Registration, login, logout; password hashing, never plaintext or reversible encryption; expiring sessions/tokens; protected frontend routes redirecting to login; backend endpoints returning 401 without valid credentials; at least two roles with different permissions and 403 for insufficient role permissions; isolation of users' private resources even when IDs are changed. A provider is allowed, but backend permissions remain mandatory. | Demonstrate authentication and direct API requests without credentials, with a different role, and with another user's resource IDs. |
| R3 — Real repository history | GitHub access for instructors; real commits from every member distributed throughout development; the required README; an appropriate .gitignore excluding dependencies, builds, and system files; .env.example without real secrets; no secrets in files or history. | Inspect the repository and git history, including old commits and individual contributions. |
| R4 — Working deployment | Public HTTPS frontend and backend; cloud-hosted database; environment-based configuration in each service; availability from submission until defenses end; working test accounts for every role, supplied in the README or submission. | Access the application externally and exercise every role. Disclose cold starts in the README and wake sleeping services before the defense. |
| R5 — Demonstrable MVP | A complete main user flow in production; full create/list/edit/delete operations for a domain entity associated with the user; frontend and backend validation; visible, understandable errors, loading states, and empty states. | Perform the whole flow in production; verify persistence after reload and backend restart, invalid input, and visible feedback. |
| R6 — Technical justification | For every relevant tool: what it is and its role, why it fits this project, at least one alternative considered, and the trade-offs. Cover frontend, backend runtime/framework, database and ORM/ODM if used, authentication, deployment services for each layer, and AI service if applicable. | Review the justification document. Generic marketing claims alone do not qualify. Minor dependencies do not require individual justification. |
| R7 — Basic security | Parameterized database queries or safe ORM/ODM access; CORS restricted to the frontend domain (no wildcard with credentials in production); no internal traces, queries, password hashes, or sensitive data in public errors/responses. | Inspect configuration and exercise API responses and failure paths. |
| R8 — Live and individual defense | Demonstration on the public deployment, not localhost; explanation of problem, solution, architecture, and technical decisions; individual understanding of the code, including AI-assisted code. | Live demo and individual questions; every member must be prepared to explain any part of the application. |

Passwords stored in plaintext, secrets retained in Git history, unprotected write/admin endpoints, and members without commits or the ability to explain their work are identified as serious faults.

## Mandatory AI process declaration

The repository **MUST** include the tools used, tasks supported, one successful AI case, and one case that needed correction, explaining detection and resolution. Contributors remain responsible for all delivered code and **MUST NOT** share secrets or real personal data with AI tools. See [AI usage](./ai-usage.md) for the maintained development policy.

An AI-powered product feature is **recommended**, not an academic minimum. If implemented, calls belong in the backend with protected credentials, error handling, and usage limits. A product-specific commitment to AI is separate from this distinction.

## Required documentation and delivery

The README **MUST** contain:

- Product name, problem, and target users.
- Public frontend and API links.
- Test credentials for every role, or a clear reference to where they are provided in the submission.
- Functionalities and stack, with the technical justification linked.
- Architecture description or diagram, or a link to the architecture document.
- Reproducible local installation, configuration, and startup instructions.
- Team members and their main contributions.
- A reference to the repository's AI usage declaration.

The final submission **MUST** provide repository access, deployment URLs, role-specific test credentials, technical justification, AI declaration, and team contributions. Someone outside the team should be able to clone and run the project using the README. Final checks **MUST** exercise the deployed application in an incognito window, from another network/device, including loss of protected access after logout.

## Milestones

| Milestone | Required outcome |
|---|---|
| 1 — Proposal | A 1–2 page proposal: tentative name and team, problem, users and roles, MVP scope and exclusions, at least three related entities, tentative stack/deployment, risks, and repository link. |
| 2 — Progress | Working authentication, a first deployment even if incomplete, a defined data model, and instructor review. |
| 3 — Final submission and defense | Complete production MVP, repository, required documentation and credentials, and oral defense. |

Dates are set by the teaching team; do not invent deadlines. The suggested defense structure is problem, live demo, architecture/decisions, lessons and AI usage, then individual questions. Its duration is indicative, not a fixed requirement.

## Recommendations, not additional academic minimums

The course values:

- A 3–5 minute demo video linked in the README.
- Architecture and data-model diagrams, endpoint documentation, and a local setup guide.
- A working model-API feature with protected backend credentials.
- Automated authentication and authorization tests.
- CI/CD or a lint/test pipeline.
- Feature branches, peer-reviewed pull requests, and issues or a project board.
- Responsive UI, visual consistency, and basic accessibility.
- Advanced authentication such as recovery, verification, OAuth, login limits, or a second factor.

Team rules may make a recommended practice mandatory internally; that does not change its classification in the course brief.

## Evaluation and relationship to product scope

Evaluation observes authentication/authorization; complete MVP behavior; architecture, naming, separation of responsibilities and code quality; repository contributions and stable HTTPS deployment; project-specific technical reasoning; individual understanding in the defense; and recommended improvements. No numeric weights are provided in the source.

These requirements do not mandate a specific framework, cloud vendor, 3D world, multiplayer service, or AI product feature. The [project document](../master-document.md#10-cumplimiento-del-enunciado-integrartec-2026) contains the product-specific compliance mapping. Keep implementation status and evidence there rather than adding a second status checklist here. Proposed technology choices still require team agreement.
