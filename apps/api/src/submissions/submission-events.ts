/**
 * Outbox events published by the submissions module. They are recorded in the same transaction as
 * the submission and delivered at least once, so consumers must be idempotent (deduplicate on
 * `submissionId`). Payloads carry ids and an instant only: no names, e-mails or file data.
 */

/**
 * A student's submission was stored before the deadline (`isLate === false`). Never published for
 * late submissions or idempotent replays. The streak engine (HU-GAM-002) consumes it.
 */
export const SUBMISSION_ON_TIME_EVENT = 'submission.submitted-on-time';

// A type alias, not an interface: Prisma's JSON input type needs an implicit index signature.
export type SubmissionOnTimePayload = {
  /** Payload schema version; bump it when the shape changes incompatibly. */
  version: 1;
  submissionId: string;
  activityId: string;
  classroomId: string;
  studentId: string;
  /** Server-stamped submission instant, ISO 8601 in UTC. */
  submittedAt: string;
};
