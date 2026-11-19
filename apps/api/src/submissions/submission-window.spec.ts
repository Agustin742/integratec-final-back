import { ActivityFormat } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { submissionWindow, type SubmissionWindowRules } from './submission-window';

const OPENS = new Date('2026-03-01T10:00:00Z');
const DUE = new Date('2026-03-10T10:00:00Z');

function rules(overrides: Partial<SubmissionWindowRules> = {}): SubmissionWindowRules {
  return {
    format: ActivityFormat.FILE,
    opensAt: OPENS,
    dueAt: DUE,
    allowLate: false,
    ...overrides,
  };
}

describe('submissionWindow', () => {
  it('rejects activities that are not FILE format, before checking dates', () => {
    const result = submissionWindow(
      rules({ format: ActivityFormat.MULTIPLE_CHOICE, opensAt: new Date('2027-01-01T00:00:00Z') }),
      new Date('2026-03-05T00:00:00Z'),
    );
    expect(result).toEqual({ open: false, reason: 'format' });
  });

  it('is not open before opensAt', () => {
    expect(submissionWindow(rules(), new Date(OPENS.getTime() - 1))).toEqual({
      open: false,
      reason: 'not_open',
    });
  });

  it('is open exactly at opensAt', () => {
    expect(submissionWindow(rules(), OPENS)).toEqual({ open: true, isLate: false });
  });

  it('is open from the start when opensAt is null', () => {
    expect(submissionWindow(rules({ opensAt: null }), new Date('2000-01-01T00:00:00Z'))).toEqual({
      open: true,
      isLate: false,
    });
  });

  it('is open and not late exactly at dueAt', () => {
    expect(submissionWindow(rules(), DUE)).toEqual({ open: true, isLate: false });
  });

  it('is closed after dueAt when late submissions are not allowed', () => {
    expect(submissionWindow(rules(), new Date(DUE.getTime() + 1))).toEqual({
      open: false,
      reason: 'closed',
    });
  });

  it('is open and late after dueAt when late submissions are allowed', () => {
    expect(submissionWindow(rules({ allowLate: true }), new Date(DUE.getTime() + 1))).toEqual({
      open: true,
      isLate: true,
    });
  });
});
