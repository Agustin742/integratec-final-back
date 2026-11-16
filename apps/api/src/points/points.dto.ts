import { ApiProperty } from '@nestjs/swagger';
import { PointEntryKind } from '@prisma/client';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQueryDto,
} from '../http/pagination/pagination-query.dto';
import type { SortOptions } from '../http/pagination/sort';

export const POINT_SORT_FIELDS = ['createdAt', 'amount'] as const;
export type PointSortField = (typeof POINT_SORT_FIELDS)[number];

/** Allow-list and default order for points wallet movement history. */
export const POINT_SORT_OPTIONS: SortOptions<PointSortField> = {
  allowed: POINT_SORT_FIELDS,
  default: { field: 'createdAt', direction: 'desc' },
};

/**
 * Pagination and sorting query for points wallet endpoints.
 * Allowed sort fields: `createdAt` (default, `-createdAt` descending) and `amount`.
 */
export class PointsQueryDto extends PaginationQueryDto {}

/** Single immutable ledger entry returned in wallet movement history. */
export class PointMovementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: PointEntryKind, enumName: 'PointEntryKind' })
  entryKind!: PointEntryKind;

  @ApiProperty({
    type: 'integer',
    description:
      'Signed integer delta: positive for earnings, negative for debits, non-zero signed for compensations.',
    example: 50,
  })
  amount!: number;

  @ApiProperty({ maxLength: 40, example: 'submission_grade' })
  sourceType!: string;

  @ApiProperty({ format: 'uuid' })
  sourceId!: string;

  @ApiProperty({ maxLength: 240, example: 'Activity graded: Fractions Quiz' })
  reason!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Full immutable ledger entry returned to internal domain callers of `PointsLedgerService`. */
export class PointTransactionDto extends PointMovementDto {
  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({ type: String, maxLength: 128, nullable: true })
  idempotencyKey!: string | null;
}

/** Student points wallet snapshot: server-derived balance and paginated ledger movements. */
export class StudentWalletDto {
  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Server-derived current balance computed as SUM(amount) in the classroom.',
    example: 120,
  })
  balance!: number;

  @ApiProperty({ type: [PointMovementDto] })
  items!: PointMovementDto[];

  @ApiProperty({ type: 'integer', minimum: 1, example: DEFAULT_PAGE })
  page!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    example: DEFAULT_PAGE_SIZE,
  })
  pageSize!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 3,
    description: 'Total number of ledger entries for this student in the classroom.',
  })
  total!: number;
}
