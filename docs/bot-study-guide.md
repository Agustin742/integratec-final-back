# Study Guide Bot (HU-BOT-002)

## Overview

The Study Guide Bot lets enrolled students and classroom staff ask study questions grounded strictly in the teacher-approved materials of that classroom (`AllowedMaterial` with `indexState = INDEXED` and non-removed `StudyMaterial`).

- **External provider & RAG ([D20](./technical-justification.md#d20-external-ai-provider-pgvector-rag-and-study-guide-bot-boundaries)):** `OpenAiCompatibleAiAdapter` calls the configured external OpenAI-compatible API over HTTPS (default Google Gemini free-tier chat+tool calling and embeddings), while `PgVectorMaterialIndexAdapter` extracts text (`unpdf` for PDF, `mammoth` for DOCX, UTF-8 for plain text/markdown), chunks sections, embeds them, and searches PostgreSQL `material_chunks` (`vector(768)` with HNSW cosine similarity).
- **Server-side classroom isolation:** Every retrieval query filters in SQL by the server-resolved `classroomId`, joined to `allowed_materials` and `study_materials.removed_at IS NULL`, never via prompt filtering.
- **Anti-copy & read-only guardrails:** Only read-only tools (`search_allowed_material`, `list_my_pending_activities` with titles/types/formats/due dates only) are exposed to the model. Answer keys (`Option.isCorrect`) never enter prompts or tool outputs, and `AnswerKeyGuardService` inspects answers before returning them (`outcome = 'guided_only'` when guiding solution-seeking requests or substituting leaked keys).
- **Exam lockout:** For enrolled students, `ActivitiesService.hasExamInProgress` checks whether any `PUBLISHED` non-deleted `EXAM` in any of the student's active classrooms is currently open (`opensAt <= now <= dueAt`). Lockout runs both before invoking the AI provider and again before returning (`409 Conflict`, discarding any in-flight generation). Classroom staff are not blocked.
- **Privacy & ephemerality:** Conversations are not stored in PostgreSQL; logs record metadata only (`event`, `userId`, `classroomId`, `outcome`, `latencyMs`, `promptTokens`, `completionTokens`, `toolCalls`, `citationsCount`), never questions, chunks, or answers.

## REST endpoints

Routes live under `/classrooms/:id/bot` and require a valid bearer session:

- `GET /classrooms/:id/bot/status` (`200 OK`): returns `{ available, reason, message }` where `reason` is `'exam_in_progress' | 'no_materials' | null`.
- `POST /classrooms/:id/bot/messages` (`200 OK`): accepts `{ question }` (1–2,000 trimmed visible chars, tabs/newlines permitted) and returns `{ id, answer, outcome, citations, createdAt }` (`outcome` is `'answered' | 'out_of_scope' | 'guided_only'`; citations hold server-verified `{ materialId, filename, excerpt }`).
- **Errors:** `401` unauthenticated, `403` linked parent (`!adultMode`), `404` non-member, departed student, foreign/deleted classroom, or `adultMode` parent, `400` `VALIDATION_FAILED`, `409` `CONFLICT` (exam in progress), `429` `TOO_MANY_REQUESTS` (per-user, per-classroom, or global sliding window), `503` `SERVICE_UNAVAILABLE` (provider unconfigured, timed out, or failed without internal diagnostics).

See the committed [OpenAPI contract](../apps/api/openapi.json) and [teacher bot material configuration](./bot-materials.md).
