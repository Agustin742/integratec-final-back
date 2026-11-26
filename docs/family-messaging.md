# Private family messaging

Private parent–teacher conversations require an active ParentLink, a currently enrolled child, and a live classroom/school. School management authority alone never grants history, send access, or inbox previews.

## Access

| Caller | History / send | Teacher inbox |
|---|---|---|
| Actual linked parent | Own active link only | No staff access |
| Active classroom teacher | Yes (independent teacher or active classroom TEACHER membership with active school TEACHER membership when school-owned) | Eligible classrooms only |
| School Owner/Admin, including a classroom TEACHER dual role | No staff access | No |
| Child, foreign parent, unrelated teacher | No | No inaccessible threads |

An account that is also Owner/Admin can still participate **as the actual linked parent**, not as school staff. The explicit staff denial is the conservative treatment of the otherwise uncertain Owner/Admin + TEACHER dual role. Independent-teacher classrooms (`independentTeacherId`) grant access to their owner without requiring a separate classroom membership row.

Unauthorized detail requests return `404` before checking adult mode. Authorized participants receive `403` in adult mode; those classrooms never appear in the inbox. Removed children, inactive links, and deleted classrooms/schools remain inaccessible. No parent–child messaging is added.

## Sending and recovery

- `POST /parent-links/:linkId/messages` allows **5 messages per author and thread per rolling 10 seconds**, matching the classroom-chat budget.
- PostgreSQL transaction-scoped, non-blocking advisory admission rejects concurrent sends for the same pair with `429`. A persisted window count includes hidden messages; old messages do not consume the current window. Limits survive service restarts and apply across instances.
- Authorization, admission, counting, and insertion run in one transaction. Rejected requests write no message. The server clock is sampled after admission and persisted as `createdAt`.
- History remains `createdAt ASC, id ASC`. Inbox ordering remains `lastMessageAt DESC NULLS LAST, createdAt ASC, id ASC` with visible-message previews only.
- Existing DTO names and the `STAFF` author wire label remain compatible. Historical authors are not rewritten. Clients should reconcile history before retrying an uncertain send; no idempotency contract is added.

## Verification scope

The family service and real-HTTP PostgreSQL suites cover privacy (including dual roles), participant access, anti-enumeration/adult mode, concurrent admission, expired windows, hidden-message counting, independent author/thread quotas, and chronological ordering. Shared access policy and classroom chat are unchanged.

See [communication rules](../rules/communication-and-notifications.md#parent-messages) and [product scope](../master-document.md#25-vista-de-padres). The approved audit correction narrows private-conversation access; the broader school-management capabilities remain unchanged.
