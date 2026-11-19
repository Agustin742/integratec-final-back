/**
 * Local calendar day used by once-per-day rules (RN-08, RN-15).
 *
 * The server owns the clock and the zone; client values are never authoritative
 * (`rules/data-and-time.md`). Days are stored as plain `YYYY-MM-DD` strings in
 * the named IANA zone, never as shifted instants.
 */
export const DEFAULT_LOCAL_DAY_TIME_ZONE = 'America/Argentina/Buenos_Aires' as const;

const dayFormatterCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Renders the calendar date of `instant` in `timeZone` as `YYYY-MM-DD`.
 * `en-CA` yields the ISO-like format without locale punctuation drift.
 */
export function toLocalDay(instant: Date, timeZone: string = DEFAULT_LOCAL_DAY_TIME_ZONE): string {
  let formatter = dayFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      numberingSystem: 'latn',
    });
    dayFormatterCache.set(timeZone, formatter);
  }
  return formatter.format(instant);
}

/**
 * Whole-day distance between two same-zone calendar day strings (`to - from`).
 * String comparison is exact because both values are dates in one zone, not
 * instants; no timezone arithmetic is involved.
 */
export function localDayDistance(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay}T00:00:00.000Z`);
  const to = Date.parse(`${toDay}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error('Invalid local day value');
  }
  return Math.round((to - from) / 86_400_000);
}
