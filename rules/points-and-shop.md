# Points, Streak, and Shop (Server Side)

Points are a server-owned ledger. The client never sets a balance, a price, a streak, or an item state; it only requests actions that the server validates and records.

## Authority and scope

- [Master §2.7](../master-document.md#27-puntos-tienda-racha-mascota-y-minijuegos) defines the single currency, the shop, classroom items, streak, pet, mini-games, and medals; [§6.2](../master-document.md#62-canales-y-propiedad-de-los-datos) assigns points, shop, and streak to NestJS/PostgreSQL.
- Grades produce points; see [Activities and grading](./activities-and-grading.md). Access rules come from [Classrooms, roles, and permissions](./classrooms-and-roles.md).
- The live effect of classroom items (for example disabling mini-games) is delivered through [Live classroom tools](./live-classroom-tools.md) and [Realtime and presence](./realtime-and-presence.md).

## Points ledger

- There is a **single currency of points**. Every change is a **PointsTransaction** appended to a ledger: positive for earnings, negative for purchases, and compensating entries for corrections. Entries are immutable; a balance is the sum of a student's entries and **MUST NOT** be a client-writable field.
- The points balance is per student (an individual ledger). A purchase **MUST** only spend points the buyer can use for that item.
- Each entry records the reason and source (for example grade of a submission, purchase, correction, medal) and **MUST** reference its source record so an earning cannot be duplicated: a unique constraint on (source type, source id) **MUST** make the earning idempotent.
- Balance changes and the records that justify them (grade, purchase) **MUST** commit in the same transaction.
- A balance **MUST NOT** go negative. A purchase **MUST** check and debit under a lock or equivalent atomic condition so concurrent purchases cannot overspend.
- Points are earned through graded activities. Other earning sources (streak bonuses, medals) are **open**; any addition requires a recorded decision and its own idempotency rule.
- Parents see only their linked child's points; classmates **MUST NOT** see another student's exact balance unless a decision says otherwise (**open**).

## Connection streak

- The streak counts consecutive days with a **real activity** (for example submitting an activity, completing a review, or another qualifying action list recorded as a decision). A bare login or connection **MUST NOT** extend it.
- The server decides what counts and which day an activity belongs to, using server time and the zone chosen in [Data and time](./data-and-time.md). Client clocks are never authoritative.
- Recording the day's activity **MUST** be idempotent per (student, local day). Concurrent qualifying actions on one day **MUST** count once.
- The streak **MUST** break when the requirement (a real activity in the period) is not met. Grace periods and non-school days are deferred to implementation. The server **MUST** compute it consistently, and a streak **MUST NOT** be restorable by a client request.
- Whether the streak yields points or medals is **open**.

## Shop and items

- The **ShopItem** catalog defines what can be bought, its price, and its kind: **classroom items** (games, upgrades) and **pet accessories**. A catalog change by an administrator or teacher **MUST NOT** alter the price already paid in past ledger entries.
- A **ClassroomItem** is the instance a classroom owns after a purchase. Items **MUST** map to real, working functionality; a catalog entry without an implemented effect **MUST NOT** be purchasable.
- Purchase is one atomic operation: verify authorization, item availability, and balance; debit the ledger; create the classroom item or accessory. A retried request **MUST** be idempotent (for example an idempotency key) and **MUST NOT** charge twice.
- Classroom items are bought by students, debited from the buyer's individual balance; the server **MUST** enforce this ownership rule.
- Prices and effects are server-side data. The client **MUST NOT** send a price.
- Refunds are **open**. If allowed, they are compensating ledger entries, never deletions.
- Items that are consumable versus permanent, stacking, and limits per classroom are **open**.

## Classroom items and mini-games

- Mini-games (for example Tetris, Pong) are classroom items. They **MUST NOT** be playable during class: the teacher disables them at will, and that state is persisted per classroom and enforced by the server whenever a game session or score is requested.
- The disabled state **MUST** hold across reconnection and clients, and the change **MUST** be broadcast live to the classroom; see [Realtime and presence](./realtime-and-presence.md).
- Whether games are disabled by default during scheduled class time, and whether any score or reward is persisted, are **open**. Game scores, if they exist, **MUST NOT** award points unless a decision defines an anti-abuse rule.
- Game logic that runs in the client **MUST NOT** be trusted for rewards.

## Pet

- Each classroom has **one pet**. It is created with the classroom and is a motivational element only. It is **not linked to the AI bot** and has no conversational role.
- Pet accessories are shop items bought with points. The server **MUST** track which accessories the pet owns and which are equipped, and **MUST** reject equipping an unowned accessory.
- Who may purchase and equip accessories is **open**; the rule recorded **MUST** be enforced by the server.
- Pet state is persisted (accessories) and rendered by the client; its live animation is not persisted.

## Medals

- Medals are awarded for achievements. The catalog, the conditions, and whether they carry points are **open**.
- Awarding **MUST** be server-side and idempotent per (student, medal).

## Abuse prevention

- Earning, purchasing, and equipping endpoints **MUST** be rate limited per user.
- The server **MUST** log security-relevant ledger corrections (who, why, reference) without exposing personal data; see [Observability and privacy](./observability-and-privacy.md).
- Teachers or administrators who adjust points manually, if allowed, **MUST** do so through a recorded compensating entry with reason and actor. Whether manual adjustments exist is **open**.
- A student account **MUST NOT** be able to transfer points to another student; transfers are not in scope.

## Verification

Tests **MUST** cover: grade-to-points idempotency; concurrent purchases never overspending; purchase retry without double charge; ledger immutability and compensating entries; a bare login not extending the streak and a real activity extending it once per day; the day boundary; unpurchasable items without an implemented effect; teacher-disabled games enforced after reconnection; accessory ownership checks; and parent visibility limited to a linked child. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Streak grace periods, non-school days, and rewards.
- Additional earning sources, medal catalog, and refunds.
- Default state and rewards of mini-games.
- Visibility of other students' balances.
