/** ISO-8601 string for a `Date`, or for a raw database timestamp returned by `$queryRaw`. */
export function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
