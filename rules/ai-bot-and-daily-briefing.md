# AI Bot and Daily Briefing (Server Side)

The bot is a read-and-summarize assistant that runs entirely in NestJS and sees only what the asking user may see. General AI-process rules are in [Responsible AI usage](./ai-usage.md).

## Authority and scope

- [Master §4](../master-document.md#4-bot-con-inteligencia-artificial) defines the bot and the daily briefing; the behavior is specified by RF-BOT-001 to RF-BOT-011 and RN-18 in the [functional requirements](../docs/functional-requirements.md).
- The MVP bot is **read and summarize only**: master §4 states that it executes no direct database modifications, and RN-18 states that it never modifies data. Autonomous actions (RF-BOT-010) are an evolution item requiring explicit user confirmation and a new decision.

## Provider integration

- Inference **MUST** use Amazon Bedrock invoked from NestJS with the service's IAM role. The browser and Colyseus **MUST NOT** call the model provider. Provider keys, if any exist, **MUST NOT** leave the server; see [Configuration](./configuration-and-environments.md).
- The model, region, and limits **MUST** be configuration values. Specific model choice is **open**.
- Bedrock permissions **MUST** be limited to the required invoke actions on the chosen models; see [AWS infrastructure](./aws-infrastructure.md).

## Authorization and tools

- Every bot request **MUST** be authenticated and run with the permissions of the asking user. The bot **MUST NOT** hold a privileged identity.
- Data for a prompt **MUST** be retrieved through the same application services and filters as the REST API, scoped to the user's offices and accessible rooms. Content from rooms or offices the user cannot access **MUST NOT** enter a prompt, a response, or the briefing (RF-BOT-003).
- Access loss **MUST** take effect on the next request; the bot **MUST NOT** reuse cached content from rooms the user can no longer access.
- The tool catalog is limited to read operations: tasks, meetings, announcements, and recent activity summaries. Tools **MUST NOT** create, update, or delete tasks, announcements, meetings, accesses, or messages (RF-BOT-004). A request to modify data **MUST** be declined with a pointer to the application.
- User text and stored content (chat, task descriptions) are untrusted. The server **MUST NOT** let them alter tool permissions or system instructions, and **MUST** treat a request to ignore permissions as refused.
- Model output **MUST** be returned as text and **MUST NOT** be executed or trusted as authorization input.

## Daily briefing

- The briefing is shown on the user's first authenticated connection of each day, with tasks pending or near due, meetings of the day, and new announcements, grouped by office and room, including only accessible rooms (RF-BOT-006).
- The day is the calendar date in **America/Argentina/Buenos_Aires**, computed on the server; client clocks are never authoritative ([Data and time](./data-and-time.md)). The policy applies only to the briefing and is not inherited by other features.
- Identity is the pair (user, local date). A persistent delivery record with a uniqueness constraint on that pair **MUST** exist; see [Data](./data.md).
- The decision to deliver **MUST** be atomic: concurrent requests, reloads, room changes, and reconnections on the same day **MUST** produce exactly one delivery, for example by inserting the record under a unique constraint and delivering only when the insert succeeds (RF-BOT-007).
- If delivery fails after the record is created, the day **MUST NOT** silently lose the briefing; the exact recovery behavior is **open**. The user may re-consult it from the bot during the day (RF-BOT-007).
- Date rollover in Argentina makes the next first connection eligible again.
- The briefing records the fact and origin of delivery; persisting the full generated text is **open** and **MUST** consider privacy.

## Provider failure and fallback

- When Bedrock is unavailable, errors, times out, or is throttled, the briefing **MUST** fall back to a structured summary built from the user's data without generated text, and that counts as delivered (RF-BOT-008, RF-BOT-009).
- Interactive questions **MUST** return a clear, non-technical error and allow retry (RF-BOT-001). Calls **MUST** use bounded timeouts and bounded retries; non-idempotent steps **MUST NOT** be retried blindly. See [Error handling](./error-handling-and-feedback.md).

## Usage limits

- The server **MUST** limit bot usage per user (and **SHOULD** apply a global cap) and respond with a clear message when exceeded (RF-BOT-001). Numeric limits are **open** and **MUST** be configuration values.
- Prompt and response sizes **MUST** be bounded.

## Privacy and observability

- Prompts, responses, and retrieved content **MUST NOT** be logged by default; log operation, user identifier, outcome, latency, and token counts per [Observability and privacy](./observability-and-privacy.md).
- Only data necessary for the request **SHOULD** be sent to the provider. Real personal data **MUST NOT** appear in test prompts or fixtures.
- Whether bot conversations are persisted (the `BotConversation` entity) and retention are **open**.

## Verification

Tests **MUST** cover: inaccessible rooms excluded from answers and briefing, modification requests declined, concurrent first-connection requests delivering once, day-boundary behavior at midnight Buenos Aires time, provider failure fallback, and rate limiting. Provider calls in tests **MUST** use fakes. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Model selection and numeric usage limits.
- Persistence of conversations and generated briefing text; retention.
- Recovery behavior when delivery fails after the delivery record is created.
