import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Caps `skip` at a safe, reasonable offset so a huge `page` is a 400, not a driver error. */
export const MAX_PAGE = 10_000;

/**
 * Query contract shared by every list endpoint (offset pagination).
 *
 * Decision: offset pagination (`page` + `pageSize`) for the MVP. Classroom-scale
 * lists are small and offset is the simplest thing for the frontend and for the
 * Scalar "try it" UI. Cursor pagination can be added later for feeds such as chat
 * without changing the `{ items, page, pageSize, total }` shape of existing endpoints.
 *
 * `sort` is `<field>` (ascending) or `-<field>` (descending). The class only checks
 * that it is a string; each endpoint validates it against its own allow-list with
 * `parseSort`. Every endpoint must also add a stable tiebreaker (for example `id`)
 * to its ORDER BY so rows do not shift between pages.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE,
    default: DEFAULT_PAGE,
    description: '1-based page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = DEFAULT_PAGE;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
    description: 'Items per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize: number = DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    type: 'string',
    example: '-createdAt',
    description:
      'Field to order by; prefix with "-" for descending. Allowed fields and the default ' +
      'order are listed per endpoint.',
  })
  @IsOptional()
  @IsString()
  sort?: string;
}
