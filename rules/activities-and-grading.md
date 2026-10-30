# Activities and Grading (Server Side)

Activities, submissions, and grades are persisted, classroom-scoped records. The backend decides who may create, submit, and grade them, and is the only place where a grade becomes points.

## Authority and scope

- [Master §2.3](../master-document.md#23-herramientas-del-profesor), [§2.4](../master-document.md#24-funciones-del-alumno), and [§2.6](../master-document.md#26-actividades-y-calificaciones) define activities, formats, grades, and the activity metric; §10 (R5) requires persisted CRUD over a domain resource.
- Permissions come from [Classrooms, roles, and permissions](./classrooms-and-roles.md); this rule does not redefine them. Point accounting is in [Points and shop](./points-and-shop.md).
- [Master §6.2](../master-document.md#62-canales-y-propiedad-de-los-datos) assigns persistence to NestJS/PostgreSQL and the subsequent live notification to Colyseus.

## Activities

- An **activity** belongs to exactly one classroom and has a **type** (homework/practical work, "TP", or exam) and a **format** (file submission or multiple choice). Type and format are independent and **MUST** be validated against a closed set.
- Only staff with teacher-level authority over the classroom (the teacher, or the school Owner or Admin) may create, edit, publish, and delete activities. Students and parents **MUST NOT** see unpublished activities.
- The server **MUST** derive the classroom from the stored activity, not from client-supplied identifiers.
- Visible states for an activity's work are **pending**, **submitted**, and **graded**. The state of a student's work is derived from the Submission and Grade records, not stored in a separate field that can disagree with them.
- Title, description, and due date **MUST** be validated and bounded. Limits are **open** and **MUST** be recorded in the contract before release. Due-date semantics follow [Data and time](./data-and-time.md) and **MUST NOT** be shifted by incidental conversion.
- Editing a published activity after submissions exist, and deleting one with submissions, are **open**. Until decided, deletion **MUST** be refused when submissions or grades exist.

## Exams

- An exam has a start and an end (or a duration); the server decides whether it is **in progress** from persisted values and server time, never from a client clock.
- While an exam is in progress for a classroom, the AI bot **MUST** be unavailable to the students taking it; see [AI bot and daily briefing](./ai-bot-and-daily-briefing.md). The bot check **MUST** read the same exam-in-progress state as this rule so both agree.
- Whether an exam applies to the whole classroom or to selected students is **open**; the default assumption is the whole classroom.
- A submission after the exam ends **MUST** be rejected or flagged as late according to a recorded decision (**open**).

## Multiple-choice format

- Questions and options belong to the activity. Each question has at least two options and the correct option(s) are stored server-side.
- Correct answers **MUST NOT** be returned to students before grading is allowed, and **MUST NOT** be included in any response a student can read while an attempt is open.
- The server grades multiple-choice automatically, from the persisted answers; the client **MUST NOT** supply the score. Whether the teacher may override an automatic grade is **open**.
- Single versus multiple correct options, partial credit, and the number of attempts are **open**; a single attempt is the default assumption.

## File-submission format

- A submission references one or more files stored in object storage through NestJS. The server **MUST** validate file type (allow-list), size, and count, and **MUST NOT** trust client-declared MIME types; see [Security](./security.md) and [AWS infrastructure](./aws-infrastructure.md).
- Files are private. Access is by short-lived signed URLs issued only after an authorization check on the submission's classroom. Direct public object access **MUST NOT** exist.
- The exact limits and any malware scanning are **open**.

## Submissions

- A student may submit only to an activity of a classroom where they are enrolled, only when it is published, and subject to its deadline policy.
- Author and timestamps are set by the server. There is at most one current submission per (activity, student); resubmission rules are **open**.
- A submission is readable by its student, by staff with authority over the classroom, and, as a grade only, by the student's linked parents. A student **MUST NOT** read other students' submissions.
- Submitting **MUST** be idempotent for a retried request (for example through an idempotency key) so a network retry does not create duplicates.

## Grades and weighted points

- Only staff with authority over the classroom may grade. The server **MUST** reject a grade for a submission outside the actor's authority and **MUST** validate the value against the activity's grading scale (scale and bounds are **open**).
- A grade belongs to exactly one submission; regrading updates it and **MUST** keep a history sufficient to correct points (see below).
- **A grade is converted to points on the server, weighted by activity type.** An exam is worth more than a TP; the weights are configuration values, not constants in code, and their numeric values are **open**.
- The conversion and the resulting ledger entry **MUST** happen in the same transaction as the grade, so a grade without its points, or points without a grade, cannot persist.
- Publishing the grade to the student and linked parents, and notifying them, happens after the commit; see [Communication and notifications](./communication-and-notifications.md).
- Regrading **MUST** adjust points through compensating ledger entries, never by editing past ones; see [Points and shop](./points-and-shop.md).
- A grade for a student who has left the classroom is preserved and attributed.

## Review workflow for teachers

- The teacher's review list **MUST** be paginated with a stable order and filterable by activity and state, scoped to classrooms the actor has authority over.
- Bulk grading, if provided, **MUST** apply each grade independently under the same checks and report partial failures; it **MUST NOT** bypass per-grade validation.

## Activity-level metric

- The server aggregates a per-student, per-classroom **ActivityMetric** from connected time, submissions, and participation (chat messages and similar actions). Connected time **MUST** be accumulated as a coarse aggregate (for example per interval or per day), never as a row per movement or tick; see [Data](./data.md).
- The formula that combines the three signals into a displayed level is **open**. Raw values **MUST** be exposed so the teacher can read them.
- A student sees only their own metric; a parent sees only the linked child's; staff see the students of classrooms they have authority over.
- Presence-derived time is reported by Colyseus to NestJS in aggregated form; the client **MUST NOT** report its own connected time.

## Concurrency and live updates

- Simultaneous grading or submission of the same record **MUST** leave a coherent state and let the losing request learn it was not applied (for example through a version check). The mechanism is **open**; silent last-write-wins on grades **MUST NOT** occur.
- Persistence precedes broadcast: events such as `activity:published` and `grade:published` **MUST** be emitted only after the commit, and their loss **MUST NOT** affect stored data; see [Architecture](./architecture.md).

## Verification

Tests **MUST** cover: role-by-role CRUD, foreign activity and submission identifiers, a student reading another's submission, correct answers hidden from students, automatic multiple-choice grading, deadline and exam-window behavior, idempotent resubmission, grade-to-points conversion with each weight, regrade compensation, parent visibility limited to grades of linked children, and persistence across restart. Follow [Quality and testing](./quality-and-testing.md).

## Open decisions

- Field limits, grading scale, and point weights per type.
- Resubmission, attempts, late submission, and partial credit.
- Whether exams target the whole classroom or selected students, and how the window is defined.
- Editing or deleting an activity that already has submissions.
- ActivityMetric formula and aggregation interval.
- File limits and scanning.
