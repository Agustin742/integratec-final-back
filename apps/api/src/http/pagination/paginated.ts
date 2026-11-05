export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

interface PageParams {
  page: number;
  pageSize: number;
}

/** Offset/limit for a repository (`skip`/`take` in Prisma terms). */
export function toSkipTake({ page, pageSize }: PageParams): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

/** Builds the standard list response; `total` is the count across all pages. */
export function paginated<T>(items: T[], total: number, query: PageParams): Paginated<T> {
  return { items, page: query.page, pageSize: query.pageSize, total };
}
