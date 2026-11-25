# Own profile and base avatar

`GET /users/me`, `PATCH /users/me/profile` and `PATCH /users/me/avatar` read or change only the account identified by the verified Bearer session. The backend owns persistence; frontend rendering and realtime broadcasts are outside #20.

## Quick path

1. Log in through `POST /auth/login`.
2. Send `Authorization: Bearer <accessToken>` on all three routes.
3. Read `/users/me`; update the display name or send a complete appearance snapshot.

The committed [OpenAPI document](../apps/api/openapi.json) is the REST contract distributed to the frontend. Users module maintainers own these endpoints; frontend integration uses its existing `pnpm api:sync` workflow. General errors follow [API conventions](api-conventions.md).

| Route | Request | Successful response (`200`) |
| --- | --- | --- |
| `GET /users/me` | No body | `{ id, email, displayName, avatar }` |
| `PATCH /users/me/profile` | `{ "displayName": "Prof. Ana" }` | Same safe profile shape as GET |
| `PATCH /users/me/avatar` | All five fields below | Appearance snapshot only |

`displayName` is separate from appearance and must contain 1–100 characters after ordinary surrounding-space trimming. Profile validation rejects C0/C1 controls (U+0000–001F and U+007F–009F), including tabs/newlines even at the edges, and Unicode line/paragraph separators (U+2028/U+2029) **before trim can erase them**. A name must contain at least one character other than Unicode whitespace, default-ignorable code points, combining marks or braille blank (U+2800). This rejects invisible-only names without imposing an ASCII/letters-only allowlist: accents, non-Latin scripts, punctuation, emoji, combining marks and joiners within visible names are preserved, not normalized or stripped. This is profile-specific; registration validation is unchanged. Email is read-only here. User IDs are never accepted as mutation fields; query parameters cannot change the acting user. Password hashes, sessions and avatar persistence metadata are never response fields.

## Base catalogue and paid styles

Bodies and the listed free styles require no purchase; other hair and top styles require a shop unlock. IDs match current frontend GLB filenames without extensions. The finite IDs, defaults and palette normalization below are implementation choices, not an approved visual design or proof of in-engine rendering.

| `bodyId` | Compatible `hairId` | Compatible `topId` |
| --- | --- | --- |
| `male`, `female` | All 23 hair ids below | All 15 top ids below |

Hair ids: `afro`, `afro-with-headband`, `bob`, `box-braids`, `braid`, `bun`, `buzz-cut`, `classic-short`, `dreads`, `fringe`, `half-up`, `long-curls`, `long-straight`, `long-wavy`, `messy`, `middle-part`, `ponytail`, `short-curls`, `side-part`, `soft-mohawk`, `two-braids`, `two-pigtails`, `wavy`.

Top ids: `basic-tshirt`, `denim-jacket`, `flannel-shirt`, `holiday-sweater`, `hoodie`, `national-team-jersey`, `school-polo`, `school-smock`, `school-sweatshirt`, `shirt-and-tie`, `sweater`, `tank-top`, `track-jacket`, `vest`, `winter-coat`.

Free styles (the rest are shop unlockables, enforced separately): hair `afro`, `bob`, `bun`, `buzz-cut`, `classic-short`, `long-straight`, `middle-part`, `ponytail`, `short-curls`; tops `basic-tshirt`, `school-smock`, `school-sweatshirt`, `tank-top`. The catalog lives in `apps/api/src/users/avatar-catalog.ts`. The legacy ids `original`, `tank` and `tshirt` are no longer accepted.

| Field | Allowed values |
| --- | --- |
| `hairColor` | `#6C4D48`, `#AF6D63`, `#E5AD58`, `#353849`, `#C77DAA` |
| `clothingColor` | `#5B4F96`, `#75B7DA`, `#F2C85C`, `#EFA5AE`, `#7EBA8B`, `#F4E6D2` |

Colors come from the frontend art-direction Character palette, accept either HEX letter case, and are returned/stored uppercase. IDs are case-sensitive. Arbitrary HEX, URLs, accessory fields, and uniforms are rejected. Uniform tint behavior has not been verified.

### Style availability

`GET /users/me/avatar/styles` returns `{ items: [{ styleType, styleId, free, owned, shopItemCode }] }` for every hair id followed by every top id. Free styles are always `owned` with `shopItemCode: null`; paid styles are `owned` after a purchase in any classroom, and `shopItemCode` names the shop item that sells them (or `null` when none is on sale yet). The front uses it to lock or unlock choices in the avatar editor.

### Complete snapshot, not partial merge

Every avatar PATCH requires **all five fields**, including compatible hair and top when changing body. For example:

```json
{
  "bodyId": "female",
  "hairId": "classic-short",
  "topId": "basic-tshirt",
  "hairColor": "#AF6D63",
  "clothingColor": "#F4E6D2"
}
```

The same object is returned after persistence. A fresh login/device reads it in the `avatar` property of `/users/me`.

### Legacy reads and default

An absent configuration row or empty JSON object yields this base response **without writing**:

```json
{
  "bodyId": "male",
  "hairId": "classic-short",
  "topId": "school-sweatshirt",
  "hairColor": "#6C4D48",
  "clothingColor": "#5B4F96"
}
```

Reads project only these five fields. Invalid or missing fields in an object are replaced individually with their defaults; valid body, colors and unrelated styles survive. Unsupported legacy style IDs (`original`, `tank`, `tshirt`) use the free style defaults rather than granting an unlock. Non-object JSON falls back to the complete default. Unsupported values emit the constant warning `Unsupported stored base appearance; using default avatar.` without user IDs, raw JSON or credentials; absent/empty storage does not warn.

Saved paid hair or clothing (including previously free `hoodie`) is displayed only when the user purchased that style in any classroom, including through a now-inactive item. Otherwise only that style becomes the free default. There is no grandfathering or entitlement grant. GET, display-name PATCH and shared member snapshots used for realtime join/reverification and appearance events use the same projection. Reads never rewrite stored appearance or advance its revision. A complete valid avatar PATCH explicitly replaces storage and still rejects unowned paid input with `403`.

### Equipment boundary

`AvatarConfiguration.appearance` stores the **base-only** configuration. Extra legacy keys are excluded by response projection; they are not equipped items. Classroom equipment uses separate storage and ownership checks; see [equipment](equipment.md).

## Rejections and ownership boundary

- Missing, malformed, expired or revoked credentials: `401 UNAUTHENTICATED`. The merged `AuthModule` global `SessionAuthGuard` protects all three routes before DTO validation; `@CurrentUser('userId')` consumes its verified identity. UsersModule adds no second guard/session verification and changes no shared auth behavior.
- Missing/invalid fields, unknown fields (including `userId`, email or accessories), unsupported palette values or incompatible options: `400 VALIDATION_FAILED`, with `error.details` entries containing `field` and `messages`. Rejected input does not change either user's data.
- Unsupported stored appearance is a response fallback, not a rejected profile operation. Name updates use the verified identity directly without an appearance pre-read.
- `AvatarAccessPort.assertCanUse(verifiedUserId, snapshot)` runs before avatar persistence. The adapter (`ShopAvatarAccess`) first checks body compatibility (`400`), then requires ownership of every paid `hairId` or `topId`: the user must hold a `StudentPurchase` of an `AVATAR_STYLE` shop item whose `metadata.styleType`/`styleId` match, in **any** classroom, whether or not the item is still active. Free styles never need a purchase. A missing unlock or an adapter denial prevents the write (`403 FORBIDDEN`).

Example validation envelope (synthetic correlation ID):

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": [{ "field": "topId", "messages": ["topId is not supported for bodyId"] }],
    "correlationId": "synthetic-request-id"
  }
}
```

## Verification boundary

The focused HTTP integration spec is [`users.spec.ts`](../apps/api/src/users/users.spec.ts). The runner must supply an isolated `DATABASE_URL`; fixtures and cleanup are UUID-scoped. Original verification used `profile_test` and `profile_verify` on port `55420`; these historical local names and ports are not test requirements. Current corrections use parent-provisioned task infrastructure, not shared data.

Coverage includes authentication on all three routes, one session verification per authenticated request, isolation/tampering, exact response envelopes, validation without writes, exhaustive C0/C1 rejection at edges/interior, normal Unicode names/joiners, fresh-login persistence, default/fallback without appearance writes, constant privacy-safe warnings, explicit complete avatar replacement, all free options/palette colors and the access-port denial seam. Each test resets only its UUID-scoped fixtures to avoid order dependence. Integrated full-suite checks and independent verification remain parent-owned. This is backend evidence only; asset rendering, shop persistence and realtime behavior are not claimed here. The global guard is reused from merged #19, not implemented or modified by these corrections.
