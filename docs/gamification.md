# Gamification: study streak and badges

`GamificationModule` implements HU-GAM-002: a daily study streak fed only by real academic events, and catalog-driven, idempotent badge awarding with in-app notifications. It is wired into the root API and exported to producer modules. There is no frontend UI in this repository, the production medal catalog is still an open decision, and the daily-review producer (HU-BOT-003) has no backend bot module yet.

## Streak rules

- Gamification state is derived from the student's activity. The user FKs of `streaks`, `streak_qualifying_days` and `student_badges` use an explicit, limited `ON DELETE CASCADE` (`rules/data.md` deletion policy): they never cascade into user-generated content, and the `BadgeDefinition` catalog FK stays `Restrict` so catalog removal must handle earned badges first.
- A **qualifying event** is a real academic action. Currently wired producers: an on-time submission (`SubmissionsService.submit`, source `ON_TIME_SUBMISSION`) and a passed exam (`GradesService.gradeSubmission` / `regradeSubmission`, source `EXAM_PASSED`). A daily review answer (`DAILY_REVIEW_ANSWERED`) is supported by the service but has no producer yet.
- The **local day** is computed by the server in `America/Argentina/Buenos_Aires` (`rules/data-and-time.md`); instants before `03:00Z` belong to the previous local day. Client-supplied dates are never authoritative.
- The streak counts **at most once per (student, local day)**, regardless of repeated actions, retries or concurrent same-day events: the `streak_qualifying_days` unique constraint elects one writer per day and the streak row is locked before the chain update.
- The chain **continues only when the previous qualifying day is exactly the day before**; any larger gap restarts the current chain at 1. `bestStreak` never decreases.
- A **bare login never counts**: no authentication code path reaches the streak engine.
- Read shows the chain as alive (current) only while the last qualifying day is today or yesterday; otherwise `currentStreak` is 0 while `bestStreak` is preserved. The streak is server-computed and cannot be restored or modified by any client request.

## Badge rules

- `BadgeDefinition` is a catalog of active entries with a `conditionType` (`STREAK_REACHED` = best chain ≥ threshold, `QUALIFYING_DAYS_REACHED` = distinct qualifying days ≥ threshold) and a threshold. `StreakService` evaluates the live state after every qualifying event, inside the producer's transaction.
- Awarding is **idempotent**: `StudentBadge` is unique per (student, badge), the insert uses database-level conflict skipping, and exactly one `badge_awarded` notification is recorded per newly awarded badge, never on replay.
- The seeded test catalog (`streak_3`, `streak_7`, `active_days_5`) is provisional until the real medal catalog decision closes.

## Notification shape

`badge_awarded` notices are classroom-free: `Notification.classroomId` is nullable and the recorder schema requires `studentId === recipientId` with no classroom context. They appear in the recipient's own notification list like any other notice.

## Open decisions (not yet approved by the team)

- **Exam passing threshold**: this implementation uses `score ≥ ceil(0.6 × maxScore)` (`EXAM_PASSING_SCORE_RATIO = 0.6` in `apps/api/src/gamification/streak.service.ts`) as a disclosed default so the exam trigger is usable. It is not a team-approved rule.
- **Medal catalog**: open (issue #33 scope note).
- **Daily review producer**: pending HU-BOT-003 backend work.
- **Grace periods and non-school days**: deferred; every local day currently requires a qualifying event.

## REST quick path

| Request | Success | Behavior |
|---|---|---|
| `GET /gamification/me` | `200 { streak, badges }` | Own data only: `streak.currentStreak`, `streak.bestStreak`, `streak.lastQualifyingDay` (local `YYYY-MM-DD` or null) and earned badges ordered by unlock time (`awardedAt ASC, id ASC`) |

Missing or invalid credentials return `401 UNAUTHENTICATED`. There is no cross-student read and no query parameters; other users (including staff) always see their own zeroed summary.
