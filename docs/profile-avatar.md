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

`displayName` is separate from appearance, trimmed before validation, and must contain 1–100 characters (same policy as registration). Email is read-only here. User IDs are never accepted as mutation fields; query parameters cannot change the acting user. Password hashes, sessions and avatar persistence metadata are never response fields.

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

Colors come from the frontend art-direction Character palette, accept either HEX letter case, and are returned/stored uppercase. IDs are case-sensitive. Arbitrary HEX, URLs, accessory fields, and uniforms are rejected. Uniform tint behavior has not been verified.

### Complete snapshot, not partial merge

Every avatar PATCH requires **all five fields**, including compatible hair and top when changing body. For example:

```json
{
  "bodyId": "female",
  "hairId": "original",
  "topId": "tshirt",
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
  "hairId": "afro",
  "topId": "hoodie",
  "hairColor": "#6C4D48",
  "clothingColor": "#5B4F96"
}
```

Valid existing appearance JSON is projected to these five fields only. Unsupported nonempty stored values produce a generic `500 INTERNAL_ERROR`; GET never exposes or overwrites them. A complete valid avatar PATCH explicitly replaces the prior appearance. No migration or automatic GET repair exists.

## Rejections and ownership boundary

- Missing, malformed, expired or revoked credentials: `401 UNAUTHENTICATED`, using the shared `SessionVerifier` before DTO validation.
- Missing/invalid fields, unknown fields (including `userId` or accessories), unsupported palette values or incompatible options: `400 VALIDATION_FAILED`, with `error.details` entries containing `field` and `messages`. Rejected input does not change either user's data.
- `AvatarAccessPort.assertCanUse(verifiedUserId, snapshot)` runs before avatar persistence. Its current adapter admits only compatible free base options. It does **not** simulate purchases or verify shop ownership. Future paid options require a persisted-ownership adapter and an explicitly extended contract; unknown choices remain denied until then. An adapter denial must prevent the write (`403 FORBIDDEN`).

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

The focused HTTP integration spec is [`users.spec.ts`](../apps/api/src/users/users.spec.ts). The runner must supply an isolated `DATABASE_URL`; fixtures and cleanup are UUID-scoped. Verification here used the task databases `profile_test` and `profile_verify` on port `55420`; these local names and ports are not test requirements. It covers authentication on each route, isolation/tampering, exact response envelopes, validation without writes, fresh-login persistence, legacy read behavior and the access-port denial seam. This is backend evidence only; asset rendering, global guards (#19), shop persistence and realtime behavior are not implemented or claimed here.
