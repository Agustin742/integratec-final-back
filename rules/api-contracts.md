# API and Realtime Contracts

Frontend and backend must agree on observable contracts before either side treats an assumption as integration behavior.

## Ownership and distribution

- Each consumed contract **MUST** have an identifiable backend owner and a frontend integration reference.
- The distribution mechanism between repositories remains undecided. Contributors **MUST NOT** assume a shared workspace, generated SDK, or manually copied type package is already approved.
- Contract decisions **MUST** identify where the authoritative specification lives and how consumers learn about changes.

## Contract content

- Contracts **MUST** specify operation or event names, authentication requirements, input/output shapes, required and nullable fields, and expected failures.
- Lists **MUST** define ordering and, when needed, filtering and pagination behavior rather than rely on client guesses.
- IDs and date values follow [Data and time](./data-and-time.md).
- Realtime contracts **MUST** distinguish commands, acknowledgements, and notifications, including duplicate or out-of-order handling where relevant.
- Frontend adapters **MUST** handle invalid or unsupported responses without silently treating them as valid domain data.
- Mocks **MUST** reflect an identified contract and include relevant failures. A passing mock **MUST NOT** be claimed as proof of backend integration.

## Compatibility and verification

- Producers **MUST** coordinate incompatible changes with consumers before adoption; adding a field **MUST NOT** silently change existing field meanings.
- Verification **MUST** exercise representative success and failure responses through the integration boundary.
- Contract examples **MUST** use synthetic data. Permission and transport obligations remain in [Security](./security.md).
