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

Valid existing appearance JSON is projected to these five fields only. Unsupported nonempty stored values produce a generic `500 INTERNAL_ERROR`; GET never exposes or overwrites them. No migration or automatic GET repair exists.

## Rejections

- Missing, malformed, expired or revoked credentials: `401 UNAUTHENTICATED`, using the shared `SessionVerifier` before DTO validation.
- Missing/invalid display names and unknown profile fields (including `userId` or email): `400 VALIDATION_FAILED`, with `error.details` entries containing `field` and `messages`. Rejected input does not change either user's data.
- Unsupported nonempty stored appearance: `500 INTERNAL_ERROR`, without exposing or changing the stored JSON. Profile updates check the stored appearance before writing.

## Verification boundary

The focused HTTP integration spec is [`users.spec.ts`](../apps/api/src/users/users.spec.ts). The runner supplies an isolated database; fixtures and cleanup are UUID-scoped. It covers authentication on each route, isolation/tampering, exact response envelopes, validation without writes, fresh-login persistence, legacy read behavior and application wiring. Avatar writes and the ownership adapter follow in the next slice. This is backend evidence only; asset rendering, global guards (#19), shop persistence and realtime behavior are not implemented or claimed here.
