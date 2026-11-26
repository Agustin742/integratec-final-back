# Tracker — Agustin

## 2026-11-26 — Serve 3D models from the hosted front

- **Status:** completed, not yet applied
- **Area / files:** `infra/modules/frontend_hosting/`, `infra/envs/prod/tests/`
- **Change:** Added `glb` to the static-file extensions excluded from the Amplify SPA rewrite.
- **Reason:** The hosted site answered every `.glb` request with `index.html`, so no 3D model loaded.
- **Verification:** Hosting test failed first, then passed with the new rule.
- **Next step:** Apply through the pipeline and request a model from the published site.

## 2026-11-26 — Classroom avatar emotes in the realtime room (#154)

- **Status:** completed
- **Area / files:** `apps/realtime/src/rooms/`, `packages/contracts/`, `rules/` (realtime-and-presence, api-contracts)
- **Change:** Added the `avatar:emote` command and the `avatar:emoted` broadcast with a 3-second per-member cooldown. Emotes are not stored and the state schema did not change.
- **Reason:** The classroom must see each other's avatar emotes.
- **Verification:** Specs written RED first; touched specs, lint, typecheck and Prettier pass.
- **Next step:** Front mirrors the message names and payloads and plays the clips.

## 2026-11-25 — Database-backed verification of the asset customization branch (#154)

- **Status:** completed
- **Area / files:** `apps/api/src/equipment/equipment.integration.spec.ts`
- **Change:** Applied every migration to a temporary PostgreSQL database and ran the DB-backed specs for equipment, desks, classrooms, invitations, join verification, reverification, context transaction, realtime events, users and shop. Added a case that equips `hand`, `neck` and `ears` together and reads them back.
- **Reason:** The branch migrations and DB-backed specs had not been run.
- **Verification:** 542 of 549 passed in the first parallel run; the 7 failures, and one concurrency case on a later rerun, were 5 s timeouts on a local Docker database and passed with a 60 s timeout.
- **Next step:** Confirm in CI with its default timeout.

## 2026-11-25 — Tutor bot skin per classroom, synced to the room (#154)

- **Status:** completed
- **Area / files:** `apps/api/prisma/` (schema, migration `20261125010000_add_classroom_tutor_bot_skin`), `apps/api/src/classrooms/`, `apps/api/src/platform/realtime/`, `apps/api/src/internal/realtime/`, `apps/realtime/src/`, `packages/contracts/`, `apps/api/openapi.json`, `docs/`, `rules/`
- **Change:** Classroom staff set `tutorBotSkin` through `PATCH /classrooms/:id`; classroom responses expose it and the room syncs it as `ClassroomState.tutorBotSkin`, from join verification for new rooms and from an outbox push for live ones, ordered by a per-classroom revision. A join verification without the skin fields, or with a skin the realtime build does not know, admits with `none` instead of failing.
- **Reason:** The whole classroom must see the same tutor bot skin, including late joiners.
- **Verification:** Specs written RED first; touched specs without a database, lint, typecheck and Prettier pass. DB-backed specs (join verification, reverification, context transaction, classrooms integration) were not run and the migration was not applied.
- **Next step:** Deploy API and realtime together after the migration. Front regenerates API and realtime types. Run the DB-backed specs in CI.

## 2026-11-25 — Desk decor shop items and per-desk visibility (#154)

- **Status:** completed
- **Area / files:** `apps/api/prisma/` (shop catalog, seed), `apps/api/src/classrooms/desks/`, `apps/api/src/users/member-appearance.ts`, `apps/api/openapi.json`, `docs/`
- **Change:** Seeded 7 desk decor shop items (`DESK_UPGRADE`, `desk_decor` slot, 80 to 220 points). `GET /classrooms/:id/desks` now returns each assigned student's equipped desk decor as `deskDecor`, with the same access rules (parents excluded).
- **Reason:** Each student's desk must show their decor to the whole classroom; the realtime state only covers connected students and no REST endpoint exposed other members' equipment.
- **Verification:** Specs written RED first; touched specs without a database, lint and typecheck pass. The desk map PostgreSQL spec was updated but not run (no PostgreSQL running).
- **Next step:** Front regenerates API types and reads `deskDecor`. Run the DB-backed specs in CI.

## 2026-11-25 — Hand, neck and ears equipment slots (#154)

- **Status:** completed
- **Area / files:** `apps/api/prisma/` (schema, migration `20261125000000_add_hand_neck_ears_equipped_slots`, shop catalog), `apps/api/src/equipment/`, `apps/api/src/users/member-appearance.ts`, `packages/contracts/src/index.ts`, `apps/realtime/src/testing/stub-api.ts`, `apps/api/openapi.json`, `docs/`, `rules/data.md`
- **Change:** Added independent `hand`, `neck` and `ears` equipment slots for avatar accessories through the database enum, equipment API, member appearance and shared contract, and seeded 19 shop items (40 accessories in total).
- **Reason:** The front merged hand, neck and ear accessory assets that students cannot buy or equip yet.
- **Verification:** Specs written RED first; touched specs without a database, lint and typecheck pass. DB-backed specs and the migration were not run (no PostgreSQL running).
- **Next step:** Run the DB-backed specs in CI; deploy API and realtime together because the appearance contract now requires the new keys.

## 2026-11-25 — Voice calls, direct call ringing and docs (#149, B4)

- **Status:** completed (pending CI and merge of the PR)
- **Area / files:** `apps/realtime/src/rooms/call-room.ts`, `room-directory.ts`, `classroom-room.ts`, `app.config.ts`, `index.ts`, `config/realtime-config.ts`, `packages/contracts/src/index.ts`, `docs/voice-calls.md`, `README.md`, `docker-compose.yml`, `apps/realtime/.env.example`
- **Change:** A direct call now rings the peer: the first participant is the caller and every live classroom connection of the peer gets `call:incoming`. No classroom connection ends the call as `unavailable`; no answer within `CALL_RING_TIMEOUT_SECONDS` (default 30) ends it as `timeout`. The callee can `call:decline` over the classroom room (rate limited, only for a ringing call addressed to them), which ends the call and sends the caller `call:declined`. Whenever a ring ends the callee's classroom connections get `call:ring-canceled` so other tabs stop ringing. New `docs/voice-calls.md` documents the whole feature (P2P mesh, STUN only, call keys, moderation, ringing, limits, single-process assumption). No HTTP or database change, so no OpenAPI export.
- **Reason:** Direct calls need a way to reach a user who is not in a call yet; the classroom connection is the only channel they have.
- **Verification:** Specs written RED first, then GREEN; typecheck, lint, prettier and `realtime:codegen:check`.
- **Next step:** Front F2 call engine.

## 2026-11-25 — Teacher call moderation and focus mode (#149, B3)

- **Status:** in-progress
- **Area / files:** `apps/realtime/src/rooms/call-room.ts`, `call-moderation.ts`, `call-key.ts`, `room-directory.ts`, `classroom-room.ts`, `rules/realtime-and-presence.md`
- **Change:** Moderators (OWNER, ADMIN, TEACHER) of a classroom call can mute all, mute or unmute one student, allow or deny self unmute, toggle focus mode and end the call (`call:ended`, then close code 4102). Anyone else is ignored silently, and direct calls reject moderation. The room directory mirrors the class call into the classroom room (`classCallActive`, `focusMode`); while focus mode is on, the classroom room ignores student movement. If the last moderator leaves, focus mode is cleared and the call stays alive. When a peer leaves a direct call, the other gets `call:ended` (`peer_left`) and the call closes.
- **Reason:** The teacher needs control of a class call, and focus mode must hold on the server, not only in the client.
- **Verification:** Specs written RED first, then GREEN; typecheck, lint and prettier.
- **Next step:** B4 one-to-one calls.

## 2026-11-25 — Voice call room core (#149, B2)

- **Status:** in-progress
- **Area / files:** `apps/realtime/src/rooms/call-room.ts`, `call-key.ts`, `authenticate-call-join.ts`, `appearance-state.ts`, `room-directory.ts`, `app.config.ts`, `config/realtime-config.ts`, `packages/contracts/src/index.ts` (ICE `usernameFragment`, close codes 4104), `README.md`, `docker-compose.yml`, `.env.example`
- **Change:** New `call` Colyseus room: server-derived call key (one call, one room), moderator-only start of classroom calls, private direct pair rooms, participant cap (`CALL_MAX_PARTICIPANTS`), one connection per user, signaling relay restricted to room participants, self mute/speaking/emote state and per-connection rate limits. Calls are evictable through the room directory.
- **Reason:** Voice calls need an authenticated signaling and state room before moderation (B3) and ringing (B4).
- **Verification:** Specs written RED first, then GREEN; typecheck, lint, prettier and `realtime:codegen:check`.
- **Next step:** B3 teacher moderation and focus mode.

## 2026-11-25 — Voice call room contracts (#149, B1)

- **Status:** in-progress
- **Area / files:** `packages/contracts/src/index.ts`, `packages/contracts/src/realtime/call-contract.spec.ts`, `packages/contracts/src/realtime/generated/` (`CallState`, `CallParticipant`, `ClassroomState`), `apps/realtime/src/rooms/call-state.ts`, `apps/realtime/src/rooms/classroom-state.ts`, `apps/realtime/package.json`
- **Change:** New contracts for avatar voice calls: call room name and participant cap (12), join options (classroom or direct), signaling/self/emote/moderation/end/decline message schemas, server event payloads, call close codes (4101, 4102), and the `CallState` schema. The classroom state gains `classCallActive` and `focusMode`. Codegen now covers both state files.
- **Reason:** The call room, moderation and 1:1 ringing (B2 to B4) need one shared, validated contract with the frontend.
- **Verification:** Contract and state specs written RED first, then GREEN; `realtime:codegen:check`, typecheck and lint.
- **Next step:** B2 call room implementation.

## 2026-11-25 — Move the study guide bot to Gemini 3

- **Status:** completed
- **Area / files:** AI config default, `docker-compose.yml`, `apps/api/.env.example`, README and docs, `apps/api/src/bot/`
- **Change:** Changed the default chat model to `gemini-3.5-flash-lite` (`gemini-3.8-flash` did not answer within 90s on a free-tier key). Tool calls now carry opaque `providerContext`, which the adapter reads from and writes back to `extra_content`, preserving Gemini thought signatures across the tool loop.
- **Reason:** `gemini-2.5-flash` returns 404 for new API keys, and Gemini 3 rejects tool turns without the signature.
- **Verification:** Specs written RED first, then GREEN; typecheck and eslint on the touched files. Full suite not run. Manual live check of the bot with `gemini-3.5-flash-lite` passed (in-material and out-of-material questions).
- **Next step:** None.

## 2026-11-25 — Accept Gemini embeddings without a zero index

- **Status:** completed
- **Area / files:** `apps/api/src/bot/openai-compatible-ai.adapter.ts` and its spec
- **Change:** `embed()` now reads an omitted `index` as 0. Duplicate indexes are now rejected explicitly; the previous hole check skipped sparse array slots and let them through.
- **Reason:** Gemini omits `index` when it is 0, so every real embedding request was rejected.
- **Verification:** Specs written RED first, then GREEN; typecheck and eslint on the touched files. Full suite not run.
- **Next step:** None.

## 2026-11-24 — Synced pet and tutor bot routines in the classroom room (#147)

- **Status:** completed
- **Area / files:** `packages/contracts/src/index.ts` (layout `props`, NPC ids/states/emotes, homes, `npc:interact`, tutor bot phrases), `packages/contracts/src/realtime/generated/Npc.ts`, `apps/realtime/src/rooms/classroom-state.ts`, `apps/realtime/src/rooms/classroom-room.ts`, `apps/realtime/src/npc/npc-routine.ts`, `apps/realtime/src/movement/step-avatar.ts`, related specs
- **Change:** The classroom room now owns the pet and the tutor bot: it picks random reachable destinations, walks them calmly, pauses, plays emotes, sends them to rest at the pet bed or bot station, and recovers when they get stuck. NPC state is synced in `ClassroomState.npcs`; pressing E near an NPC (distance and cooldown checked on the server) triggers a reaction the whole room sees (pet greet/ask for pets, bot academic phrase). Floor props the front draws (kiosk, pet bed, bot station, report card stand, chat computer, flags, christmas tree, plants) are shared obstacles for avatars and NPCs. The routine only runs while the room has members.
- **Reason:** Front #138 brings the pet and tutor bot to life; every member must see the same routine.
- **Verification:** Specs written RED first per task (contracts layout, step-avatar, npc routine incl. 10 simulated minutes always on walkable floor, room and e2e interaction), lint, typecheck, `realtime:codegen:check`.
- **Next step:** Open the PR to `develop` after #146 (chained from `feat/145-avatar-catalog-shop`).

## 2026-11-24 — Align contract examples with the modular catalog (#145, BK-4)

- **Status:** completed
- **Area / files:** `apps/api/openapi.json`, `apps/api/src/shop/shop.dto.ts`, `apps/api/src/equipment/equipment.dto.ts`, `apps/api/src/internal/realtime/realtime-join.dto.ts`, realtime and contracts spec fixtures
- **Change:** Swagger/DTO examples and appearance fixtures now use a real catalog code (`head_cap`) instead of the removed placeholder `cap_blue`. OpenAPI re-exported; realtime generated contracts regenerated and unchanged. Docs (`shop.md`, `profile-avatar.md`, `equipment.md`) already matched the final contract. Purely synthetic shop/equipment test fixtures keep their own codes on purpose.
- **Reason:** The contract surface must not advertise codes that the seed catalog no longer has.
- **Verification:** `openapi.spec.ts`, edited specs, `realtime:codegen:check`, lint and typecheck.
- **Next step:** Open the PR to `develop`.

## 2026-11-24 — Seed the avatar shop catalog (#145, BK-3)

- **Status:** in-progress
- **Area / files:** `apps/api/prisma/seed.ts`, `apps/api/prisma/seed-shop-catalog.ts`, `apps/api/prisma/seed-shop-catalog.spec.ts`, `docs/shop.md`
- **Change:** The synthetic shop catalog now has 21 avatar accessories and 25 paid hair/top styles (46 items, 80 to 250 points); the eight old placeholder items are gone. The catalog moved to its own module so a spec can check colors, prices and that paid styles match `avatar-catalog.ts` one to one.
- **Reason:** The shop must sell what the front avatar editor can render.
- **Verification:** Catalog spec written RED first, then GREEN; seed run on a throwaway database.
- **Next step:** BK-4 contract regeneration (done).

## 2026-11-24 — Modular avatar catalog (#145, BK-1)

- **Status:** in-progress
- **Area / files:** `apps/api/src/users/avatar-catalog.ts`, `apps/api/src/users/avatar.dto.ts`, `apps/api/src/users/avatar.dto.spec.ts`, `apps/api/openapi.json`, `docs/profile-avatar.md`, test fixtures
- **Change:** The avatar contract now accepts 23 hair ids and 15 top ids for both bodies; legacy `original`, `tank` and `tshirt` are removed. `avatar-catalog.ts` is the single source of truth and exports the free/paid split for the shop work. The default avatar is `classic-short` hair with `school-sweatshirt`.
- **Reason:** The front merged the modular avatar assets; some styles become paid unlockables in the next tasks.
- **Verification:** Catalog spec written RED first, then GREEN.
- **Next step:** BK-2 paid-style ownership.

## 2026-11-24 — Paid avatar styles in the shop (#145, BK-2)

- **Status:** in-progress
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261124120000_add_avatar_style_shop_kind/`, `apps/api/src/users/` (`shop-avatar-access.ts`, `avatar-styles.*`, controller, module), `apps/api/src/shop/shop.service.ts`, `docs/profile-avatar.md`, `docs/shop.md`, `docs/equipment.md`
- **Change:** New `AVATAR_STYLE` shop kind. Saving an avatar with a paid hair or top now requires a purchase of the matching style item in any classroom (`403` otherwise). New `GET /users/me/avatar/styles` lists every hair and top with `free`, `owned` and `shopItemCode`. Buying a style already owned in another classroom answers `409` without charging; styles stay non-equipable.
- **Reason:** Paid styles must be earned in the shop, not selectable by editing the request.
- **Verification:** DB-backed spec written RED first, then GREEN.
- **Next step:** BK-3 seed catalog, BK-4 contract regeneration.

## 2026-11-24 — Ordered material modules (#142)

- **Status:** completed (pending PR into `develop`)
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261124040907_material_modules/`, `apps/api/src/materials/`, `apps/api/openapi.json`
- **Change:**
  - New `MaterialModule` (classroom-scoped name, optional description, position, soft delete) and a nullable `StudyMaterial.moduleId`, where null means unassigned.
  - `/classrooms/:id/material-modules`: list, create, rename, reorder (`PUT order`) and remove. Removing a module never blocks: its materials return to unassigned.
  - `PATCH /classrooms/:id/materials/:materialId` moves a material; upload accepts an optional `moduleId`; the material list filters by `moduleId` or `unassigned`.
  - Same visibility as materials: staff and students read, teacher-level staff write, parents denied. A module and a material of different classrooms answer 404.
- **Reason:** A flat material list does not scale to courses with hundreds of files.
- **Verification:** DB-backed HTTP spec written RED first, then GREEN, on an isolated temporary database.
- **Next step:** The front issue builds the module UI from the regenerated OpenAPI types.

## 2026-11-20 — Prod alarms and monthly budget (#62)

- **Status:** completed (pending PR into `develop`; nothing applied to AWS)
- **Area / files:** `infra/modules/monitoring/`, `infra/modules/database/outputs.tf`, `infra/modules/runtime_access/`, `infra/modules/delivery_pipeline/`, `infra/envs/prod/`, `infra/deploy/publish-container-health.sh`, `infra/deploy/systemd/app-container-health.*`, `infra/pipeline/scripts/host-deploy.sh`, `scripts/ci/test_container_health.py`, `scripts/ci/test_host_deploy.py`, `infra/README.md`
- **Change:**
  - New `monitoring` module: an SNS alarm topic with email subscriptions, and a USD 40 monthly budget that emails at 50 % and 80 % actual and 100 % forecasted.
  - Alarms: EC2 status checks and CPU; api and realtime container health, where no data counts as unhealthy; RDS free storage. An RDS event subscription reports availability.
  - The host publishes Docker health every minute from a systemd timer that the deploy installs. The instance role may `PutMetricData` only in that namespace.
  - The pipeline plan receives the new variables.
- **Reason:** Prod had no alerts for failures or spend; the estimated spend is about USD 35/month.
- **Verification:** `terraform test` 240 passed with the mock provider; deploy-file Python tests pass. `test_checks.py` cannot run locally because `bash` resolves to WSL; CI runs it. Per-task reviews approved.
- **Next step:**
  - PR into `develop`.
  - After the merge, run a local apply before the pipeline runs, then confirm the email subscriptions and check the timer (`infra/README.md`, Monitoring).

## 2026-11-20 — Per-classroom layout from the desk count (#79)

- **Status:** completed (pending PR into `develop`)
- **Area / files:** `packages/contracts/src/index.ts`, `packages/contracts/src/classroom-layout.spec.ts`, `packages/contracts/src/realtime/generated/`, `apps/realtime/src/rooms/`, `apps/realtime/src/join/`, `apps/realtime/src/internal/classroom-layout-route.ts`, `apps/api/src/internal/realtime/`, `apps/api/src/platform/realtime/`, `apps/api/src/classrooms/classroom-invitations.service.ts`, `rules/api-contracts.md`, `rules/realtime-and-presence.md`, `docs/technical-justification.md`
- **Change:**
  - `buildClassroomLayout(deskCount)` replaces the fixed `CLASSROOM_LAYOUT`: rows of four desks, and a new row with the first desk that does not fit.
  - The join verification carries `deskCount`, capped by `MAX_CLASSROOM_DESKS`.
  - Each room builds its own layout and syncs `deskCount` in its state.
  - After a desk auto-expansion commits, the API pushes the new count through the outbox to `/internal/classroom-layout`. Rooms only grow, and avatars left on a blocked spot move to a free spawn point.
- **Reason:** Desks added by auto-expansion (#22) had no place in the 3D classroom or in server collisions.
- **Verification:** Unit, e2e and DB integration specs (RED then GREEN) on an isolated temporary database; per-task reviews approved.
- **Next step:** PR into `develop`. The front builds its scene from `state.deskCount` with the shared builder (front counterpart).

## 2026-11-20 — Chat inbox summaries and read markers (#124)

- **Status:** in-progress
- **Area / files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261120010000_create_chat_read_markers/`, `apps/api/prisma/seed.ts`, `apps/api/src/chat/chat-inbox.service.ts`, `apps/api/src/chat/chat-inbox.controller.ts`, `apps/api/src/chat/chat.dto.ts`, `apps/api/src/chat/chat-policy.ts`, `apps/api/src/chat/chat.module.ts`, `apps/api/openapi.json`, `docs/classroom-chat.md`
- **Change:** New `GET /chats` returns one summary per classroom where the caller is a current student or staff member (latest visible message with a 120-character preview, unread count, newest activity first), and `PUT /classrooms/{id}/messages/read-marker` advances a per-user, per-classroom marker (`chat_read_markers`) that only moves forward. Hidden messages never show in the preview or count; own messages never count.
- **Reason:** Backend counterpart of the front chat inbox (front issue #51): a page and navbar badge for the chats of all the user's classrooms.
- **Verification:** New unit and DB integration specs (RED then GREEN) on an isolated temporary database.
- **Next step:** Review, then PR into `develop`.

## 2026-11-20 — Review fixes on PR #122 (realtime chat broadcast, #48)

- **Status:** completed (pending CI and merge of PR #122)
- **Area / files:** `apps/api/src/platform/outbox/outbox.dispatcher.ts`, `apps/api/src/platform/outbox/outbox.module.ts`, `apps/api/src/platform/realtime/realtime-events.recorder.ts`, `apps/api/src/platform/realtime/realtime-chat.handler.ts`, `apps/api/src/chat/chat.service.ts`, `apps/api/src/chat/chat.module.ts`, `docs/classroom-chat.md`
- **Change:** Chat events are now dispatched right after the send and hide transactions commit (`OutboxDispatcher.dispatchNow`, best-effort, filtered by event id and type, tracked until settled on shutdown); the interval poll stays as the retry path. `chat:message.hidden` gets a longer retry budget (`CHAT_HIDDEN_MAX_ATTEMPTS`, same as eviction) so a moderated message does not stay visible to connected students during a long realtime outage; `chat:message` keeps the default.
- **Reason:** Review findings on PR #122: delivery waited for the 5 s outbox poll although #48 resolved to call the internal route after commit, and hidden events gave up after about 75 s.
- **Verification:** New unit specs (RED then GREEN); chat, realtime and outbox specs including DB integration on an isolated temporary database with `--pool=threads` (153 passed); lint, typecheck, build, `check_docs.py`; touched files Prettier-clean. Native review approved on each task commit.
- **Next step:** CI green and merge.

## 2026-11-19 — Review fixes on PR #120 (bot materials, #40)

- **Status:** in-progress
- **Area / files:** `apps/api/prisma/migrations/20261119130100_create_bot_configs_and_allowed_materials/`, `apps/api/prisma/seed.ts`, `apps/api/src/materials/materials.service.ts`, `apps/api/src/materials/materials.module.ts`, `apps/api/src/bot/bot-materials.service.ts`, `apps/api/src/bot/bot.module.ts`, `apps/api/src/bot/bot-materials.http.spec.ts`, `docs/bot-materials.md`, `docs/study-material.md`
- **Change:** The merge of `develop` (5d51ce3) renamed the bot migration to `20261119130100_create_bot_configs_and_allowed_materials` so it sorts after `20261119130000_add_mc_submission_answers` (#118). The seed reset now clears allowed bot materials and bot configs before their parents (6ee7211). Removing a study material now deletes its allowed bot rows in the same transaction and de-indexes it after commit; a de-index failure is logged and does not fail the removal (967e8dd).
- **Reason:** Review findings on PR #120: the new RESTRICT foreign keys broke `prisma:seed` once bot data existed, and the #40 criterion "disabled or removed is excluded from retrieval" was only met for disabled materials.
- **Next step:** CI on PR #120, then merge into `develop`.

## 2026-11-19 — Review fixes on PR #118 (multiple-choice evaluator, #47)

- **Status:** in-progress
- **Area / files:** `apps/api/src/activities/activities.service.ts`, `apps/api/src/activities/activities.controller.ts`, `apps/api/src/activities/activities.integration.spec.ts`, `apps/api/openapi.json`, `docs/activities.md`
- **Change:** `PATCH` on a MULTIPLE_CHOICE activity that already has a submission now rejects a different `maxScore` with 409 (field `maxScore`), checked under the same row lock as the questions freeze. Sending the same value stays allowed, and FILE activities keep an editable `maxScore` (33c2f8b).
- **Reason:** Review finding on PR #118: `autoScore` is stored on the 0..`maxScore` scale at submit time, so changing `maxScore` afterwards left stored scores on the old scale.
- **Next step:** CI on PR #118, then merge into `develop`.

## 2026-11-19 — Review fixes on PR #110 (classroom chat, #38)

- **Status:** in-progress
- **Area / files:** `apps/api/src/chat/chat.service.ts`, `apps/api/src/chat/chat.module.ts`, `apps/api/src/chat/chat-send.integration.spec.ts`, `apps/api/src/metrics/`, `apps/api/openapi.json`, `docs/classroom-chat.md`, `apps/api/prisma/migrations/20261118000100_create_classroom_messages/`
- **Change:** The merge of `develop` (d8fedd0) renamed the chat migration to `20261118000100_create_classroom_messages` because of a timestamp collision. A successful send now records the participation metric (`messageCount`) inside the send transaction, using the persisted message instant; rejected sends record nothing. The metrics wording that said `messageCount` stays 0 until chat ships was updated.
- **Reason:** `MetricRecordingService.recordMessage` (#105) was left for chat to call, so `messageCount` never moved.
- **Later fixes:** the seed reset now clears classroom messages (323c0e8), and `ChatService.send` takes a non-blocking advisory lock so a concurrent send for the same user and classroom returns 429 instead of queueing and pinning pooled connections; the concurrency tests assert invariants (at most five persisted, rejections persist nothing) and a new test holds the lock from another connection.
- **Next step:** CI on PR #110 (the new integration test needs PostgreSQL and was not run locally), then merge into `develop`.

## 2026-11-19 — Review fixes on PR #107 (student inbox, #29)

- **Status:** in-progress
- **Area / files:** `apps/api/src/submissions/submission-window.ts`, `apps/api/src/submissions/submission-window.spec.ts`, `apps/api/src/submissions/submissions.service.ts`, `apps/api/src/activities/activities.service.ts`
- **Change:** The submission window rules (FILE format, `opensAt`, `dueAt`, `allowLate`) now live in one pure predicate, `submissionWindow`. The submit endpoint maps its result to the same 409 messages as before, and the student inbox `canSubmit` is that predicate plus "no submission yet". The merge of `develop` (2d62991) also added the Grade snapshot fields to the student-inbox spec seed.
- **Reason:** Review finding on PR #107: `canSubmit` re-implemented `assertAcceptsSubmission`, so the two copies could drift with no test tying them together.
- **Next step:** CI on PR #107, then merge into `develop`.

## 2026-11-19 — Review fixes on PR #106 (streak and badges, #33)

- **Status:** in-progress
- **Area / files:** `apps/api/src/submissions/submissions.module.ts`, `apps/api/src/submissions/submissions.service.ts`, `apps/api/src/gamification/streak.service.ts`, `apps/api/src/gamification/gamification.integration.spec.ts`, `apps/api/prisma/migrations/20261118000000_create_streaks_and_badges/`
- **Change:** Merged `develop` (with #105) into the PR branch, keeping both the metric and the streak dependencies in submissions. An out-of-order qualifying day (transactions committing across the local-day boundary in reverse order) now records the day without moving the chain or the last day backwards. The streak migration is renamed after the #105 migrations so the history stays ordered.
- **Reason:** Review findings posted on PR #106: the chain could reset on a late commit, and the old timestamp sorted before migrations already in `develop`.
- **Exam streak day:** a passed exam now credits the day the student submitted it (`submission.submittedAt`), not the grading day, so late grading or a regrade on another day never adds a day.
- **Next step:** CI on PR #106, then merge into `develop`.

## 2026-11-19 — Revert avatar wardrobe ids and new default outfit (#115)

- **Status:** in-progress
- **Area / files:** `apps/api/src/users/avatar.dto.ts`, `apps/api/src/users/avatar.dto.spec.ts`, `apps/api/src/users/users.spec.ts`, `apps/api/openapi.json`, `docs/profile-avatar.md`
- **Change:** Reverts #116. The contract and the default avatar are back to the previous ids (`afro`/`dreads`/`original`, `hoodie`/`tank`/`tshirt`).
- **Reason:** The new avatar models were rejected and their authoring is on hold, so the merged ids and the new default had no models in the frontend. New users would get a default the frontend cannot render. Stored appearances that fail validation already fall back to the default when read, so no data migration is needed.
- **Next step:** Review and PR to `develop`; reintroduce the ids when the models exist.

## 2026-11-19 — Avatar wardrobe ids and new default outfit (#115)

- **Status:** reverted (merged in #116, reverted because the models are on hold)
- **Area / files:** `apps/api/src/users/avatar.dto.ts`, `apps/api/src/users/avatar.dto.spec.ts`, `apps/api/src/users/users.spec.ts`, `apps/api/openapi.json`, `docs/profile-avatar.md`
- **Change:** Added top `sweater-shirt-tie` (both bodies), male hair `short-messy`/`buzz`/`curls` and female hair `ponytail`/`bob`/`bun` to the avatar contract; the default avatar for users without a stored one is now `short-messy` hair with `sweater-shirt-tie`. Previously accepted ids stay valid, so saved avatars are unaffected; the OpenAPI enums are derived from `BASE_OPTIONS`.
- **Reason:** The frontend avatar rebuild introduces these ids and the new default outfit; the contract must accept them first.
- **Next step:** Review and PR to `develop`; later remove the discarded ids once their replacements land; frontend `api:sync`.

## 2026-11-18 — Keyless deploy pipeline applied and verified (#58, T9)

- **Status:** done (#58 closed; PRs #111, #112 merged)
- **Area / files:** `infra/pipeline/buildspecs/images.yml`, `scripts/ci/test_pipeline_buildspecs.py`, `infra/README.md`
- **Change:** Local `terraform apply` from `develop` created the pipeline (26 resources added, 1 changed); the GitHub connection handshake was completed in the console. The first run failed in Images because CodeBuild runs each buildspec command in its own shell, so `build_and_push` was undefined in the later commands; #112 keeps the function and its calls in one command and adds tests that run each command in a separate shell. The next run, started automatically by the merge to `develop`, succeeded end to end: clean plan, images `release-20261118-6bd8544`, migrations before the stack, `/api/health` and `/realtime/health` return 200, `migrate` runs as `node`.
- **Reason:** Finish #58 by proving the pipeline in AWS, not only in tests.
- **Next step:** none for #58. Spanish diagram docs still describe OIDC deploy.

## 2026-11-18 — Keyless deploy pipeline inside AWS (#58), T1-T8

- **Status:** merged (PR #111); applied and verified in the T9 entry above
- **Area / files:** `docs/technical-justification.md` (D19), `rules/`, `apps/api/Dockerfile`, `infra/deploy/` (`compose.prod.yaml`, `start-app.sh`), `infra/modules/delivery_pipeline/`, `infra/pipeline/` (buildspecs and scripts), `infra/envs/prod/`, `infra/README.md`, `scripts/ci` tests
- **Change:** CodePipeline V2 (`aula-virtual-prod-backend`, QUEUED, push to `develop`) with Source, Plan, manual Approval, Apply of the saved plan, Images and Deploy through SSM Run Command, plus a one-shot `migrate` service that runs before the api. Done so far, one line each:
  - T1 `39129aa`: decision D19 and infrastructure rules.
  - T2 `ee974ec`, `b82b43e`: `migrate` image target, Compose service and ECR repository; start-app.sh migrates before recreating the api.
  - T3 `ceec064`: CodeConnections link, artifact bucket, CodeBuild log group.
  - T4 `d718986`: Terraform plan and apply CodeBuild projects, roles and buildspecs.
  - T5 `8b5de15`: images project that builds and pushes `release-<date>-<sha>` images.
  - T6 `3451c7c`, `79a1108`: SSM deploy stage, host files from the artifact, Caddy recreate on Caddyfile change, host read access to the artifact bucket.
  - T7 `dc3f844`: pipeline wiring and role; apply build timeout raised to 120 minutes.
  - T8 (this commit): `infra/README.md` documents the flow, one-time console handshake, approval, migrations, roll back, permissions and a cost estimate; the manual deploy is now the documented fallback.
- **Reason:** The account SCP denies the GitHub OIDC provider, and production ran with an empty schema because no deploy step ran migrations.
- **Open points for the PR:** nothing is applied yet, so the apply-dependent checks are unverified (ReadOnlyAccess coverage of the plan role, `jq` in the CodeBuild image, `migrate` image running as non-root, the first end-to-end run). The cost estimate (about USD 1.5 per month at 20 runs) uses official prices read on 2026-11-18; whether the Free plan credits cover CodePipeline, CodeBuild and CodeConnections is unknown. Spanish diagram docs still describe OIDC (`docs/diagrams/02-system-architecture/deployment-and-network.md`, `docs/diagrams/05-reference/gaps.md`).
- **Next step:** PR review. Then T9 after merge to `develop`: local apply, console handshake of the GitHub connection, first pipeline run verified end to end.

## 2026-11-17 — Frontend API and realtime base URLs include the Caddy paths (#22)

- **Status:** in review once the PR opens (branch `fix/22-frontend-base-url-paths`; not pushed yet)
- **Area / files:** `infra/envs/prod/` (`main.tf`, `variables.tf`, `tests/frontend_hosting.tftest.hcl`), `infra/modules/frontend_hosting/variables.tf`, `infra/README.md`
- **Change:** The derived build variables are now `VITE_API_BASE_URL=https://<host>.sslip.io/api` and `VITE_REALTIME_URL=wss://<host>.sslip.io/realtime`, the routes Caddy serves with the prefix stripped (`infra/caddy/Caddyfile`). The validations in the prod root and the Amplify module accept an https (wss) base URL with an optional path, and still reject http/ws, a trailing slash, a query, a fragment, whitespace and dot-only segments. Error messages and descriptions say "base URL" instead of "origin". Tests cover the new defaults, overrides with and without a path, and the rejections; `terraform test` has 164 passing tests in `envs/prod`.
- **Reason:** On the live host `POST /auth/login` returns 404 and `POST /api/auth/login` returns 400, so the deployed frontend could not reach the API or realtime service.
- **Open points for the PR:** the `VITE_*` values are compiled into the bundle, so the fix only reaches users after a new Amplify build.
- **Next step:** merge, apply from `develop`, start an Amplify build with `aws amplify start-job --job-type RELEASE`, then smoke check login and realtime from the Amplify URL.

## 2026-11-17 — Review fixes on the grading PR (#98, issue #32)

- **Status:** in review (fixes applied on Luis's branch `feat/32-grade-submissions`; not pushed yet, waiting on the decision owner's OK)
- **Area / files:** `apps/api/src/grades/`, `apps/api/src/points/points-ledger.service.ts`, `apps/api/src/http/` (`conflict.ts`, `iso-string.ts`), `apps/api/src/prisma/unique-violation.ts`, `apps/api/prisma/` (`create_grades` migration edited in place), `apps/api/openapi.json`, `docs/grading.md`, `docs/technical-justification.md` (D18), `rules/activities-and-grading.md`, `rules/points-and-shop.md`, `rules/data.md`
- **Change:** Merged `develop` (`1feba33`, `3a5a07f`; the grading decision was renumbered D17 -> D18 because `develop` took D17 for equipment). Applied the review decisions: D1 weight snapshot on `Grade` reused on regrade (`93bd11f`), D2 `409` for grading or regrading a departed student plus a queue that lists only active students (`7c76a4b`), D3 `score` validated against the activity `maxScore` when set or changed (`b0b1854`), D4 downward regrades compensated at most by the available balance with `GradeRevision.pointsUnrecovered` and a net `Grade.pointsAwarded` (`9f5234c`), then a fix so waived points are never collected by a later regrade (`347efe3`). Applied the remaining review suggestions (`8facc5b`..`38e296a`): `P2002` mapped to `409` only for the submission unique, `-gradedAt` queue order with ungraded last, identical regrade as a no-op, `pointTransactionId` doc wording, shared helpers, required grade weights, and ledger reasons showing `score/maxScore`. Rewrote D18 and aligned `docs/grading.md` and the rules.
- **Reason:** Regrades could move points with no score change, grading departed students depended on the score, scores ignored `maxScore`, and a downward regrade was blocked once points were spent; the grading to ledger bridge has to be predictable for the gamification to be trusted.
- **Verification:** Focused suites per task passed (grades 51/51 after the last code task; 452 across grades, points, openapi and config). The local Windows run has known flakes that also fail on the base branch (login 500 and two ledger concurrency specs, "Unable to start a transaction"); CI run 44110824929 on the merge commit was green 3/3 on Linux. Migrations apply cleanly on a fresh database and `prisma migrate diff` reports no difference. Native review on the two largest slices (T5, T6) was approved with only non-blocking advisories.
- **Open points for the PR:** The `create_grades` migration was edited in place (unmerged), so local databases built from the old version need `prisma migrate reset`. Accepted residual race: a zero-point or feedback-only grade can land while the student leaves concurrently. Waived points are a deliberate loss to the ledger. Deferred advisories: the `P2002` target shape is only unit-tested, and the `gradedAt` ordering tests could set explicit timestamps. The seed does not clear `ActivityMetric`, `Notification`, `NotificationDelivery` and `OutboxEvent` (pre-existing on `develop`, out of scope).
- **Next step:** Push after approval, let CI pass, and obtain teammate approval and merge on PR #98.

## 2026-11-16 — ECR and EC2 Docker Compose deployment for api and realtime (#61)

- **Status:** completed (PR #102 and #103 merged into `develop`; deployed to AWS on 2026-11-17)
- **Area / files:** `infra/modules/registry`, `infra/modules/app_config`, `infra/modules/storage`, `infra/modules/runtime_access`, `infra/envs/prod/` (`main.tf`, `outputs.tf`, `variables.tf`, `example.tfvars`, `tests/`), `infra/scripts/seed-app-secrets.sh`, `infra/deploy/` (`compose.prod.yaml`, `start-app.sh`, `systemd/`), `scripts/ci/` (`test_seed_app_secrets.py`, `test_compose_prod.py`, `test_start_app.py`), `infra/README.md`
- **Change:** Added immutable ECR repositories for `api` and `realtime` with scan on push and a lifecycle policy (untagged 7 days, `release-*` keep 20, others 30 days). Added empty Secrets Manager containers for `JWT_SECRET`, `INVITATION_TOKEN_KEY` and `INTERNAL_SERVICE_SECRET` (values generated by AWS and loaded once by `seed-app-secrets.sh`, never by Terraform) and SSM String parameters with the non-secret config of each service, including the database connection settings of the api. Added a private, versioned, TLS-only S3 files bucket with `prevent_destroy`. Added an inline policy on the host role (ECR pull, secrets and config reads, files bucket objects, log writes; the ECR login token is the only `*`) and 14-day CloudWatch log groups. Added the production Compose file (Caddy, api, realtime, awslogs) and `start-app.sh`, which injects secrets and config as container environment and builds `DATABASE_URL` for the api only. Added a host-side systemd timer that redeploys the api after the RDS master password rotates, a deploy lock and a state file. Documented the resources, the host role, the one-time seeding, the host layout and manual deploy through Session Manager, rotation, rollback, deleting the bucket, an unverified cost table and the follow-ups in `infra/README.md`. `terraform test` has 141 passing tests in `envs/prod`.
- **Decisions (2026-11-16):** Stacked on `feat/60-rds-postgres`; Terraform owns only AWS resources while the Compose file, Caddyfile and start script live in the repo and reach the host by hand until #58; S3 bucket added to this issue because the API needs `S3_BUCKET` at boot; non-secret config in SSM; log retention 14 days; empty secret containers plus a one-time seed script (mock providers reject ephemeral resources); host-side timer for the password rotation; DB connection settings published in SSM; single PR for the issue.
- **Reason:** The network, host and database existed in code but nothing ran the backend; this makes the API and realtime reachable over HTTPS and WSS and gives the pipeline (#58) the repositories and the host layout.
- **Open points for the PR:** nothing has been applied, so the apply-dependent criteria (images pulled on the host, HTTPS and WSS, seeding, second plan with no changes) are not verified. Cost figures are unverified. `scripts/ci` has Docker-dependent failures locally because the Docker daemon is down (environmental). Follow-ups: `sslmode=verify-full`, automatic rollback, realtime config read after the refresh early exit, script tests for malformed `DB_SECRET_ARN` and `DB_PORT`, redundant `compact()` in `envs/prod/main.tf`, wrong image URI example in the `start-app.sh` header (`<prefix>/api` instead of `<prefix>-api`). CI now installs PyYAML so the Compose structure tests run. #58 must tag deployable images `release-*`.
- **Review fixes (2026-11-17, PR #102):** `allowed_origins` validation now rejects origins the API refuses at startup (`new URL(value).origin === value`): uppercase hosts, the default `:443` port and zero-padded ports. Regression tests cover the three rejections and a canonical origin with a non-default port published unchanged to SSM; `terraform test` has 145 passing tests in `envs/prod`.
- **First apply fix (2026-11-17):** the first `apply` created 39 resources but RDS failed with `FreeTierRestrictionError` because the Free plan account rejects 7 days of backup retention. Added the prod variable `database_backup_retention_period` (default 1 day) wired to the database module, with tests; `terraform test` has 146 passing tests in `envs/prod`.
- **First deploy (2026-11-17):** bootstrap was already applied; `envs/prod` apply created 53 resources and the second `terraform plan` reports no changes. Secrets seeded (`JWT_SECRET`, `INVITATION_TOKEN_KEY`, `INTERNAL_SERVICE_SECRET`: set, values never printed). Images `release-2026-11-17-1` built from `develop` and pushed to both ECR repositories. Deploy files sent to the host with SSM Run Command; `start-app.sh` reported caddy, api and realtime healthy, the refresh timer is active and the state file holds `db_secret_version`, `api_image` and `realtime_image`. Checked from outside: `GET https://16-59-248-180.sslip.io/api/health` returns 200 with a Let's Encrypt certificate, HTTP redirects with 308, `/api/internal` returns 404, the WebSocket upgrade through `/realtime/` returns 101, and the three log groups have streams. `allowed_origins` and `password_reset_url_base` use the `example.tfvars` placeholders. Costs not checked in Billing yet.
- **Next step:** set the real frontend origin and reset URL once the frontend is deployed; #58 automates image builds and deploys.

## 2026-11-16 — Prod RDS PostgreSQL (#60)

- **Status:** completed (PR #101 merged into `develop` on 2026-11-17; nothing applied to AWS)
- **Area / files:** `infra/modules/database/`, `infra/envs/prod/` (`main.tf`, `outputs.tf`, `tests/`), `infra/README.md`
- **Change:** Added the database module and wired it in `envs/prod`. A database security group allows TCP 5432 only from the host security group and has no egress. A DB subnet group uses the private subnets, validated to span two distinct Availability Zones. The RDS instance runs PostgreSQL 16 (automatic minor upgrades) on `db.t4g.micro` with 20 GiB encrypted gp3, single-AZ and not public, with 7 days of backups (point-in-time restore), `deletion_protection`, `prevent_destroy` and a final snapshot `aula-virtual-prod-db-final`. RDS generates the master password in Secrets Manager; Terraform never sees it and the only credential output is `database_master_user_secret_arn`. Other outputs: endpoint, port and database name. Documented the resources, credentials, how #61 will read the secret and build `DATABASE_URL` for the api container only, backups and the point-in-time restore command, deletion procedure and snapshot cleanup, and the cost rows in `infra/README.md`. `terraform test` has 78 passing tests in `envs/prod`.
- **Decisions (2026-11-16):** PostgreSQL 16 to match Docker Compose and CI; `db.t4g.micro`, 20 GiB, single-AZ, 7-day retention; the API uses the master user for the MVP.
- **Reason:** The API cannot start without its database, and #61 needs the endpoint and the secret to deploy it.
- **Open points for the PR:** nothing has been applied, so the apply-dependent criteria (connectivity from the host, second plan with no changes) are not verified. The restore path is documented but not tested. Cost figures are unverified and Free plan eligibility is not checked. A least-privilege application user is a follow-up. The host's permission to read the secret and `DATABASE_URL` belong to #61. Team access to the private database is tracked in #100.
- **Next step:** #61 (deployment); the reviewed `terraform plan` and the first apply happen there.

## 2026-11-16 — Prod network and EC2 host with Caddy config (#59)

- **Status:** completed (PR #99 merged into `develop` on 2026-11-17; nothing applied to AWS)
- **Area / files:** `infra/modules/network`, `infra/modules/host`, `infra/envs/prod/` (`main.tf`, `outputs.tf`, `variables.tf`, `tests/`), `infra/caddy/Caddyfile`, `scripts/ci/test_caddy.py`, `infra/README.md`
- **Change:** Added the prod VPC (`10.0.0.0/16`), one public subnet, private subnets in two pinned Availability Zones, an internet gateway and no NAT. Added a host security group that only allows TCP 443 and 80 from the internet (no SSH), with a test that fails on any other public ingress. Added the EC2 host (`t3.small`, Amazon Linux 2023, encrypted gp3 root volume, IMDSv2 required, Elastic IP, SSM instance profile) whose first-boot script installs Docker and a checksum-verified Docker Compose and writes `done` or `failed` markers, with an output that gives the SSM command to check them. Added the Caddyfile (HTTP to HTTPS, `/api` to the API, `/realtime` to Colyseus with WebSocket, internal paths answer 404) with a 16-test harness. Documented the resources, the interim sslip.io name, the step-by-step plan and apply, Session Manager access, the bootstrap check and an unverified cost estimate in `infra/README.md`. Prod outputs expose the VPC, subnets, instance id, public IP, sslip.io domain, security group id and bootstrap check command. `terraform test` has 48 passing tests in `envs/prod`.
- **Reason:** The RDS (#60) and ECR and Compose deployment (#61) issues need these subnets, host and security group, and the API and realtime service need a single HTTPS/WSS entry point.
- **Open points for the PR:** nothing has been applied, so the HTTPS and WSS, second-plan and Let's Encrypt acceptance criteria are not verified. The cost figures are unverified and not compared with the Free plan credits. Caddy has no ACME contact email configured. Running Caddy and the containers belongs to #61.
- **Review fixes (2026-11-17, PR #99):** Caddy access and error logs replace the Colyseus `sessionId`, `reconnectionToken` and `_authToken` query values with `REDACTED` (request forwarded unchanged), with regression tests for both logs; the WebSocket test now asserts a real `101` handshake and message echo through Caddy; the sslip.io host and `/realtime` path routing decision is recorded as an update to D13; the reviewed `terraform plan` is attached in #61 before the first apply.
- **Next step:** #60 (RDS) and #61 (deployment and first apply).

## 2026-11-13 — File submissions, server side (#30)

- **Status:** in review (PR #89 open into `develop`, waiting on the review blockers; merged `develop` on 2026-11-15 and renamed the migration after `20261113144500_create_point_transactions` landed with PR #87)
- **Area / files:** `apps/api/prisma/` (`Submission` and `SubmissionFile` models, migration `20261115000000_create_submissions`), `apps/api/src/submissions/` (schema and PostgreSQL constraint specs, `submission-file-policy.ts`, module, controller, service, DTOs, `submission-events.ts`, `submission-on-time.handler.ts` and HTTP/integration specs), `apps/api/src/testing/` (`in-memory-storage.ts`, `file-fixtures.ts`), `apps/api/src/http/` (`conflict.ts`, `all-exceptions.filter.ts`), `apps/api/src/access/access-verification.service.ts` (`isActiveStudent`), `apps/api/src/activities/` (`activities.service.ts`, controller docs and specs), `apps/api/openapi.json`, `apps/api/package.json` (`file-type`, `@types/multer`), `docs/submissions.md`, `docs/activities.md`, `docs/technical-justification.md` (D16), `rules/activities-and-grading.md`, `README.md`
- **Change:** T1. Added `submissions` (one row per activity and student, server-set `submitted_at`, `is_late`, client `idempotency_key`) and `submission_files` (unique private `storage_key`, original name, content type, size, position). The MVP allows a single submission per activity and student, with no resubmission. Database `CHECK` constraints back the idempotency key length (1-255), file size (1 byte to 10 MB), position (0-4, at most five files), original name length (1-255) and the content type allow-list (PDF, PNG, JPEG, DOCX). Foreign keys are `RESTRICT`, like the rest of the schema.
- **Reason:** Students need a stored, idempotent submission per activity before the upload endpoint, grading (#32) and streaks can be built on it; enforcing the invariants in PostgreSQL keeps them true even if a service check is missed.
- **T2:** Added the submission file policy: the real type is detected from the bytes with `file-type` (PDF, PNG, JPEG and DOCX only; a plain zip or XLSX is rejected, the client MIME and extension are never trusted), 10 MB per file, 1 to 5 files, names sanitized to 1-255 characters. It returns accepted files or violations mapped to `VALIDATION_FAILED` details, and builds storage keys from ids only. Added an in-memory `StoragePort` with failure injection for tests.
- **T3:** Added `POST /activities/:activityId/submissions` (multipart field `files`, required `Idempotency-Key` header, students only; staff and linked parents get 403, strangers and unknown, draft or deactivated activities get 404). Only published `FILE` activities accept it; a multiple-choice activity, a submission before `opensAt` and a late one with `allowLate = false` are 409 with the reason in the error `details` (new `RequestConflictException`, so the fixed envelope message still hides nothing sensitive). Late with `allowLate = true` is stored with `isLate`. The server clock is read once after a shared activity row lock (it blocks teacher edits but not other students). A retry with the same key returns the stored submission (200) without uploading again; another key after a submission exists is 409, and a racing duplicate resolves the same way, never 500. Files are uploaded before one short transaction and deleted again (best effort, logged) on any failure or lost race. multer limits give 413 for a file over 10 MB and 400 for more than five files, both in the error envelope. OpenAPI regenerated.
- **T4:** Added `GET /activities/:activityId/submissions/me` (the student's own submission, same 404/403 rules as the upload, 404 when nothing was submitted yet) and `GET /submissions/:submissionId` (the submission's student, or teacher-level staff of the classroom: teacher, school Owner or Admin). Another student, a linked parent (parents see the grade of the child, never the files), a non-member, a malformed or unknown id and a deactivated activity all get the same 404. Each file carries a `downloadUrl` signed through the storage port with the configured `STORAGE_SIGNED_URL_TTL` and its `downloadUrlExpiresAt` (ISO UTC); storage and idempotency keys are never returned, and both responses send `Cache-Control: no-store`. Files: `submissions.controller.ts` (new `SubmissionReadController`), `submissions.service.ts`, `submissions.dto.ts`, `submissions.module.ts`, `submissions-read.integration.spec.ts`, `submissions.http.spec.ts`, `apps/api/openapi.json`.
- **T5:** Once any submission exists for an activity, `PATCH` refuses to replace its questions and options and `DELETE` refuses to deactivate it, both with 409 `CONFLICT` and the reason in `details`; title, description and dates stay editable. Both checks run after the same `FOR UPDATE` row lock (deactivate now takes it too), so a concurrent submit holding `FOR SHARE` is either counted or queued behind the commit and then gets 404.
- **T6:** A timely submission (`isLate = false`) now records the outbox event `submission.submitted-on-time` in the same transaction as the row (`submission-events.ts`, `submissions.service.ts`, `submissions.module.ts`, `submission-on-time.handler.ts`, `submissions-events.integration.spec.ts`). The payload is versioned and holds ids and the UTC instant only. No event is recorded for late submissions, idempotent replays or the request that loses a race, and a failure after recording rolls the event back with the submission. The dispatcher counts an event type without a handler as a failed attempt, so a no-op handler acknowledges it until the streak consumer arrives with HU-GAM-002.
- **T7:** Documented the module in the new `docs/submissions.md` (linked from `README.md` and `docs/activities.md`), updated `docs/activities.md` (locks now exist, deactivation takes the row lock), recorded the approved defaults as D16 in `docs/technical-justification.md`, and pointed the decided open items of `rules/activities-and-grading.md` to D16.
- **Reason:** Closes the pedagogical loop opened by #28 and unblocks grading (#32), streaks (HU-GAM-002) and the `submitted` state of the inbox (#29). Defaults approved on 2026-11-13.
- **Open points for the PR:** Not covered: resubmission and history, multiple-choice answers (#47), grading (#32), the streak consumer (HU-GAM-002; the no-op handler acknowledges the event until then and the backfill must read `submissions`), malware scanning, the post-commit connection-loss cleanup edge case, and the multer generic 400 for more than five files. Known flaky specs that also fail on `develop` under load: concurrent login ("independent session"), refresh and password reset concurrency, outbox. `notifications.http.spec` ("filters before pagination") can time out at 5 s right after a full local run on a loaded machine; it passes when run cold.
- **Review fixes (2026-11-15, applied on PR #89):** merged `develop` (PRs #87, #88, #91, and #92) and renamed the migration to `20261115000000_create_submissions`, so it sorts after `20261114000000_create_classroom_shop` (updating the comment in `submission-file-policy.ts` and this tracker). Submission state is now checked before classroom access in `loadSubmittableActivity`, so a linked parent on a draft activity gets `404` instead of `403` and no unpublished activity leaks its existence (new integration tests for `POST` and `GET .../me`). Controller and `docs/submissions.md` wording updated to match.
- **Next step:** Push the synced branch, let CI pass, and obtain final teammate approval/merge on PR #89.

## 2026-11-13 — Publish activities, server side (#28)

- **Status:** completed (PR #86 merged into `develop` on 2026-11-13; the submission locks it left open were added with #30)
- **Area / files:** `apps/api/src/activities/` (module, controller, service, DTOs, specs), `apps/api/src/access/access-verification.service.ts` (`listActiveStudentIds`), `apps/api/src/classrooms/classrooms.module.ts`, `apps/api/prisma/` (`activities`, `questions`, `options` migration `20261113000000_create_activities`), `apps/api/openapi.json`, `apps/api/src/testing/relative-dates.ts`, `docs/activities.md`, `docs/technical-justification.md` (D15), `README.md`
- **Change:** Added activities (TP and exams, file or multiple choice) under `/classrooms/:id/activities`: create, list, read, update, publish and logical deactivation. Staff get a teacher view with `isCorrect`; students get a view without it and only see published activities; linked parents receive 403. Instants are stored in UTC and returned with the school time zone. Updates and publishing lock the activity row, and publishing records one `activity_published` notification per active student (excluding the actor) in the same transaction through the outbox. Database `CHECK` constraints back the score, weight, window and publish invariants. Recorded the approved defaults as D15 and documented the module in `docs/activities.md`. Test fixtures use dates relative to now.
- **Reason:** Activities are the root of the academic domain and unblock the inbox (#29), submissions (#30), auto-graded multiple choice (#47), grading (#32) and points (#31).
- **Open points for the PR:** question edits are not locked after the first submission yet (to be added with #30); study material upload (#46), the realtime `activity:published` event and unpublishing are out of scope. Known flaky specs that also fail on `develop` under load: outbox, concurrent login and refresh, password reset concurrency.
- **Next step:** None; follow-ups continue in #29, #30, #47 and #32.

## 2026-11-10 — Classroom presence and movement, server side (#25)

- **Status:** in-progress (seven work-unit commits on `feat/25-classroom-presence`; PR not opened yet)
- **Area / files:** `packages/contracts/src/index.ts` and `src/realtime/generated/`, `apps/realtime/src/` (`rooms/classroom-room.ts`, `rooms/classroom-state.ts`, `rooms/room-directory.ts`, `presence/`, `movement/`, `time/`, `internal/eviction-route.ts`, `join/`, `config/realtime-config.ts`), `apps/api/src/internal/realtime/` (re-verification, connected-time), `apps/api/src/platform/realtime/` (eviction events and handler), `apps/api/src/auth/` (session revocation events), `apps/api/prisma/` (`activity_metrics` migration), `apps/api/src/config/api-config.ts`, `rules/realtime-and-presence.md`, `rules/api-contracts.md`, `docs/technical-justification.md` (D14), `README.md`, `docker-compose.yml`
- **Change:** Recorded the five realtime decisions approved on 2026-11-10 as D14. The classroom room now keeps one avatar per user shared by up to three connections (the fourth closes with `4002`), moves avatars from validated `avatar:input` intents on a fixed 20 Hz step with a fixed speed and wall and desk collisions (30 messages per second per connection, the excess dropped), holds dropped connections for a configurable window (`RECONNECTION_WINDOW_SECONDS`, default 20) and re-verifies access with the API when they return, reports one aggregate connected time per presence session to a new internal endpoint that adds it to a per-user, per-classroom, per-UTC-day `activity_metrics` row, and evicts users from live rooms (`4001`) when a session is revoked through an outbox event and an internal realtime route. Fixed a latent #24 defect: `client.auth.sessionId` made Colyseus reuse the account session id as the connection id, so two connections of one user collided; it is now `authSessionId`.
- **Reason:** Issue #25 needs the realtime classroom to be authoritative, to survive reconnection and access loss, and to feed the activity metric without writing per movement.
- **Open points for the PR:** the walkable layout (16 by 12 with 13 desks) is a proposal to confirm; close codes `4001` and `4002` also exist in Colyseus (clients must read the close reason); membership removal does not exist yet, so only the recorder hook is in place; the reverse proxy must never route `/internal/*`.
- **Review fixes (native review warnings):** A reconnecting connection now stays held until the API re-verification succeeds, so its `avatar:input` is ignored meanwhile. A definitive denial still closes with `4001` (`access_revoked`), while a verification that could not complete (network, timeout, 5xx, throttling) closes with the new retryable `4100` (`verification_unavailable`), documented in `rules/api-contracts.md` and D14. Eviction outbox events got their own retry budget (12 attempts, about 2.8 hours) with an error log when one is given up on, the eviction client keeps the failure kind and HTTP status and logs them (no identifiers or secrets), and the eviction integration suite is scoped to its own rows so it no longer races with other specs. The `activity_metrics` foreign keys stay `ON DELETE RESTRICT` like every other table, because `rules/data.md` leaves account and classroom deletion open and requires cascades to be policy-defined.
- **Open points for the PR (added):** decide what deleting a user or classroom should do with `activity_metrics` once the deletion policy exists; evictions are still lost after a realtime outage longer than about 2.8 hours (no periodic fallback by decision).
- **PR #80 re-review fix (admission race):** `onJoin` now re-verifies access through the same API check as reconnection (`4001` denied, `4100` unavailable) because the seat reservation replays the cached `onAuth` identity; joins still waiting for that check are tracked and an eviction revokes them, so a revocation delivered between matchmaking and seat consumption cannot be bypassed. Costs one extra API call per join. Real-server regressions in `classroom-admission.e2e.spec.ts`. Follow-up specs hold the API's reverification answer open (test-only gate in the stub API) to prove an eviction delivered during an in-flight admission refuses the join, for session and membership evictions, and that a socket closed meanwhile leaves no avatar or connected time; the two earlier "eviction delivered" specs are renamed because the join re-verification, not the eviction, refuses them. Done with AI assistance.
- **Admission leave hardening:** Colyseus does not call `onLeave` while `onJoin` is pending (it only marks the client `LEAVING`), so `onJoin` now refuses a client that is `LEAVING` after the access check, before any avatar or connected time exists; the unreachable pending-admission revocation in `releaseConnection` was removed. A real-server test covers the socket closing during the check.
- **Next step:** Open the PR into `develop` and ask the team to confirm the layout and the close-code overlap.

## 2026-11-09 — Colyseus skeleton with join authorization through an internal API endpoint (#24)

- **Status:** in-progress (PR #77 review fixes pushed; awaiting re-review)
- **Area / files:** `apps/api/src/internal/realtime/` (controller, `InternalServiceGuard`, DTO, module), `apps/realtime/src/` (`rooms/classroom-room.ts`, `rooms/authenticate-join.ts`, `join/api-join-verifier.ts`, `app.config.ts`), `packages/contracts/` (join options, generated room state), `scripts/check-generated-clean.mjs`, `.github/workflows/ci.yml`, `package.json`, `rules/realtime-and-presence.md`, `rules/authentication-and-session.md`, `docs/technical-justification.md` (D2), `docs/diagrams/`, `README.md`
- **Change:** Added `POST /internal/realtime/join-verification`, which checks the access token and classroom access through the existing session and access services, is authenticated by `x-internal-service-secret` (constant-time compare), is hidden from the public OpenAPI document, and returns the verified identity. Added `ClassroomRoom` (one room per `classroomId`) whose static `onAuth` takes the token from the Colyseus `client.auth.token` (`Authorization: Bearer` on the matchmake request), re-checks `classroomId` on every join path, and rejects with a generic error on a missing token, API denial, error, timeout, or malformed response. Added the `@colyseus/schema` state codegen (`pnpm realtime:codegen`, `realtime:codegen:check`) with a CI step that now fails on modified and on new untracked generated files. Documented the credential transport as an update of D2 (2026-11-09).
- **Reason:** NestJS must be the single authorization service (D2); without the gate a stolen, expired, revoked, or foreign-classroom token could enter a live room. The header path was chosen over join options because it is framework-native, has the same Bearer shape as REST, and keeps credentials out of room options and URLs. Unblocks #25, #48, and #59.
- **Verification:** Tests written first (RED then GREEN) including end-to-end joins against a real Colyseus server; realtime suite 67/67, contracts 3/3. Known flakes: `src/auth/refresh.spec.ts` concurrent reuse-grace test failed once under full-suite load and passes alone 3/3 (auth untouched by this branch); `python -m unittest discover -s scripts/ci` fails on Windows because of the WSL relay and also fails on the base branch.
- **Review fixes (PR #77, reported by Mati):** Linked parents were admitted into the live room because `verifyClassroomAccess` resolves `PARENT` under `requiredRole: 'ANY'`; the join verification now answers `403` for a parent, and `PARENT` was removed from the response DTO and from the realtime `CLASSROOM_ROLES`, so the room also denies it if the API ever returned it (`rules/realtime-and-presence.md`, Join authorization). Added the required "Parent denied a live join" tests on both sides (RED then GREEN). Updated the outdated README note: the frontend `api:sync` now fetches the realtime contracts (front PR #70).
- **Next step:** Team re-review of PR #77. Frontend counterpart in front PR #70 (FD3 update and `api:sync` realtime path, front #71). Infra follow-up: Caddy must never route `/internal/*`.

## 2026-11-08 — PR #76 review fixes: classroom authorization and list contract (#21)

- **Status:** in-progress (fixes pushed to `feat/21-virtual-classroom`; PR #76 awaiting review)
- **Area / files:** `apps/api/src/access/access-verification.service.ts`, `apps/api/src/classrooms/`, `apps/api/src/http/visible-text.ts`, `apps/api/src/users/profile.dto.ts`, `apps/api/src/app.module.ts`, `apps/api/openapi.json`
- **Change:** Merged `develop` into the branch (kept `UsersModule` and `ClassroomsModule`, regenerated OpenAPI). Moved classroom creation and listing authorization into `AccessVerificationService` (`resolveClassroomCreationTarget`, `listAccessibleClassrooms`, shared `deriveClassroomAccessRole`), so detail and list resolve the same role and nothing falls open. Unrelated and nonexistent schools now return the same `404`; `403` only for a student or parent related to that school; a user with several schools must send `schoolId` (`400`); independent teachers can always create their own classroom. Adopted the shared pagination contract on `GET /classrooms` and `GET /me/classrooms` (`page`, `pageSize`, `sort`; `{items,page,pageSize,total}`). Extracted a shared `@VisibleText` validator and applied it to classroom name and subject; an empty `PATCH` body is now `400`. Rejection tests assert that nothing is written. Commits: `19c9acc`, `6bd34b5`, `0b36fef`.
- **Reason:** Review of PR #76 found an existence leak between `403` and `404` (reported by Alejo), authorization duplicated outside the shared service, an arbitrary school picked for multi-school users, and a list contract that diverged from `docs/api-conventions.md`.
- **Next step:** Re-review of PR #76. Team decisions: initial desk count (12), default pet and control states, PR size. Follow-up for the invitation flow: invited learners must not get the `INDEPENDENT_TEACHER` registration path.

## 2026-11-07 — Periodic cleanup of expired auth sessions and tokens (#70)

- **Status:** completed (merged in PR #72)
- **Area / files:** `apps/api/src/auth/` (`auth-data-cleanup.service.ts`, `auth-data-cleanup.scheduler.ts`), `apps/api/prisma/` (cleanup indexes migration), `apps/api/src/config/api-config.ts`, `apps/api/src/openapi/export.ts`, `apps/api/.env.example`, `docker-compose.yml`, `README.md`
- **Change:** Added `AuthDataCleanupService`, which deletes expired sessions (their refresh tokens first, in batches, so the foreign key cascade removes nothing unbounded), rotated refresh tokens older than a retention window unless their session is still live by stored state (so reuse detection survives a shortened `REFRESH_TOKEN_TTL`), and used or expired password reset tokens, in bounded batches without a long transaction, and `AuthDataCleanupScheduler`, an in-process job that runs shortly after startup and then at a fixed interval (skips overlapping runs, never throws out of the timer, not scheduled when `NODE_ENV=test`). Each run logs only counts and duration; a failed run logs the error class and Prisma code, never the message. New variables `AUTH_DATA_RETENTION` (30d), `AUTH_CLEANUP_INTERVAL` (24h, max 7d) and `AUTH_CLEANUP_BATCH_SIZE` (1000), passed through Compose; retention must not be shorter than `REFRESH_TOKEN_TTL`. Added indexes on the filtered timestamp columns.
- **Reason:** Sessions, rotated refresh tokens and reset tokens were never deleted, so the tables grew without bound; rotated tokens are kept for the retention window to preserve reuse detection.
- **Next step:** Open the PR into `develop`. Follow-up: throttling for login and reset request.

## 2026-11-06 — Authentication and session lifecycle (#18)

- **Status:** completed (pending PR review)
- **Area / files:** `apps/api/src/auth/`, `apps/api/prisma/` (`RefreshToken` and `PasswordResetToken` models and migrations), `apps/api/src/config/api-config.ts`, `apps/api/openapi.json`, `apps/api/.env.example`, `docker-compose.yml`, `README.md`
- **Change:** Added login (HS256 access JWT with `sub` and `sid`, opaque refresh token stored hashed), refresh rotation with reuse detection and a configurable `REFRESH_REUSE_GRACE` window, logout, and password reset request and confirm (always `202` on request, outbox event, single-use expiring token, all sessions revoked on confirm). Added the new configuration variables, passed `REFRESH_REUSE_GRACE` through Compose, and documented the session lifecycle in the README.
- **Reason:** Frontend and later stories need authenticated sessions that follow decision D1 and the authentication rule.
- **Next step:** Open the PR into `develop`. Follow-ups: throttling for login and reset request, cleanup of expired refresh-token rows, and stabilizing flaky concurrency tests (`outbox.spec.ts` SKIP LOCKED, refresh concurrency, register concurrency).

## 2026-11-05 — Platform ports: email, transactional outbox, object storage (#45)

- **Status:** in-progress (implementation and docs done; PR pending)
- **Area / files:** `apps/api/src/platform/` (`email`, `outbox`, `storage`), `apps/api/prisma/` (`OutboxEvent` model and migration), `apps/api/src/config/api-config.ts`, `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`
- **Change:** Added the shared ports that later stories consume. Email: `EmailPort` with an in-memory stub (no provider, gap 7). Transactional outbox: `OutboxWriter.record(tx, ...)` inside the caller's transaction, handler registry and a dispatcher with at-least-once delivery, backoff, per-handler timeout and lease, and `failedAt` on exhaustion. Storage: `StoragePort` with an S3 adapter, key validation, short-lived signed URLs and S3 settings validated in `api-config.ts`. Local MinIO and bucket bootstrap in Compose using Chainguard images pinned by digest, also started in CI. Documented how stories consume each port in the README. MinIO was chosen over LocalStack (S3 only, lighter); the outbox was chosen over direct in-process events (user decision 2026-11-05). Commits: `fa073d0`, `7f966e4`, `2dcfe1b`, `0d8b14b`, `5ed3ed3`.
- **Reason:** #18, #22, #37, #23, #27, #28, #30 and #46 depend on email, domain events and storage; stories depend on interfaces so the provider and the real bucket can be chosen later.
- **Verification:** Tests written first (RED) then GREEN per commit: outbox spec 16/16, storage spec 18/18 against local MinIO, API suite 187 passed with Postgres and MinIO; `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `check_docs.py` and actionlint pass. `scripts/ci` has 13 failures that already exist on the base branch (WSL relay, environment). The MinIO CI step has not run on GitHub Actions yet. `.env.example` lines for the new variables are pending (not editable by the agent).
- **Next step:** Open the PR into `develop`, request review, and add the `.env.example` placeholders for the outbox and S3 variables.

## 2026-11-05 — PR #65 review fixes: seed allowlist and Prisma client in the runtime image

- **Status:** completed
- **Area / files:** `apps/api/prisma/seed.ts`, `apps/api/prisma/seed-guard.ts`, `apps/api/prisma/seed-guard.spec.ts`, `apps/api/Dockerfile`
- **Change:** Replaced the seed denylist (`production`/`staging`) with an allowlist evaluated before any deletion: the seed now runs only when `DATABASE_URL` points to `localhost`, `127.0.0.1`, `::1`, or the compose `postgres` host, and still refuses `production`/`staging`. Error messages show the host only, never credentials. Added unit tests that need no database. In the API Dockerfile the builder now stages only the generated `.prisma/client` output at its original path and the runtime stage copies that, instead of copying the contents of `@prisma+client*` over `.pnpm/`, which overwrote pnpm's hoisted links.
- **Reason:** With `NODE_ENV` unset and `DATABASE_URL` pointing to a real database, the seed would wipe every table; the old Dockerfile copy only worked by accident. Verified by building the image, loading `PrismaClient` in it, and getting `/health` 200 against a throwaway Postgres.
- **Next step:** None

## 2026-11-05 — Move production compute to a single EC2 host (D13)

- **Status:** in-progress (documentation done; pending PR review)
- **Area / files:** `docs/technical-justification.md` (D13, D5, section 5), `master-document.md` (section 7), `rules/` (aws-infrastructure, infrastructure-as-code, realtime-and-presence, architecture), `docs/architecture.md`, `docs/functional-requirements.md` (RNF-008), `docs/diagrams/` (deployment-and-network, core-flows, gaps, README files), `infra/README.md`
- **Change:** Recorded D13: production compute moves from ECS Fargate behind an Application Load Balancer (plus NAT) to one `t3.small` EC2 host running Docker Compose with Caddy (Let's Encrypt TLS), NestJS, and Colyseus; RDS stays a separate managed database; no SSH (SSM Session Manager); deploys through the keyless CodePipeline flow and SSM Run Command. Updated the services, network, identity, delivery, and observability rules, the diagrams, and the Spanish project document to match. Updated D5 and gaps 20 to 23: Bedrock is available on the Free plan but global and geographic cross-Region inference are not supported, so the bot needs an in-Region on-demand model in `us-east-2` (to confirm in the console). Decision approved by Agustin on 2026-11-05.
- **Reason:** The account uses the credit-based Free plan; the fixed hourly cost of an ALB, two Fargate services, and a NAT gateway (roughly USD 60 to 100 per month with RDS, unverified estimate) would exhaust the credits in about 2 to 3 months, while a single host costs roughly USD 10 to 15 per month plus RDS.
- **Next step:** PR review into `develop`; then implement the network, host, and pipeline in backend issues #59 to #62. Decide the domain and DNS name for Let's Encrypt (gap 20) and the in-Region Bedrock model (gap 21).

## 2026-11-05 — OpenAPI document and REST error envelope baseline (#15)

- **Status:** in-progress
- **Area / files:** `apps/api/src/http/`, `apps/api/src/openapi/`, `apps/api/openapi.json`, `.gitattributes`, `.github/workflows/ci.yml`, `docs/api-conventions.md`, `README.md`
- **Change:** Added a global validation pipe (unknown fields rejected, per-field details), a single error envelope with stable codes and `x-request-id` correlation, a JSON request log, pagination and sort conventions, the OpenAPI builder with Scalar at `/docs` outside production, `pnpm openapi:export` with the committed `apps/api/openapi.json`, a CI staleness check, and `docs/api-conventions.md`.
- **Reason:** Frontend and backend need one observable error and list contract, and the committed OpenAPI file (D8, D9) must exist before endpoints are implemented.
- **Next step:** Push the branch, open the PR into `develop`, and get teammate review. Close #15 manually after merge because closing keywords only fire on `main`.

## 2026-11-04 — Terraform skeleton, remote state, and GitHub OIDC role (#16)

- **Status:** completed
- **Area / files:** `infra/bootstrap/`, `infra/envs/prod/`, `infra/README.md`, `.github/workflows/ci.yml`, `scripts/ci/test_checks.py`, `.gitignore`, `docs/technical-justification.md` (D5, D6), `docs/architecture.md`, `docs/diagrams/`, `rules/aws-infrastructure.md`, `rules/infrastructure-as-code.md`
- **Change:** Added a bootstrap root for the hardened S3 state bucket, the `prod` root with an S3 backend using the native lockfile, the GitHub Actions OIDC provider and a `main`-only least-privilege CI role, `terraform test` suites with a mocked provider, a CI job running fmt, validate, and tests per root, and the infra README. Update 2026-11-04: the account assigns `us-east-2` and blocks the OIDC provider through AWS-managed policies, so D5 moved from `sa-east-1` to `us-east-2` and the OIDC provider, role, and policy are gated by `enable_github_oidc` (default `false`); Terraform is applied locally with short-lived `aws login` credentials and the OIDC pipeline deploy is deferred. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** Later infrastructure issues need remote state, keyless pipeline authentication (D6), and validated Terraform.
- **Verification:** `terraform fmt -check`, `validate`, and `terraform test` pass for both roots (bootstrap 3, prod 12); docs checks pass. Applied in `us-east-2` with explicit approval: bootstrap created the state bucket (6 resources) and prod wrote its first remote state (0 resources, OIDC disabled); a second plan of each root shows no changes, and the bucket's versioning and public access block were confirmed with the AWS CLI. The OIDC trust (only `main` can assume the role) is not verified in AWS because the role is not created in this account.
- **Next step:** Open the PR into `develop`. Decide the keyless deploy pipeline (for example CodePipeline with a GitHub connection) in its own issue.

## 2026-11-03 — Typed environment configuration for api and realtime (#12)

- **Status:** completed
- **Area / files:** `apps/api/src/config/`, `apps/realtime/src/config/`, `eslint.config.mjs`, `apps/*/.env.example`, `README.md`, `.gitignore`
- **Change:** Added zod-validated `loadApiConfig` / `loadRealtimeConfig`, fail-fast startup with an aggregated diagnostic, a lint rule against direct `process.env` reads, `.env.example` files, a `.env.*` ignore rule, and a Configuration section in the README. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** Rule `configuration-and-environments.md` requires a typed boundary and clear diagnostics; the apps previously read `process.env` ad hoc and enabled CORS for any origin.
- **Next step:** Open the PR for #12 into `develop`; wire the typed config into persistence and token services as they land.

## 2026-11-02 — Record multiple-choice scope and classroom member directory (D11, D12)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `docs/functional-requirements.md`, `master-document.md`, `rules/` (classrooms-and-roles, communication-and-notifications, activities-and-grading)
- **Change:** Recorded D11: auto-graded multiple choice in activities and exams is MVP Core, while ungraded self-assessed practice quizzes stay MVP Extendido; fixed the requirements wording that listed self-assessed quizzes inconsistently. Recorded D12: `GET /classrooms/:id/members` is readable by every classroom member and returns only user id, display name, classroom role, and avatar summary (no emails, parent links, grades, or points; parents not listed), `404` for non-members, paginated, optional `q` display-name prefix filter. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The requirements contradicted themselves on multiple-choice scope, and the frontend needs a minimal roster for @mention autocomplete (issues #52 backend, #51 frontend).
- **Next step:** Implement the endpoint in #52 and publish its OpenAPI entry first (D9).

## 2026-11-02 — Record contract-first stubs and school time zone for deadlines (D9, D10)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/` (api-contracts, data-and-time, data, activities-and-grading), `docs/architecture.md`, `docs/diagrams/` (gaps, conventions, README files, deployment-and-network)
- **Change:** Recorded D9: the backend publishes each endpoint's DTOs and OpenAPI entry (a `501` stub is allowed) before or with its implementation so the frontend can mock from the contract. Recorded D10: instants stored in UTC, API returns ISO 8601 UTC, each School has a persisted IANA time zone (default `America/Argentina/Buenos_Aires`), the server decides lateness in UTC. Closed gap 16. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The frontend needs to proceed ahead of backend implementation, and deadline display needs one unambiguous time zone for students and teachers.
- **Next step:** Add the School time zone field in the Prisma baseline schema work item.

## 2026-11-02 — Record committed REST and realtime contract artifacts (D8)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/` (api-contracts, architecture, realtime-and-presence), `README.md`, `docs/architecture.md`, `docs/diagrams/` (gaps, realtime-colyseus, deployment-and-network, class-design, README files)
- **Change:** Recorded D8: the backend commits `openapi.json` (CI fails if stale), generates Colyseus room state types with `schema-codegen` and exports message payload types from `packages/contracts`, all committed; the frontend pulls them with `pnpm api:sync`. Closed the open item on realtime type distribution. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** The frontend needs contract changes visible in pull requests and a build that does not depend on a running backend.
- **Next step:** Fix the exact artifact paths and the CI staleness check in the monorepo bootstrap.

## 2026-11-02 — Record client-side token storage

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/authentication-and-session.md`, `docs/diagrams/05-reference/gaps.md`, `docs/diagrams/02-system-architecture/deployment-and-network.md`, `docs/diagrams/04-behavioral/core-flows.md`
- **Change:** Closed the D1 open item: the frontend stores both tokens in `sessionStorage` and sends a bearer header; recorded the backend-side mitigations (short access tokens, rotation, refresh reuse revocation, no cookie authentication). Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** D1 required agreeing client-side storage with the frontend before release; the frontend decision FD1 was taken.
- **Next step:** Implement in #18 (login, refresh, logout).

## 2026-11-02 — Approve D1–D6 and record invitation model (D7)

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `rules/` (classrooms-and-roles, data, authentication-and-session, architecture, api-contracts, aws-infrastructure, infrastructure-as-code), `docs/diagrams/` (gaps, data-model, README files, review-guide, use-cases, class-design), `README.md`
- **Change:** Marked D1–D6 as approved by Agustin (decision owner) on 2026-11-02, without claiming team-wide approval. Recorded D7: email invitations (mandatory for teachers and parents) plus a per-classroom join code that grants only the Student role (hashed, expiry, revocable, optional max uses, rate limited, audited). Updated the invitation and session rows in the data rules. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** RN-02, RF-AUL-002, and HU-AUL-002 allowed a shareable code while the rules allowed only email invitations; the Session entity was still marked open although D1 decided it.
- **Next step:** Decide the join code entity shape in the Prisma baseline schema work item; align `master-document.md` §2.1/§2.2 (still email-only) with D7.

## 2026-11-02 — Add rule routing index for agents

- **Status:** completed
- **Area / files:** `rules/index.md`, `rules/README.md`, `AGENTS.md`
- **Change:** Added a routing index that maps task types and touched areas to the rules to read and when to skip each one; pointed agent instructions and the rules README to it. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** Agents were reading every rule for every task, wasting context; the existing README list describes rules but not when they apply.
- **Next step:** Keep the index in sync when rules are added or renamed.

## 2026-11-02 — Record architecture decisions

- **Status:** completed
- **Area / files:** `docs/technical-justification.md`, `docs/architecture.md`, `rules/` (authentication-and-session, architecture, api-contracts, aws-infrastructure, infrastructure-as-code), `README.md`, `master-document.md`
- **Change:** Recorded six decisions made by Agustin: JWT access plus hashed rotating refresh token, Colyseus `onAuth` verification through an internal NestJS endpoint, pnpm monorepo, OpenAPI with Scalar, `sa-east-1`, and GitHub OIDC for the pipeline. Removed them from the open-decision lists. Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** These open decisions blocked implementation work items.
- **Next step:** Team approval of the six decisions; agree client-side token storage with the frontend; verify Bedrock availability in `sa-east-1`.

## 2026-11-02 — Align remaining docs with the school niche model

- **Status:** completed
- **Area / files:** `docs/architecture.md`, `docs/technical-justification.md`, `rules/classrooms-and-roles.md`, `rules/authentication-and-session.md`, `rules/data.md`, `docs/diagrams/README.md`, `docs/diagrams/05-reference/gaps.md`
- **Change:** Replaced office/room wording with school/classroom roles and entities; stated that the derived design views still describe the earlier office and room model and are pending realignment (the requirement documents are already aligned). Done with AI assistance (Claude Code), reviewed by Agustin.
- **Reason:** These documents contradicted the school niche source of truth.
- **Next step:** Realign `docs/diagrams/` (data model, class design, use cases, flows, deployment) to the school model.

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
