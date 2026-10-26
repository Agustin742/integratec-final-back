# Configuration and Environments

Configuration must make environments reproducible without shipping private values to the browser.

## Configuration contract

- Each application **MUST** document its required configuration names, purpose, public/private classification, and whether a rebuild or restart is needed.
- Required missing or invalid configuration **MUST** produce a clear diagnostic rather than silently fall back to a production service.
- Browser configuration **MUST** contain public values only; see [Security](./security.md#secrets-and-configuration).
- The frontend **MUST NOT** contain database credentials, provider secrets, or infrastructure credentials.
- Public configuration **SHOULD** be accessed through a typed, validated boundary instead of unrelated reads throughout feature code.

## Environment isolation

- Local, test, and production endpoints **MUST** be explicit. Tests and examples **MUST NOT** mutate production data.
- Environment templates **MUST** use safe placeholders and remain aligned with the application configuration contract.
- A shared branch name **MUST NOT** be treated as proof that a corresponding deployed environment exists.
- Network endpoints **MUST** follow the transport and origin requirements in [Security](./security.md).
- Environment-specific changes **MUST NOT** require editing committed source to insert credentials.

## Verification

Check startup/build behavior for missing required values and confirm that public builds contain no secrets. Documentation-only configuration proposals **MUST NOT** be described as configured infrastructure.
