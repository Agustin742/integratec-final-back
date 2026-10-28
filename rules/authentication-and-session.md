# Authentication and Session (Server Side)

The backend is the only authority for identity, session validity, and authorization. Baseline requirements remain in [Security](./security.md); this rule adds the server-side lifecycle. The frontend counterpart lives in the frontend repository.

## Authority and scope

- [Master §2.6](../master-document.md#26-acceso-roles-y-permisos), [§6.3](../master-document.md#63-autenticación-entre-servicios), and [§8](../master-document.md#8-seguridad-y-calidad-transversal) establish the requirements; account behavior is specified by RF-AUT-001 to RF-AUT-010 in the [functional requirements](../docs/functional-requirements.md).
- Course requirement R2 ([project requirements](./project-requirements.md)) is mandatory: registration, login, logout, hashing, expiring sessions, protected endpoints, two roles, `401`/`403`, and user isolation.

## Credentials and registration

- The login identifier is the email; the display name is separate and may repeat (assumption P-01). Emails **MUST** be normalized and unique.
- Passwords **MUST** be hashed with Argon2 or bcrypt (or an equivalent identity service) with per-password salts; plaintext or reversible storage **MUST NOT** exist. The minimum length is 8 characters without composition rules (assumption P-02).
- Registration **MUST** create the account and the user's own office with its main room as one atomic operation; a partial result **MUST NOT** remain.
- Login failures **MUST NOT** reveal whether the email or the password was wrong. Password-reset requests **MUST** return an identical response for registered and unregistered emails.
- Responses, logs, and errors **MUST NOT** contain password hashes, reset tokens, or session secrets; see [Observability and privacy](./observability-and-privacy.md).

## Session lifecycle

- **Open decision:** the session mechanism (cookie-based session versus token, lifetime, renewal, and revocation strategy) is not decided. Implementations **MUST NOT** assume one until the team records it per [Documentation and decisions](./documentation-and-decisions.md). The lifetime is a configuration parameter, not a hard-coded value (assumption P-03).
- Whatever mechanism is chosen, it **MUST** satisfy these invariants:
  - Sessions **MUST** expire and the server **MUST** verify expiry on every protected request; client clocks are never authoritative ([Data and time](./data-and-time.md)).
  - Active users **SHOULD** be renewed before expiry without interruption (RF-AUT-003).
  - Logout **MUST** invalidate the session server-side so later requests with the same credential fail with `401`; discarding it on the client is insufficient.
  - A password reset **MUST** invalidate that account's previous sessions (RF-AUT-006).
  - Session secrets or tokens stored server-side **MUST** be stored hashed or otherwise unusable if the database is read.
- If a cookie is used, it **MUST** be `HttpOnly`, `Secure` in production, and have an explicit `SameSite` policy, with CSRF protection appropriate to that policy. If a bearer token is used, its client-side storage **MUST** be agreed with the frontend before release.

## Authorization responses

- A missing, malformed, expired, or revoked credential **MUST** yield `401`. A valid credential without sufficient permission **MUST** yield `403`.
- A request that names a resource of another office **MUST NOT** reveal whether the resource exists (RF-HAB-011). Whether such requests answer `403` or `404` is **open**; the choice **MUST** be uniform across the API.
- Authentication and permission checks **MUST** run in guards or equivalent central mechanisms so a new endpoint is protected by default; public endpoints **MUST** be explicitly marked.
- Role and membership **MUST** be read from persisted state per request, not trusted from session contents, so changes apply immediately (RF-HAB-006).

## Realtime authentication

- A Colyseus join **MUST** present a verifiable credential, and the server **MUST** confirm identity and access to the target office and room through NestJS before admission; see [Realtime and presence](./realtime-and-presence.md).
- Rejected joins and messages **MUST** apply the same principles as `401`/`403` without inventing HTTP codes for WebSocket messages.
- Logout, session expiry, or loss of access **MUST** end the user's live connections.
- Join credentials **MUST NOT** appear in URLs that are logged.

## Abuse resistance

- Login-attempt limiting and email verification are evolution items (RF-AUT-009, RF-AUT-010); they **SHOULD** be designed so they can be added without changing the session contract.
- Password-reset links **MUST** be single-use and expire.

## Verification

Tests **MUST** cover: no credential, expired credential, revoked credential after logout, insufficient role, and another user's or office's identifiers, for HTTP and for realtime joins. Follow [Quality and testing](./quality-and-testing.md).
