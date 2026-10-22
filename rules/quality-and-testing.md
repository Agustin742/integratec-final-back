# Code Quality and Testing

A change is complete when its intended behavior has been checked, its limitations are visible, and the relevant documentation is current. This rule does not select a framework, test runner, or coverage target.

## Code language

- All project code **MUST** be written in English: identifiers, source filenames, comments, documentation comments, test descriptions, and developer-facing messages.
- Names **MUST** describe their responsibility clearly and follow the established conventions of the relevant language.
- User-facing text **MUST** follow the product's chosen language; English code does not require an English interface.
- External contract names and literal user data **MUST NOT** be translated in ways that break compatibility or change their meaning.
- Commit messages follow [Git workflow](./git-workflow.md#commits). Rule documents follow the language convention in the [rules index](./README.md).

## Implementation and verification

- Contributors **MUST** keep changes focused and respect agreed component and module responsibilities. Unconfirmed technology choices in the project proposal **MUST NOT** be treated as approved architecture.
- A behavior change **MUST** include verification of its expected result and affected existing behavior.
- When a deterministic automated test is practical, contributors **SHOULD** reproduce a bug or express the new behavior in a failing test before implementing the change.
- Authentication, authorization, user-data isolation, and the main CRUD flow **SHOULD** receive automated tests as application code is introduced.
- UI verification **MUST** cover applicable loading, empty, success, validation, and error states. Responsive layout, labels, keyboard access, and contrast **SHOULD** be checked for affected screens.
- Documentation-only changes **MUST** be checked for correct links, examples, and consistency; application tests are not required when no application behavior is affected.

## Definition of done

Before a pull request is ready to merge, its author **MUST** confirm:

- The stated acceptance criteria are met, without unrelated scope changes.
- Applicable configured tests, lint checks, and builds pass; relevant manual checks are recorded.
- Failed, skipped, unavailable, or unconfigured checks are disclosed explicitly. Blockers are resolved before merge.
- Changed behavior, configuration, and commands are reflected in the relevant documentation.
- Security requirements are checked using [Security](./security.md), and AI-assisted work follows [AI usage](./ai-usage.md).
- Relevant work status is updated in the contributor's [tracker](../changelogs/README.md).

## Course compliance

The [course requirements](./project-requirements.md) preserve the mandatory requirements, recommendations, milestones, and evaluation criteria extracted from the course brief, without depending on its PDF. Section 10 of the [project document](../master-document.md#10-cumplimiento-del-enunciado-integrartec-2026) maps those requirements to the proposed product; it is not evidence of implementation.

Contributors **MUST** distinguish mandatory requirements from recommendations and product-specific goals. Final acceptance **MUST** verify the main flow on the public deployment, not only locally. Maintain one compliance mapping rather than duplicating the checklist in every rule.
