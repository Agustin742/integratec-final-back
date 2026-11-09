import { PaginationQueryDto } from '../../http/pagination/pagination-query.dto';
import type { SortOptions } from '../../http/pagination/sort';

export const CLASSROOM_SORT_FIELDS = ['createdAt', 'name'] as const;
export type ClassroomSortField = (typeof CLASSROOM_SORT_FIELDS)[number];

/** Allow-list and default order for `GET /classrooms` and `GET /me/classrooms`. */
export const CLASSROOM_SORT_OPTIONS: SortOptions<ClassroomSortField> = {
  allowed: CLASSROOM_SORT_FIELDS,
  default: { field: 'createdAt', direction: 'desc' },
};

/**
 * Shared pagination contract (`page`, `pageSize`, `sort`) for the classroom lists.
 * Sortable fields: `createdAt` (default, descending) and `name`; prefix with `-` for descending.
 */
export class ListClassroomsQueryDto extends PaginationQueryDto {}
