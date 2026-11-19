# Teacher bot material configuration

## Data foundation

`BotConfig` holds exactly one row per classroom (`classroomId` unique), created
lazily when the first material is allowed for the bot. There is no bot toggle or
schedule in this configuration.

`AllowedMaterial` records which study materials the classroom's study guide bot
may use, unique per `(classroomId, materialId)` and carrying the explicit
classroom partition, so bot retrieval can never cross classrooms or schools.
`indexState` (`PENDING`, `INDEXED`, `FAILED`) plus a nullable `failureReason`
expose the indexing outcome per material; the reason is set exactly while the
state is `FAILED` (database CHECK) and is a fixed, non-diagnostic message.

The retrieval technology is still an open decision (candidate: Amazon Bedrock
Knowledge Bases or an equivalent). Indexing therefore goes through the
`MaterialIndexPort` boundary with a default in-process adapter that records
per-classroom partition membership; the real retrieval adapter replaces it in
HU-BOT-002 without changing the endpoints or the data model. The port contract
requires a re-index to fully replace earlier chunks, so a re-enable never reuses
previously retrieved content.

## REST endpoints

All three routes live under `classrooms/:id/bot/materials`, require a bearer
session, and answer `404` for every actor without teacher-level authority over
the classroom — including enrolled students and linked parents, per this card's
explicit concealment policy. There is no `403` case on these routes. Rejected
requests change no persisted state. The committed
[OpenAPI contract](../apps/api/openapi.json) describes the routes.

`POST /classrooms/:id/bot/materials` with `{ "materialId": "<uuid>" }` enables
one material. The material must belong to the same classroom and not be
soft-removed; the bot config and the allowed-material row are upserted in one
transaction and the material is indexed under the classroom partition. A
duplicate enable is idempotent: it re-indexes from scratch. On success the
response is `201` with `indexState: "INDEXED"`. When indexing fails the response
is still `201` with `indexState: "FAILED"` and a visible `failureReason`: the
material stays usable for its normal classroom purposes and the teacher can
retry. Unknown or non-UUID body fields return `400` `VALIDATION_FAILED`.

`GET /classrooms/:id/bot/materials` lists the allowed materials with their
indexing state, filename metadata from the joined study material, standard
offset pagination (`page`, `pageSize`, defaults 1/20, maxima 10,000/100), and
`sort` limited to `createdAt` / `-createdAt` (default) with `id` in the same
direction as tiebreaker. Soft-removed materials are excluded; a stale
allowance of an already removed material stays removable through the disable
endpoint.

`DELETE /classrooms/:id/bot/materials/:materialId` disables a material. The
database row is the authority for exclusion, so the material is excluded from
bot retrieval immediately; the indexed chunks are removed through the port
afterwards. Repeated disable returns `404`. If the partition cleanup fails the
response is `503` with a clear message — the material is already excluded and a
re-enable re-indexes from scratch.

Removing a study material (`DELETE /classrooms/:id/materials/:materialId`) also
removes it from the bot. The allowed-material rows are deleted in the same
transaction as the soft-removal, so a removed material is never left allowed;
the indexed chunks are removed through the port after commit. If that cleanup
fails the material removal still succeeds (`204`) and the failure is logged:
the deleted row already excludes the material from retrieval.
