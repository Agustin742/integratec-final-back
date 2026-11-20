# Daily review and daily question

The `BotModule` serves the daily review (HU-BOT-003, card #42): a once-per-local-day
briefing shown on the user's first authenticated connection, plus one daily question
built from the classroom's enabled bot material whose correct answer credits the study
streak. The frontend contract this implements lives in issue #119 (frontend repo PR
#110 already consumes this exact shape); the rules are in
[AI bot and daily briefing](../rules/ai-bot-and-daily-briefing.md),
[Data](../rules/data.md) (DailyReviewDelivery uniqueness) and
[Points, streak, and shop](../rules/points-and-shop.md). Teacher-approved material
enablement (#40) is documented in [Bot materials](bot-materials.md).

## Endpoints

| Route | Actor | Behavior |
|---|---|---|
| `GET /users/me/daily-review` | Any authenticated user | Server-decided state for the local day: `not_due`, or the full review payload with `status: "due"` |
| `POST /users/me/daily-review/daily-question` | Authenticated student with a today question | Validates the chosen option text, credits at most one streak milestone per local day |

## Delivery semantics

- **Day:** the calendar date in `America/Argentina/Buenos_Aires` on the server clock
  (`toLocalDay` in `src/gamification/local-day.ts`, the same helper the streak uses).
  Client clocks and time zones are never authoritative.
- **Once per day, atomically:** content is composed first, then the
  `DailyReviewDelivery` row is inserted under its `(userId, localDay)` unique
  constraint; only the request whose insert succeeds answers `due`. Concurrent first
  connections, reloads and other tabs all end with exactly one delivery. A failed
  composition inserts nothing, so the day is never silently lost to an error.
- **Audience:** resolved through the shared `AccessVerificationService`
  (`listAccessibleClassrooms`), so REST, the bot and this review agree on roles.
  Students get review + question (`audience: "STUDENT"`); teacher-level users get the
  review only (`audience: "TEACHER"`, `dailyQuestion: null`); parent-only accounts and
  accounts with no classroom access always answer `not_due` and consume no delivery.
- **Exam block:** a student with an exam in progress (same predicate
  `ActivitiesService.hasExamInProgress` that `rules/activities-and-grading.md` pins)
  answers `not_due` without consuming the delivery — the recorded default for the
  open "review on an exam day" decision.
- **Sections:** composed only through the exported application services that REST
  uses (student pending activities, report-card grades, announcements, teacher grading
  queue), bounded per section, with per-classroom failure isolation: one failing
  classroom is skipped, never blocks the review. `contentKind` is `structured` when the
  payload is built purely from PostgreSQL data, `generated` when the model summary
  succeeded; both count as delivered.

## Bedrock inference

- Calls run from NestJS only (`rules/ai-bot-and-daily-briefing.md`), through the
  `DAILY_REVIEW_INFERENCE_PORT`; the default adapter invokes
  `@aws-sdk/client-bedrock-runtime` with the SDK default provider chain (the EC2
  instance role in production, like S3), so no provider keys exist in the API.
- Model, region, timeout and the question attempt budget are configuration values:
  `BEDROCK_MODEL_ID` (default `amazon.nova-micro-v1:0`, an in-Region on-demand model
  available to AWS Free plan accounts), `BEDROCK_REGION` (default `us-east-2`),
  `BEDROCK_INFERENCE_TIMEOUT` (default `15s`, max `1m`) and
  `DAILY_QUESTION_MAX_ATTEMPTS` (default 5, max 20). See
  [Configuration](../README.md#configuration) and `apps/api/.env.example`.
- **Fail closed:** any provider error, timeout, throttle or invalid output returns the
  structured fallback. Prompt and response content is never logged — only user id,
  outcome and latency. Prompt input is only composed section rows (titles, classroom
  names, due dates) the user may already see, and sizes are bounded on both sides.
- Generated review text is **not persisted** (privacy decision for minors, open
  decision in the card): the delivery row records only fact and origin (`contentKind`).

## Daily question and streak credit

- One question per (user, local day), generated from the enabled bot material titles
  of the student's classrooms (`BotMaterialsService.enabledMaterialTitles`; the
  AllowedMaterial row is the enablement authority, soft-removed material excluded).
  With no enabled material, or when generation fails, `dailyQuestion` is `null` and the
  review is still delivered.
- The generated question is hard-validated (prompt ≤ 280 chars, 2–6 distinct options
  ≤ 120 chars, the correct option must be one of them) and persisted in
  `DailyReviewQuestion` with the answer key **server-side only**: `correctOption` is
  never selected for any response DTO and never appears in the OpenAPI document.
- `POST /users/me/daily-review/daily-question` sends `{ questionId, answer }` (the
  chosen option text) and the server decides:
  - foreign or unknown question id, malformed id, teacher or parent → `404 NOT_FOUND`
    (same envelope, no row-existence leakage);
  - question from a past local day → `409 CONFLICT` (`dailyQuestion` field);
  - already answered (credited) today → `409 CONFLICT`, the contract's repeat case;
  - attempt budget exhausted → `429 TOO_MANY_REQUESTS` (the budget applies to every
    unanswered submission, including a correct one: with only 2–6 options, a
    wrong-only cap would leak the key by elimination);
  - wrong answer → `{ correct: false, feedback, streak }`, still retryable within the
    budget, streak untouched;
  - correct answer → one transaction claims `answeredAt` atomically (the concurrent
    loser gets `409`) and credits the streak via
    `StreakService.recordQualifying` with source `DAILY_REVIEW_ANSWERED` — idempotent
    per (student, local day), so a student who already qualified today through a
    submission still gets `correct: true` and the live summary. The response streak is
    the server-confirmed state (`lastQualifyingDay` exposed as the contract's
    `lastQualifiedDate`); the client never computes it.

## Schema

`DailyReviewDelivery` (unique per user + local day, `contentKind` origin,
`deliveredAt`) and `DailyReviewQuestion` (unique per user + local day, prompt, JSON
options, server-only `correctOption`, `materialTitle`, `attempts`, `answeredAt`) are
additive only — migration
`20261119230000_create_daily_review_deliveries_and_questions`. Both follow the user
row with an explicit cascade (`rules/data.md` deletion policy).

## Out of scope and open decisions

- Bot conversation and retrieval over material content (#41 / HU-BOT-002): the
  question is generated from material titles only, never from indexed file content.
- Recovery when the HTTP response is lost after the delivery row exists (the open gap
  19 item): the frontend re-consults `GET` and follows the `status` flag.
- Persistence of generated review text and review-on-exam-day behavior beyond the
  recorded default (`not consumed`) remain open, as does the exact model choice (a
  configuration value away from a swap).
