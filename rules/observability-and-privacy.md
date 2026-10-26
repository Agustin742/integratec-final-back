# Observability and Privacy

Diagnostics should explain failures without turning logs or analytics into copies of private application data.

## Diagnostic content

- Relevant failures **SHOULD** include a stable operation context and a safe correlation identifier when supported by the backend.
- Logs **MUST NOT** include credentials, authorization headers, session tokens, or private message bodies.
- Contributors **MUST NOT** log complete request bodies, responses, or stores by default.
- User-facing errors **MUST** remain separate from internal diagnostics; follow [Feedback rules](./error-handling-and-feedback.md).
- Repeated connection failures **SHOULD** be summarized rather than flood logs.
- Development diagnostics **MUST NOT** introduce unrestricted debug panels or noisy per-frame logging in production.

## Collection and ownership

- New telemetry **MUST** identify its purpose, collected fields, access owner, and retention/deletion policy before collection.
- Analytics or error-reporting providers **MUST NOT** be introduced without team approval and a review of the data sent.
- Screenshots, recordings, and shared diagnostic examples **MUST** avoid real private data.
- Browser diagnostics **MUST NOT** be the sole evidence that the backend authorized or persisted an operation.

## Verification

Exercise representative failures with synthetic data and inspect emitted diagnostics for sensitive values. Unavailable monitoring **MUST** be reported honestly, not described as active.
