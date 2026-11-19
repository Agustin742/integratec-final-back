/** The UTC calendar date of an instant, as a `Date` value suitable for a `@db.Date` column. */
export function utcDayOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}
