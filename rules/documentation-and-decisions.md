# Documentation and Decision Management

Documentation must distinguish approved requirements, proposals, and observed implementation.

## Authority and changes

- Course obligations belong to [Course requirements](./project-requirements.md); overall product scope belongs to the [project document](../master-document.md).
- Permanent engineering constraints belong to [rules](./README.md). Work status belongs to [GitHub Projects](./github-projects.md), not rule documents.
- The expected visual target in [Art direction](./art-direction.md) is agreed. Selecting the rendering technology is a separate, unresolved decision.
- A proposal **MUST NOT** become mandatory because it appears in an example, diagram, generated document, or AI response.
- Conflicts **MUST** be recorded and resolved with the team before the conflicting implementation proceeds. Contributors **MUST NOT** silently choose whichever source is convenient.

## Decision records

- Material architectural or product changes **MUST** record the question, agreed outcome, rationale, important alternatives, affected contracts, and team approval in an accessible repository document or linked issue.
- Open questions **MUST** identify what remains undecided. A decision record **MUST NOT** claim approval that did not occur.
- Exceptions to a rule **MUST** state their scope, reason, approving team decision, and review condition.
- Approved changes **MUST** update affected authoritative documents rather than leave incompatible instructions in place.

## Maintenance and verification

- Documents **MUST** distinguish planned, implemented, and verified behavior.
- Commands and examples **MUST** identify prerequisites and use safe sample data.
- Internal links **MUST** resolve; documented commands **MUST** match available tooling or be explicitly marked as planned.
- Verification follows [Quality and testing](./quality-and-testing.md). Do not duplicate policy text when a link to its authoritative source is sufficient.
