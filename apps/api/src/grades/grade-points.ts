import { ActivityType, Prisma } from '@prisma/client';
import type { ApiConfig } from '../config/api-config';

export const GRADE_SCORE_MIN = 0;
export const GRADE_SCORE_MAX = 100;
export const GRADE_FEEDBACK_MAX_LENGTH = 5000;
export const SUBMISSION_GRADE_SOURCE_TYPE = 'submission_grade';

const DECIMAL_TWO_PLACES = /^\d+(?:\.(\d{1,2}))?$/;

/**
 * Converts a non-negative decimal with up to 2 fractional digits (`number`, `string`, or
 * `Prisma.Decimal`) into exact integer hundredths without binary floating-point drift.
 */
export function toHundredths(value: number | Prisma.Decimal | string): number {
  if (typeof value === 'string' || value instanceof Prisma.Decimal) {
    const raw = value instanceof Prisma.Decimal ? value.toFixed(2) : value.trim();
    const match = DECIMAL_TWO_PLACES.exec(raw);
    if (!match) {
      throw new RangeError(`Invalid weight decimal: ${raw}`);
    }
    const [whole, frac = ''] = raw.split('.');
    return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`Invalid numeric weight: ${String(value)}`);
  }
  const scaled = Math.round(value * 100);
  if (Math.abs(value * 100 - scaled) > 1e-6) {
    throw new RangeError(`Weight supports at most 2 decimal places: ${value}`);
  }
  return scaled;
}

/**
 * Looks up the configured activity-type weight for `TP` or `EXAM`. Defaults and the `EXAM > TP`
 * rule are already guaranteed by `loadApiConfig`.
 */
export function resolveActivityTypeWeight(
  type: ActivityType,
  config: Pick<ApiConfig, 'gradeWeightTp' | 'gradeWeightExam'>,
): number {
  return type === ActivityType.EXAM ? config.gradeWeightExam : config.gradeWeightTp;
}

/**
 * Computes `round(score * typeWeight * activityWeightMultiplier)` using exact integer
 * ten-thousandths arithmetic and half-up rounding, avoiding IEEE-754 drift such as
 * `10 * 0.75 * 0.6 === 4.499999999999999`.
 */
export function calculateWeightedGradePoints(
  score: number,
  typeWeight: number | Prisma.Decimal | string,
  activityWeightMultiplier: number | Prisma.Decimal | string,
): number {
  if (!Number.isInteger(score) || score < GRADE_SCORE_MIN || score > GRADE_SCORE_MAX) {
    throw new RangeError(
      `Score must be an integer between ${GRADE_SCORE_MIN} and ${GRADE_SCORE_MAX}`,
    );
  }
  const typeHundredths = toHundredths(typeWeight);
  const activityHundredths = toHundredths(activityWeightMultiplier);
  const tenThousandths = score * typeHundredths * activityHundredths;
  return Math.trunc((tenThousandths + 5_000) / 10_000);
}
