# AI Bot and Daily Review (Server Side)

The bot is a study guide that runs entirely in NestJS, answers from material the teacher approved, and sees only what the asking user may see. It is the classroom tutor and is independent of the classroom pet. General AI-process rules are in [Responsible AI usage](./ai-usage.md).

## Authority and scope

- [Master §4](../master-document.md#4-bot-con-inteligencia-artificial) defines the bot, its rules, and the daily review ([§4.1](../master-document.md#41-repaso-diario-en-la-primera-conexión)); [§4.2](../master-document.md#42-integración-y-seguridad) defines integration and security.
- The bot is a **guide, not a solver**, and in the MVP it makes **no modification** to application data. Autonomous actions are an evolution item requiring explicit user confirmation and a new decision.
- The bot is reachable from its in-world character and from the 2D mode; both paths use the same endpoints and checks. It is not tied to the pet.

## Provider integration

- Inference **MUST** use Amazon Bedrock invoked from NestJS with the service's IAM role. The browser and Colyseus **MUST NOT** call the model provider. Provider keys, if any exist, **MUST NOT** leave the server; see [Configuration](./configuration-and-environments.md).
- The model, region, and limits **MUST** be configuration values. Specific model choice is **open**.
- Bedrock permissions **MUST** be limited to the required invoke actions on the chosen models and knowledge resources; see [AWS infrastructure](./aws-infrastructure.md).

## Retrieval over approved material

- Answers are produced by retrieval-augmented generation (RAG) **only over the Materials the teacher approved** for that classroom through BotConfig and AllowedMaterial. The bot **MUST NOT** answer from other classrooms' material, from unapproved material, or present its own knowledge as classroom content.
- The teacher (or the school Owner or Admin) configures the allowed material per classroom. There is no schedule in the configuration. A change **MUST** apply on the next request and **MUST NOT** reuse retrieved content from material that has since been disallowed or deleted.
- The retrieval technology is a **candidate**: Amazon Bedrock Knowledge Bases or an equivalent, to be confirmed in `docs/technical-justification.md` (R6). Whatever the choice, the index **MUST** be partitioned or filtered per classroom so retrieval cannot cross classrooms or schools, and the filter **MUST** be applied by the server, never by the prompt.
- Indexing of a Material happens after upload and after the file passes the same validation as any upload; indexing failure **MUST** leave the Material usable for its normal purposes and **MUST** be visible to the teacher. Handling a Material removed or replaced **MUST** also remove it from the index.
- When the approved material does not contain the answer, the bot **MUST** say so rather than invent one. Citing the source Material in an answer is **SHOULD**.
- Material and student text are untrusted input. Instructions embedded in files or messages **MUST NOT** change tool permissions, scope, or system instructions.

## Authorization

- Every bot request **MUST** be authenticated and run with the permissions of the asking user. The bot **MUST NOT** hold a privileged identity.
- Retrieval and data for a prompt **MUST** go through the same application services and filters as the REST API, scoped to the classrooms where the user has access. Content from classrooms the user cannot access **MUST NOT** enter a prompt, a response, or a review.
- Access loss **MUST** take effect on the next request.
- The tool catalog is limited to read operations over the user's own accessible data: pending and upcoming activities, grades visible to the user, announcements, and allowed material. Tools **MUST NOT** create, update, or delete activities, submissions, grades, points, announcements, accesses, or messages. A request to modify data **MUST** be declined with a pointer to the application.
- Parents **MUST NOT** use the bot or receive the daily review.
- Model output **MUST** be returned as text and **MUST NOT** be executed or trusted as authorization input.

## Exam block

- The bot **MUST** be unavailable to a student while an exam is in progress for them. The server decides this from persisted exam state and server time ([Activities and grading](./activities-and-grading.md)), not from the client, and checks it on every request, including requests started before the exam began and long-lived sessions.
- The block applies to questions, retrieval, and the daily review content during the exam; the response is a clear non-technical message. Teacher-level staff are not blocked.
- Whether the block applies to the whole classroom or to students taking the exam follows the exam scope recorded in [Activities and grading](./activities-and-grading.md).
- An in-flight generation that completes after the exam started **MUST NOT** be shown to the student.

## Anti-cheat: guide, never solve

- The bot **MUST** act as a guide: explain concepts, point to approved material, ask guiding questions, and check the student's reasoning. It **MUST NOT** hand out final answers or complete solutions to activities, including multiple-choice answers and file-submission work, in any phrasing.
- The rule is enforced in the system instructions and by server-side guardrails: the retrieval context for a student **MUST NOT** include the answer keys of activities (correct options, teacher solutions), and the bot has no tool that reads them.
- Output checks against known answer keys, and adversarial tests (rephrased and role-play requests), are **SHOULD**; the extent is **open**.
- Detecting and flagging suspected misuse to the teacher is **open**.

## Daily review

- The review is shown on the user's first authenticated connection of each day for **every role except Parent**. For students it may include pending and upcoming activities, grades and announcements, and review of allowed material; for teachers it may include pending reviews and classroom activity. It proposes next steps and executes nothing.
- The day is the calendar date in **America/Argentina/Buenos_Aires**, computed on the server; client clocks are never authoritative ([Data and time](./data-and-time.md)). The policy applies only to the review and is not inherited by other features.
- Identity is the pair (user, local date). A persistent DailyReviewDelivery with a uniqueness constraint on that pair **MUST** exist; see [Data](./data.md).
- The decision to deliver **MUST** be atomic: concurrent requests, reloads, classroom changes, and reconnections on the same day **MUST** produce exactly one delivery, for example by inserting the record under a unique constraint and delivering only when the insert succeeds.
- If delivery fails after the record is created, the day **MUST NOT** silently lose the review; the exact recovery behavior is **open**. The user may re-consult it from the bot during the day.
- Date rollover in Argentina makes the next first connection eligible again.
- The review records the fact and origin of delivery; persisting the full generated text is **open** and **MUST** consider privacy, especially for minors.
- If the first connection of the day happens during an exam, the exam block applies and the delivery behavior is **open** (default: not consumed).

## Provider failure and fallback

- When Bedrock or the retrieval service is unavailable, errors, times out, or is throttled, the review **MUST** fall back to a structured summary built from the user's data without generated text, and that counts as delivered.
- Interactive questions **MUST** return a clear, non-technical error and allow retry. Calls **MUST** use bounded timeouts and bounded retries; non-idempotent steps **MUST NOT** be retried blindly. See [Error handling](./error-handling-and-feedback.md).

## Usage limits

- The server **MUST** limit bot usage per user (and **SHOULD** apply a global cap and a per-classroom cap) and respond with a clear message when exceeded. Numeric limits are **open** and **MUST** be configuration values.
- Prompt, retrieval, and response sizes **MUST** be bounded.

## Privacy and observability

- Prompts, responses, and retrieved content **MUST NOT** be logged by default; log operation, user identifier, outcome, latency, and token counts per [Observability and privacy](./observability-and-privacy.md).
- Only data necessary for the request **SHOULD** be sent to the provider. Real personal data, and any real data of minors, **MUST NOT** appear in test prompts or fixtures.
- Whether bot conversations are persisted (the `BotConversation` entity) and retention are **open**.

## Verification

Tests **MUST** cover: retrieval limited to approved material and to the classroom; disallowed material no longer retrievable; the bot unavailable during an exam, including a request in flight; answer keys excluded from context and solution-seeking requests turned into guidance; Parent denied the bot and the review; modification requests declined; concurrent first-connection requests delivering once; day-boundary behavior at midnight Buenos Aires time; provider failure fallback; and rate limiting. Provider calls in tests **MUST** use fakes. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Model selection, retrieval technology, and numeric usage limits.
- Persistence of conversations and generated review text; retention.
- Recovery when delivery fails after the delivery record is created, and review delivery on an exam day.
- Extent of output checks against answer keys and misuse flagging.
