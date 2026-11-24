# Classroom shop and purchases

`ShopModule` is wired into the root API. It provides authenticated student endpoints for browsing the classroom shop catalog, viewing personal purchase history, and atomically purchasing items with server-owned prices, availability overrides, and points ledger debits.

## REST endpoints

Send the session access token as `Authorization: Bearer <access token>`.

| Request | Success | Access rules |
| --- | --- | --- |
| `GET /classrooms/:id/shop/items` | `200` `Paginated<ShopCatalogItemDto>` | Active enrolled `STUDENT` only (`403` for staff/non-adult parent; `404` for strangers, deleted context, or adult-mode parents) |
| `GET /classrooms/:id/shop/purchases` | `200` `Paginated<StudentPurchaseDto>` | Active enrolled `STUDENT` only (`403` for staff/non-adult parent; `404` for strangers, deleted context, or adult-mode parents) |
| `POST /classrooms/:id/shop/purchase` | `201` (new) / `200` (replay) `PurchaseResponseDto` | Active enrolled `STUDENT` only (`403`/`404` as above); requires `Idempotency-Key` header |

Query parameters share the [pagination and sorting contract](api-conventions.md#pagination-and-sorting):

- `GET /classrooms/:id/shop/items`: supports optional `kind` (`classroom_item`, `avatar_accessory`, `desk_upgrade`, `pet_accessory`, `avatar_style`) and `sort` over `defaultPrice`, `name`, or `createdAt` (default `createdAt` ascending) with an `id` tiebreaker. Disabled classroom overrides (`isEnabled: false`) and inactive items (`isActive: false`) are omitted. Effective `price` resolves `ClassroomShopItem.priceOverride ?? ShopItem.defaultPrice`.
- `GET /classrooms/:id/shop/purchases`: supports `sort` over `createdAt` (default `-createdAt`, newest first) or `pricePaid` with an `id` tiebreaker.
- Unsupported query parameters, unknown `sort` fields, extra body properties (such as client-supplied `price`, `studentId`, or `balance`), or missing/empty/`>128`-character `Idempotency-Key` headers return `400 VALIDATION_FAILED`.
- Missing or invalid credentials return `401 UNAUTHENTICATED`.

## Purchase invariants and concurrency

- **Catalog implementation guard:** Items with `isImplemented = false` appear in the catalog with `isPurchasable: false` and are rejected on purchase with `409 Conflict` per [points and shop rules](../rules/points-and-shop.md).
- **Classroom overrides:** Per-classroom `ClassroomShopItem` overrides resolve `priceOverride` and `isEnabled`. Items disabled in the classroom (`isEnabled = false`) return `404 NotFound` on purchase. Teacher override management endpoints remain deferred to `HU-GAM-005`.
- **Immutable historical price:** `StudentPurchase.pricePaid` and the linked negative `PointTransaction` preserve the exact price paid at purchase time; later catalog or override price updates never alter historical rows.
- **Unique ownership:**
  - `StudentPurchase` enforces uniqueness on `(classroomId, studentId, shopItemId)` and `(classroomId, studentId, idempotencyKey)`.
  - `ClassroomItem` enforces uniqueness on `(classroomId, shopItemId)` when a `classroom_item` is unlocked (`state: active`); concurrent or duplicate purchases by the same or another student fail with `409 Conflict`.
- **Lock order & idempotent replay:** Inside `prisma.$transaction`, `ShopService.purchase` acquires `FOR UPDATE OF cm` on the student's active `classroom_memberships` row first, checks `StudentPurchase` by `(classroomId, studentId, idempotencyKey)` before calling `PointsLedgerService.debit` (retrying the same `shopItemId` returns `200 OK` with `replayed: true` and no double charge; reusing the key for a different item throws `409 Conflict`), locks `shop_items` `FOR SHARE`, verifies ownership, computes a deterministic SHA-256 ledger key (`shop:<sha256>`), debits points, and inserts `StudentPurchase` (plus `ClassroomItem` when applicable). Any post-debit failure rolls back the entire transaction atomically.
- **Per-user rate limiting:** `ShopPurchaseRateLimiter` enforces a sliding window configured via `SHOP_PURCHASE_RATE_LIMIT_WINDOW` (default `1m`) and `SHOP_PURCHASE_RATE_LIMIT_MAX` (default `20`), returning `429 TOO_MANY_REQUESTS` when exceeded.
- **Avatar styles:** `AVATAR_STYLE` items sell paid hair and tops (`metadata: { styleType: 'hair' | 'top', styleId }`). They are never equipable. A purchase in any classroom unlocks the style for the user's global avatar, so buying a style already owned in another classroom answers `409 Conflict` without charging, and the catalog reports it as `ownedByStudent` and not purchasable. See [Own profile and base avatar](profile-avatar.md).
- **Privacy-safe audit log:** Completed new purchases emit a structured `shop_item_purchased` log with non-PII identifiers (`classroomId`, `studentId`, `purchaseId`, `shopItemId`, `kind`, `pricePaid`).

## Synthetic seeding

`apps/api/prisma/seed.ts` (guarded by `assertSafeToSeed`) resets shop tables (`classroomItem`, `studentPurchase`, `classroomShopItem`, `shopItem`) before `TRUNCATE TABLE "point_transactions"` and seeds synthetic implemented and unimplemented catalog items for local development only. Catalog items are never seeded in SQL migrations or production.

## Verification

Use an explicitly supplied, disposable local PostgreSQL database through `DATABASE_URL` when running integration and HTTP tests:

```bash
pnpm --filter @aula/api prisma:migrate:deploy
pnpm --filter @aula/api prisma:generate
pnpm --filter @aula/api exec vitest run src/shop/shop.spec.ts src/shop/shop.integration.spec.ts src/shop/shop.http.spec.ts src/openapi/openapi.spec.ts --no-file-parallelism
pnpm --filter @aula/api typecheck
pnpm --filter @aula/api build
pnpm exec eslint apps/api/src/shop apps/api/src/app.module.ts apps/api/src/config apps/api/prisma/seed.ts
pnpm exec prettier --check apps/api/src/shop apps/api/src/app.module.ts apps/api/src/config apps/api/prisma/seed.ts
python scripts/ci/check_docs.py
```
