# Own profile and base avatar

`GET /users/me` and `PATCH /users/me/profile` read or change only the account identified by the verified Bearer session. The backend owns persistence; frontend rendering and realtime broadcasts are outside #20.

## Quick path

1. Log in through `POST /auth/login`.
2. Send `Authorization: Bearer <accessToken>` on both routes.
3. Read `/users/me`; update the display name. Appearance is read-only in this slice; the avatar-write endpoint follows in the next slice.

The committed [OpenAPI document](../apps/api/openapi.json) is the REST contract distributed to the frontend. Users module maintainers own these endpoints; frontend integration uses its existing `pnpm api:sync` workflow. General errors follow [API conventions](api-conventions.md).

| Route | Request | Successful response (`200`) |
| --- | --- | --- |
| `GET /users/me` | No body | `{ id, email, displayName, avatar }` |
| `PATCH /users/me/profile` | `{ "displayName": "Prof. Ana" }` | Same safe profile shape as GET |

`displayName` is separate from appearance and must contain 1–100 characters after ordinary surrounding-space trimming. Profile validation rejects C0/C1 controls (U+0000–001F and U+007F–009F), including tabs/newlines even at the edges, and Unicode line/paragraph separators (U+2028/U+2029) **before trim can erase them**. A name must contain at least one character other than Unicode whitespace, default-ignorable code points, combining marks or braille blank (U+2800). This rejects invisible-only names without imposing an ASCII/letters-only allowlist: accents, non-Latin scripts, punctuation, emoji, combining marks and joiners within visible names are preserved, not normalized or stripped. This is profile-specific; registration validation is unchanged. Email is read-only here. User IDs are never accepted as mutation fields; query parameters cannot change the acting user. Password hashes, sessions and avatar persistence metadata are never response fields.

## Free base catalogue

The user approved **free body, hairstyle and ordinary base clothing**, reserving accessories for future shop work. IDs match current frontend GLB filenames without extensions, scoped by body. The finite IDs, defaults and palette normalization below are implementation choices, not an approved visual design or proof of in-engine rendering.

| `bodyId` | Compatible `hairId` | Compatible `topId` |
| --- | --- | --- |
| `male` | `afro`, `dreads` | `hoodie`, `tank` |
| `female` | `afro`, `original` | `hoodie`, `tank`, `tshirt` |

| Field | Allowed values |
| --- | --- |
| `hairColor` | `#6C4D48`, `#AF6D63`, `#E5AD58`, `#353849`, `#C77DAA` |
| `clothingColor` | `#5B4F96`, `#75B7DA`, `#F2C85C`, `#EFA5AE`, `#7EBA8B`, `#F4E6D2` |

Colors come from the frontend art-direction Character palette and are returned uppercase. IDs are case-sensitive. Only supported compatible stored appearances are returned. Uniform tint behavior has not been verified.

### Legacy reads and default

An absent configuration row or empty JSON object yields this base response **without writing**:

```json
{
  "bodyId": "male",
  "hairId": "afro",
  "topId": "hoodie",
  "hairColor": "#6C4D48",
  "clothingColor": "#5B4F96"
}
```

Valid existing appearance JSON is projected to these five fields only. Malformed or incompatible stored values also return the default avatar with `200`, plus the constant warning `Unsupported stored base appearance; using default avatar.` The warning contains no user IDs, raw JSON or credentials. Absent/empty values are normal defaults and do not warn. Neither GET nor a display-name PATCH creates, repairs or overwrites stored appearance; a name PATCH can succeed even with unsupported appearance. No migration or automatic repair exists.

### Future shop boundary

`AvatarConfiguration.appearance` stores the **base-only** configuration. Extra legacy keys are excluded by response projection; they are not an equipped-shop contract. Future equipped shop state requires separately modeled, validated storage and ownership checks. No keys, schema or shop APIs for that future state are assumed or implemented here.

## Rejections

- Missing, malformed, expired or revoked credentials: `401 UNAUTHENTICATED`. The merged `AuthModule` global `SessionAuthGuard` protects both routes before DTO validation; `@CurrentUser('userId')` consumes its verified identity. UsersModule adds no second guard/session verification and changes no shared auth behavior.
- Missing/invalid display names and unknown profile fields (including `userId` or email): `400 VALIDATION_FAILED`, with `error.details` entries containing `field` and `messages`. Rejected input does not change either user's data.
- Unsupported stored appearance is a response fallback, not a rejected profile operation. Name updates use the verified identity directly without an appearance pre-read.

## Verification boundary

The focused HTTP integration spec is [`users.spec.ts`](../apps/api/src/users/users.spec.ts). The runner supplies an isolated database; fixtures and cleanup are UUID-scoped. It covers authentication on each route, single session verification, isolation/tampering, exact response envelopes, exhaustive C0/C1 rejection at edges/interior without writes, normal Unicode names, fresh-login persistence, default/fallback behavior without appearance writes and constant privacy-safe warnings. Each test resets only its UUID-scoped fixtures to avoid order dependence. Avatar writes and the ownership adapter remain in dependent #75; integrated leaf tests and independent verification belong to the parent. This is backend evidence only; asset rendering, shop persistence and realtime behavior are not claimed here. The global guard is reused from merged #19, not implemented or modified by this slice.
