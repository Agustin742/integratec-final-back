import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PAGE } from '../../http/pagination/pagination-query.dto';

export const DEFAULT_CLASSROOMS_PAGE = 1;
export const DEFAULT_CLASSROOMS_LIMIT = 20;
export const MAX_CLASSROOMS_LIMIT = 100;
export const CLASSROOMS_ORDER_VALUES = ['asc', 'desc'] as const;
export type ClassroomsOrder = (typeof CLASSROOMS_ORDER_VALUES)[number];

export class ListClassroomsQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE,
    default: DEFAULT_CLASSROOMS_PAGE,
    description: '1-based page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  @Max(MAX_PAGE, { message: `page must not exceed ${MAX_PAGE}` })
  page: number = DEFAULT_CLASSROOMS_PAGE;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_CLASSROOMS_LIMIT,
    default: DEFAULT_CLASSROOMS_LIMIT,
    description: 'Maximum number of classrooms returned per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(MAX_CLASSROOMS_LIMIT, { message: `limit must not exceed ${MAX_CLASSROOMS_LIMIT}` })
  limit: number = DEFAULT_CLASSROOMS_LIMIT;

  @ApiPropertyOptional({
    enum: CLASSROOMS_ORDER_VALUES,
    default: 'desc',
    description: 'Sort direction by classroom creation timestamp (createdAt).',
  })
  @IsOptional()
  @IsIn(CLASSROOMS_ORDER_VALUES, { message: 'order must be either asc or desc' })
  order: ClassroomsOrder = 'desc';
}
