# Agent instructions

## Read the project rules first

Before planning, designing, implementing, modifying, or reviewing work in this repository, agents **MUST**:

1. Read [the rules index](rules/README.md).
2. Read the project-wide policies listed there and every rule relevant to the task before acting. Reading the index alone is not sufficient.
3. Consult [the project document](master-document.md) for product scope and agreed decisions. Resolve conflicts with the team instead of silently overriding either source.

The documents in `rules/` are the authoritative source for project conventions. Follow them and link to them rather than duplicating their requirements here.

## Track your work

Agents **MUST** keep the acting participant's tracker current, as defined in [the changelog guide](changelogs/README.md). Work performed with AI assistance belongs in that participant's `changelogs/tracker-<name>.md`; agents **MUST NOT** create per-agent or per-session trackers or edit another participant's history.

1. Before starting meaningful work, add or update an `in-progress` entry.
2. After significant changes, update that entry with the affected areas and the reason.
3. When stopping or finishing, mark it `completed` or `blocked` and record the next step.

Before editing an area someone else touched recently, review the relevant trackers.

## Local work plans

The root `odd/` directory contains local agent work plans. Keep it untracked; do not commit its contents or force-add ignored files.
