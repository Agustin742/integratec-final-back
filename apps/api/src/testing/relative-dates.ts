const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Instant `days` days after today's UTC midnight plus `hourUtc` hours. Anchored to the day so
 * values stay stable for the whole test run, and relative to now so fixtures never expire.
 */
export function futureInstant(days: number, hourUtc = 0): Date {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return new Date(midnight.getTime() + days * DAY_MS + hourUtc * HOUR_MS);
}

/** Renders `instant` as an ISO 8601 string with an explicit offset such as `-03:00`. */
export function withOffset(instant: Date, offset: `${'+' | '-'}${number}:${number}`): string {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = offset.slice(1).split(':').map(Number);
  const shifted = new Date(instant.getTime() + sign * (hours * 60 + minutes) * 60_000);
  return `${shifted.toISOString().slice(0, 19)}${offset}`;
}
