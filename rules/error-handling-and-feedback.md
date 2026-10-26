# Error Handling and User Feedback

Users must be able to tell whether an operation is pending, confirmed, rejected, or uncertain.

## Observable states

- Data-driven views **MUST** distinguish loading, empty results, errors, and available content.
- Refresh failures **SHOULD** preserve usable existing content while identifying that it may be stale.
- Validation, authentication, permission, connection, and unexpected failures **MUST** lead to appropriate feedback rather than one misleading generic outcome.
- Expected cancellation **MUST NOT** be displayed as an operation failure.
- Feedback **MUST NOT** expose internal details; diagnostic policy belongs to [Observability](./observability-and-privacy.md).

## Recovery

- Errors **MUST** explain an available next action when one exists, without promise of automatic recovery that is not implemented.
- Retries **MUST** be bounded. Writes **MUST NOT** be retried automatically unless their contract prevents duplicate effects.
- A timeout **MUST NOT** be assumed to prove that a write did not happen; recovery **MUST** reconcile the outcome before duplicating it.
- Optimistic failures **MUST** roll back or explicitly reconcile pending UI and preserve useful input.
- Background refreshes **SHOULD NOT** repeatedly interrupt the user with identical notifications.
- A failed visual environment **SHOULD** leave an understandable fallback and access to essential alternative interfaces where feasible.

## Verification

Check initial failure, failure after data is already visible, pending writes, uncertain outcomes, and recovery paths relevant to the changed feature. UI announcements follow [Accessibility](./ui-and-accessibility.md).
