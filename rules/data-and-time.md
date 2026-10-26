# Data Identity, Dates, and Time

Data representations must preserve meaning across API boundaries, storage, and display.

## Identity and optional values

- Resource IDs **MUST** be treated as opaque values; clients **MUST NOT** infer permissions or business meaning from their format.
- Contracts **MUST** distinguish absent, null, empty, and zero values when they have different meanings.
- External data **MUST** be validated at an appropriate boundary before it is used as trusted application data.
- Derived display values **MUST NOT** replace canonical data sent back to the server.

## Dates and time zones

- Contracts **MUST** distinguish an instant, a calendar date, and a local scheduled time.
- Instants **MUST** use an unambiguous timezone-aware representation; formatting for display **MUST NOT** change the represented instant.
- Date-only values **MUST NOT** be shifted by an incidental browser timezone conversion.
- Locale, display formatting, and timezone assumptions **MUST** be explicit for scheduling and date-bound rules.
- The daily briefing uses America/Argentina/Buenos_Aires as specified in the [project document](../master-document.md). Other features **MUST NOT** silently inherit that policy without agreement.
- Frontend clocks **MUST NOT** be the authority for access expiration or once-per-day execution.

## Persistence and verification

- Persistent domain records **MUST** be distinguished from transient presence, movement, and client preferences.
- Database schema ownership remains with the backend; frontend types **MUST NOT** be presented as an approved database schema.
- Date-sensitive changes **MUST** check relevant day boundaries, timezone conversion, and missing values through their public contract.
