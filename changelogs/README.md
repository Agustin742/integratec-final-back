# Changelogs — Work Tracking

## Purpose

The `changelogs/` directory provides a lightweight record of work performed by repository contributors, including human developers and AI agents.

Its purpose is to make it easy to understand **who is working on what, what changed, why it changed, and what remains unfinished**, without having to reconstruct context from commits or conversations.

This is a coordination log, not a replacement for Git history, pull requests, issues, or technical documentation.

## Tracker files

Each participant maintains a Markdown tracker, following this naming convention:

```text
changelogs/
├── README.md
└── tracker-[participant-name].md
```

Use a short, stable, lowercase participant name with hyphens when necessary. Do not create a new tracker for every task or session. Work performed with AI assistance is recorded in the corresponding participant’s tracker.

## What to record

Each entry should briefly capture:

- **Date:** when the work took place.
- **Status:** `in-progress`, `completed`, or `blocked`.
- **Area / files touched:** modules, directories, or relevant files involved.
- **Change:** what was added, modified, removed, or investigated.
- **Reason:** why the change was necessary.
- **Next step:** what remains to be done, when applicable.

Use concise descriptions focused on the impact of the work. There is no need to list every line changed or duplicate commit messages.

## When to update

1. **Before starting meaningful work:** create or update an `in-progress` entry so others can see the current focus.
2. **After making significant changes:** update the same entry with the affected areas and the reason for the change.
3. **When stopping or finishing:** mark the entry as `completed` or `blocked`, and record any outstanding work or blockers.
4. **Before editing an area touched by someone else:** review the relevant trackers to understand recent and ongoing changes.

Do not mark work as completed until the described changes have actually been made. If an action was only planned or investigated, state that explicitly.

## Entry format

Add the newest entry at the top of the participant's tracker:

```md
# Tracker — [Participant name]

## YYYY-MM-DD — [Short work description]

- **Status:** in-progress | completed | blocked
- **Area / files:** `path/to/file`, `module-name`
- **Change:** Briefly describe what was done or is being worked on.
- **Reason:** Explain the purpose of the change.
- **Next step:** Describe pending work, or `None` if completed.
```

If multiple changes belong to the same activity, update the existing entry rather than creating unnecessary entries. Start a new entry when the activity or objective changes.

## Rules

- Write tracker entries in **English**.
- Each participant updates **only their own tracker**, except when explicitly coordinating a handoff.
- Keep records factual, short, and readable.
- Record relevant files or modules, not every incidental file touched.
- Never include secrets, API keys, passwords, tokens, or private user information.
- Do not overwrite or delete another participant's history.
- Git commits remain the source of truth for the actual code changes; trackers explain their context and intent.
