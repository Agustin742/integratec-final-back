# Avatar and desk equipment

`EquipmentModule` is wired into the root API. It provides authenticated student endpoints for reading the classroom-scoped equipment state and equipping/unequipping purchased items on the avatar (head, face, back) and the desk decoration. Equipment state is classroom-scoped per [D17](technical-justification.md#d17-classroom-scoped-avatar-and-desk-equipment): a purchase made in one classroom can never be equipped in another.

## REST endpoints

Send the session access token as `Authorization: Bearer <access token>`.

| Request | Success | Access rules |
| --- | --- | --- |
| `GET /classrooms/:id/me/equipment` | `200` `EquipmentStateDto` | Active enrolled `STUDENT` only (`403` for staff/non-adult parent; `404` for strangers, deleted context, or adult-mode parents) |
| `PUT /classrooms/:id/me/equipment/:slot` | `200` `EquipmentStateDto` | Active enrolled `STUDENT` only (`403`/`404` as above) |

- `:slot` is one of `head`, `face`, `back`, `desk_decor`; any other name (including wrong casing) returns `404 NOT_FOUND`.
- `PUT` takes a strict body `{ shopItemId: string | null }`: a UUID equips that item in the slot, `null` (or an absent field) unequips the slot. Unknown body fields return `400 VALIDATION_FAILED`.
- `EquipmentStateDto.slots` maps every known slot to its equipped purchase projection (`slot`, `shopItemId`, `shopItemCode`, `shopItemName`, `kind`) or `null` when empty.

## Equip invariants

- **Ownership proof (AC2):** equipping requires a `StudentPurchase` for `(classroomId, studentId, shopItemId)`. A shop item that exists but was not purchased in this classroom returns `403 Forbidden` and nothing changes; the check runs inside the equip transaction, so a rejected operation never persists state.
- **Slot compatibility:** the item's `kind` must be `AVATAR_ACCESSORY` for `head`/`face`/`back` or `DESK_UPGRADE` for `desk_decor`, and `ShopItem.metadata.slot` must declare the requested slot; otherwise the API returns `409 Conflict`. `CLASSROOM_ITEM` and `PET_ACCESSORY` kinds are not equipable.
- **Idempotency:** equipping the same item twice keeps one `EquippedItem` row (unique `(classroomId, studentId, slot)`); equipping a different item replaces the slot content; unequipping an empty slot is a no-op.
- **Unknown resources:** an unknown shop item UUID returns `404 NOT_FOUND` (inactive items that the student actually purchased remain equipable; the purchase is the entitlement).
- **Per-user rate limiting:** `EquipmentRateLimiter` protects `PUT` with a sliding window configured via `EQUIP_RATE_LIMIT_WINDOW` (default `1m`) and `EQUIP_RATE_LIMIT_MAX` (default `20`), returning `429 TOO_MANY_REQUESTS`. Read-only `GET` is never rate limited.
- **Privacy-safe audit log:** equip and unequip operations emit a structured `shop_item_equipped` / `shop_item_unequipped` log with non-PII identifiers (`classroomId`, `studentId`, `slot`, `shopItemId`).

Out of scope (follow-ups): rendering of equipped items and the inventory UI (frontend repository), the realtime broadcast of the new look, and equipping pet accessories.

## Verification

Use an explicitly supplied, disposable local PostgreSQL database through `DATABASE_URL` when running integration and HTTP tests:

```bash
pnpm --filter @aula/api prisma:migrate:deploy
pnpm --filter @aula/api prisma:generate
pnpm --filter @aula/api exec vitest run src/equipment/equipment.integration.spec.ts src/equipment/equipment.http.spec.ts src/openapi/openapi.spec.ts --no-file-parallelism
pnpm --filter @aula/api typecheck
pnpm --filter @aula/api build
pnpm exec eslint apps/api/src/equipment apps/api/src/app.module.ts apps/api/src/config
pnpm exec prettier --check apps/api/src/equipment apps/api/src/app.module.ts apps/api/src/config
python scripts/ci/check_docs.py
```
