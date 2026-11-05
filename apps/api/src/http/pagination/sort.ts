import { RequestValidationException } from '../validation';

export type SortDirection = 'asc' | 'desc';

export interface Sort<F extends string = string> {
  field: F;
  direction: SortDirection;
}

export interface SortOptions<F extends string> {
  /** Explicit allow-list of sortable fields for this endpoint. */
  allowed: readonly F[];
  /** Used when the client sends no `sort`. */
  default: Sort<F>;
}

/**
 * Parses `sort` (`field` or `-field`) against the endpoint's allow-list. Returns
 * plain values that a repository maps to its own ORDER BY; it knows nothing about
 * the database. An unknown field is a 400 VALIDATION_FAILED with a detail on `sort`.
 */
export function parseSort<F extends string>(
  sort: string | undefined,
  options: SortOptions<F>,
): Sort<F> {
  if (sort === undefined) return options.default;

  const direction: SortDirection = sort.startsWith('-') ? 'desc' : 'asc';
  const field = sort.startsWith('-') ? sort.slice(1) : sort;
  const allowed = options.allowed.find((candidate) => candidate === field);
  if (allowed === undefined) {
    throw new RequestValidationException([
      {
        field: 'sort',
        messages: [
          `sort must be one of: ${options.allowed.join(', ')} (prefix "-" for descending)`,
        ],
      },
    ]);
  }
  return { field: allowed, direction };
}
