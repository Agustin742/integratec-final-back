# Authentication and Session (Server Side)

The backend is the only authority for identity, session validity, and authorization. Baseline requirements remain in [Security](./security.md); this rule adds the server-side lifecycle. The frontend counterpart lives in the frontend repository.

## Authority and scope

- [Master §2.2](../master-document.md#22-roles-permisos-e-invitaciones), [§6.3](../master-document.md#63-autenticación-entre-servicios), and [§8](../master-document.md#8-seguridad-y-calidad-transversal) establish the requirements; account behavior follows the master document. The derived design views in `docs/diagrams/` are proposed design, not authoritative requirements.
- Course requirement R2 ([project requirements](./project-requirements.md)) is mandatory: registration, login, logout, hashing, expiring sessions, protected endpoints, roles, `401`/`403`, and user isolation.

## Credentials and registration

- The login identifier is the email; the display name is separate and may repeat (assumption P-01). Emails **MUST** be normalized and unique.
- Passwords **MUST** be hashed with Argon2 or bcrypt (or an equivalent identity service) with per-password salts; plaintext or reversible storage **MUST NOT** exist. The minimum length is 8 characters without composition rules (assumption P-02).
- Registration **MUST** let the user choose the organization path, **independent teacher** or **school**, and **MUST** create the account together with its initial structure (the teacher's workspace, or the school with the user as Owner) as one atomic operation; a partial result **MUST NOT** remain.
- Teachers and parents invited into an existing school or classroom join through an **email invitation**, and students join through an email invitation or a classroom join code (decision D7); the invitation or code fixes the role and the target. Accepting requires authentication as the invited account and **MUST NOT** let the invitee choose a different role; invitation rules are in [Classrooms, roles, and permissions](./classrooms-and-roles.md).
- Registering without an invitation **MUST NOT** grant any role in an existing school or classroom.
- Login failures **MUST NOT** reveal whether the email or the password was wrong. Password-reset requests **MUST** return an identical response for registered and unregistered emails.
- Responses, logs, and errors **MUST NOT** contain password hashes, reset tokens, or session secrets; see [Observability and privacy](./observability-and-privacy.md).

## Session lifecycle

- **Decision (D1, approved by Agustin on 2026-11-02):** a short-lived JWT access token plus an opaque refresh token stored hashed in the database and rotated on use; see [Technical justification, D1](../docs/technical-justification.md#d1-session-mechanism). The access token **MUST** carry a session identifier that the server checks against the stored session on every protected request, so a revoked session yields `401`. Lifetimes are configuration parameters, not hard-coded values (assumption P-03).
- The mechanism **MUST** satisfy these invariants:
 - Sessions **MUST** expire and the server **MUST** verify expiry on every protected request; client clocks are never authoritative ([Data and time](./data-and-time.md)).
 - Active users **SHOULD** be renewed before expiry without interruption.
 - Logout **MUST** invalidate the session server-side so later requests with the same credential fail with `401`; discarding it on the client is insufficient.
 - A password reset **MUST** invalidate that account's previous sessions.
 - Session secrets or tokens stored server-side **MUST** be stored hashed or otherwise unusable if the database is read.
- Refresh tokens **MUST** be rotated on use. The frontend stores both tokens in `sessionStorage` and sends the access token as `Authorization: Bearer` ([D1](../docs/technical-justification.md#d1-session-mechanism)); the API **MUST NOT** rely on cookies for authentication. Access-token lifetime **MUST** stay short, and reuse of a rotated refresh token **SHOULD** revoke the session.

## Authorization responses

- A missing, malformed, expired, or revoked credential **MUST** yield `401`. A valid credential without sufficient permission **MUST** yield `403`.
- A request that names a resource of another school or classroom **MUST NOT** reveal whether the resource exists. Such requests **MUST** answer `404`, uniformly across the API; `403` applies only to insufficient role on a resource the caller can see (for example a student calling a teacher-only endpoint of their own classroom).
- Authentication and permission checks **MUST** run in guards or equivalent central mechanisms so a new endpoint is protected by default; public endpoints **MUST** be explicitly marked.
- Role and membership **MUST** be read from persisted state per request, not trusted from session contents, so changes apply immediately.

## Realtime authentication

- A Colyseus join **MUST** present a verifiable credential, and the server **MUST** confirm identity and access to the target classroom through NestJS before admission (`onAuth` calls an internal NestJS endpoint; see [Architecture](./architecture.md)); see [Realtime and presence](./realtime-and-presence.md).
- The client sends the access token with the Colyseus SDK (`client.auth.token`), which arrives as `Authorization: Bearer <access token>` on the matchmake request and as the `token` argument of `onAuth`; join options carry only `classroomId`, and the token **MUST NOT** be read from options or URLs (D2 update, 2026-11-09).
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
