import { ActivityFormat } from '@prisma/client';

/** The activity fields that decide whether a submission is accepted. */
export interface SubmissionWindowRules {
  format: ActivityFormat;
  opensAt: Date | null;
  dueAt: Date;
  allowLate: boolean;
}

export type SubmissionWindow =
  { open: true; isLate: boolean } | { open: false; reason: 'format' | 'not_open' | 'closed' };

/**
 * Single source of truth for whether an activity takes a submission at `now` (data-and-time D10:
 * the server decides on UTC instants). Checks run in order: format, opening, deadline. Shared by
 * the submit endpoint and the student inbox `canSubmit` so the two cannot drift.
 */
export function submissionWindow(rules: SubmissionWindowRules, now: Date): SubmissionWindow {
  if (rules.format !== ActivityFormat.FILE) {
    return { open: false, reason: 'format' };
  }
  if (rules.opensAt !== null && now.getTime() < rules.opensAt.getTime()) {
    return { open: false, reason: 'not_open' };
  }
  if (now.getTime() > rules.dueAt.getTime()) {
    return rules.allowLate ? { open: true, isLate: true } : { open: false, reason: 'closed' };
  }
  return { open: true, isLate: false };
}
