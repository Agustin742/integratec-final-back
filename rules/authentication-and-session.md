# Authentication and Session (Server Side)

The backend is the only authority for identity, session validity, and authorization. Baseline requirements remain in [Security](./security.md); this rule adds the server-side lifecycle. The frontend counterpart lives in the frontend repository.

## Authority and scope

- [Master §2.2](../master-document.md#22-roles-permisos-e-invitaciones), [§6.3](../master-document.md#63-autenticación-entre-servicios), and [§8](../master-document.md#8-seguridad-y-calidad-transversal) establish the requirements; account behavior follows the master document. The `docs/` requirement documents still describe the earlier office model and are pending realignment.
- Course requirement R2 ([project requirements](./project-requirements.md)) is mandatory: registration, login, logout, hashing, expiring sessions, protected endpoints, roles, `401`/`403`, and user isolation.

## Credentials and registration

- The login identifier is the email; the display name is separate and may repeat (assumption P-01). Emails **MUST** be normalized and unique.
- Passwords **MUST** be hashed with Argon2 or bcrypt (or an equivalent identity service) with per-password salts; plaintext or reversible storage **MUST NOT** exist. The minimum length is 8 characters without composition rules (assumption P-02).
- Registration **MUST** let the user choose the organization path, **independent teacher** or **school**, and **MUST** create the account together with its initial structure (the teacher's workspace, or the school with the user as Owner) as one atomic operation; a partial result **MUST NOT** remain.
- Students, parents, and teachers invited into an existing school or classroom join through an **email invitation**; the invitation fixes the role and the target. Accepting requires authentication as the invited account and **MUST NOT** let the invitee choose a different role; invitation rules are in [Classrooms, roles, and permissions](./classrooms-and-roles.md).
- Registering without an invitation **MUST NOT** grant any role in an existing school or classroom.
- Login failures **MUST NOT** reveal whether the email or the password was wrong. Password-reset requests **MUST** return an identical response for registered and unregistered emails.
- Responses, logs, and errors **MUST NOT** contain password hashes, reset tokens, or session secrets; see [Observability and privacy](./observability-and-privacy.md).

## Session lifecycle

- **Open decision:** the session mechanism (cookie-based session versus token, lifetime, renewal, and revocation strategy) is not decided. Implementations **MUST NOT** assume one until the team records it per [Documentation and decisions](./documentation-and-decisions.md). The lifetime is a configuration parameter, not a hard-coded value (assumption P-03).
- Whatever mechanism is chosen, it **MUST** satisfy these invariants:
 - Sessions **MUST** expire and the server **MUST** verify expiry on every protected request; client clocks are never authoritative ([Data and time](./data-and-time.md)).
 - Active users **SHOULD** be renewed before expiry without interruption.
 - Logout **MUST** invalidate the session server-side so later requests with the same credential fail with `401`; discarding it on the client is insufficient.
 - A password reset **MUST** invalidate that account's previous sessions.
 - Session secrets or tokens stored server-side **MUST** be stored hashed or otherwise unusable if the database is read.
- If a cookie is used, it **MUST** be `HttpOnly`, `Secure` in production, and have an explicit `SameSite` policy, with CSRF protection appropriate to that policy. If a bearer token is used, its client-side storage **MUST** be agreed with the frontend before release.

## Authorization responses

- A missing, malformed, expired, or revoked credential **MUST** yield `401`. A valid credential without sufficient permission **MUST** yield `403`.
- A request that names a resource of another school or classroom **MUST NOT** reveal whether the resource exists. Such requests **MUST** answer `404`, uniformly across the API; `403` applies only to insufficient role on a resource the caller can see (for example a student calling a teacher-only endpoint of their own classroom).
- Authentication and permission checks **MUST** run in guards or equivalent central mechanisms so a new endpoint is protected by default; public endpoints **MUST** be explicitly marked.
- Role and membership **MUST** be read from persisted state per request, not trusted from session contents, so changes apply immediately.

## Realtime authentication

- A Colyseus join **MUST** present a verifiable credential, and the server **MUST** confirm identity and access to the target classroom through NestJS before admission; see [Realtime and presence](./realtime-and-presence.md).
- Rejected joins and messages **MUST** apply the same principles as `401`/`403` without inventing HTTP codes for WebSocket messages.
- Logout, session expiry, or loss of access **MUST** end the user's live connections.
- Join credentials **MUST NOT** appear in URLs that are logged.

## Roles, minors, and adult mode

- Roles are School Owner, Admin, Teacher, Student, and Parent, scoped to a school or classroom; no global superadmin exists. A user's role in each context **MUST** be read from persisted state per request.
- Student accounts of minors **SHOULD** be created through an invitation issued by the school or teacher, and the data collected **MUST** be limited to what the features require.
- In **adult education mode** a student registers and signs in with their own email and the Parent role is disabled for that classroom: parent invitations and links **MUST** be rejected. For other classrooms, whether a minor student has their own login credentials or is managed through the parent or school account is **open**.
- A Parent account sees only children linked to it; authentication of the Parent gives no access beyond those links.

## Abuse resistance

- Login-attempt limiting and email verification are evolution items; they **SHOULD** be designed so they can be added without changing the session contract.
- Password-reset links **MUST** be single-use and expire.

## Verification

Tests **MUST** cover: no credential, expired credential, revoked credential after logout, insufficient role, and another user's, school's, or classroom's identifiers, for HTTP and for realtime joins. Follow [Quality and testing](./quality-and-testing.md).
