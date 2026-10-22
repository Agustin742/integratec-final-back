# Security

Treat browser input as untrusted and keep secrets outside the repository and client bundle. This rule governs frontend work and the security expectations of its integration with the backend; it does not select an authentication provider.

## Secrets and configuration

- Secrets **MUST NOT** appear in source code, commits, logs, screenshots, pull requests, or AI conversations.
- Real environment files **MUST** be ignored by Git. An `.env.example` **MUST** document required variable names using empty values or safe placeholders.
- Frontend configuration **MUST** contain public values only. Environment-variable injection into a frontend build does not make a value secret.
- Dedicated, limited-access demo accounts **MAY** be shared for evaluation as required by the course. Personal credentials, infrastructure credentials, and real user data **MUST NOT** be published.
- If a secret is exposed, contributors **MUST** notify the team and revoke or rotate it promptly. Deleting it in a later commit does not remove the exposure; history cleanup requires explicit coordination.

## Identity, permissions, and data

- Protected frontend routes **MUST** handle missing or expired sessions and redirect unauthenticated users to login.
- The backend **MUST** validate identity, role, and resource ownership or membership for every protected operation. Hidden controls and client-side checks are not authorization.
- Protected APIs **MUST** return `401` for missing or invalid authentication and `403` for insufficient role permissions.
- Users **MUST NOT** gain access to another user's private resources by changing an identifier. Realtime room access and actions **MUST** enforce the same permission boundaries when implemented.
- Passwords **MUST** use an appropriate password hash, never plaintext or reversible encryption. Sessions or tokens **MUST** expire, and logout **MUST** remove access to protected frontend content.
- API responses **MUST NOT** include password hashes, secrets, stack traces, database queries, or internal diagnostics.

## Input, transport, and failures

- Input **MUST** be validated in the frontend for usability and in the backend for integrity and security.
- Database access **MUST** use parameterized queries or a safe ORM/ODM; user input **MUST NOT** be concatenated into executable queries.
- Production traffic **MUST** use HTTPS and, where applicable, WSS. CORS **MUST** allow the authorized frontend origins; wildcard origins **MUST NOT** be used with credentials.
- User-provided content **MUST NOT** be executed or rendered as trusted HTML without an appropriate sanitization strategy.
- Failures **MUST** produce understandable user feedback without disclosing sensitive information.

## Verification and ownership

Frontend contributors **MUST** coordinate backend-dependent requirements with the backend owners rather than claiming frontend checks satisfy them. Verification **MUST** include direct API requests without credentials, with insufficient permissions, and with another user's resource IDs, using isolated test data.

See [Quality and testing](./quality-and-testing.md) for verification reporting and the [course requirements](./project-requirements.md), R2 and R7, for the course requirements.
