import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { ActivityType } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';
import { parseSort, type SortOptions } from '../http/pagination/sort';
import { VisibleText } from '../http/visible-text';
import { GRADE_FEEDBACK_MAX_LENGTH, GRADE_SCORE_MAX, GRADE_SCORE_MIN } from './grade-points';

export const SUBMISSION_GRADE_STATUSES = ['submitted', 'graded'] as const;
export type SubmissionGradeStatus = (typeof SUBMISSION_GRADE_STATUSES)[number];

export const GRADING_QUEUE_SORT_FIELDS = ['submittedAt', 'gradedAt'] as const;
export type GradingQueueSortField = (typeof GRADING_QUEUE_SORT_FIELDS)[number];
export const GRADING_QUEUE_DEFAULT_SORT = { field: 'submittedAt', direction: 'asc' } as const;

/** Allow-list and default order for the classroom grading queue. */
export const GRADING_QUEUE_SORT_OPTIONS: SortOptions<GradingQueueSortField> = {
  allowed: GRADING_QUEUE_SORT_FIELDS,
  default: GRADING_QUEUE_DEFAULT_SORT,
};

function IsGradingQueueSort(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isGradingQueueSort',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          try {
            parseSort(value, GRADING_QUEUE_SORT_OPTIONS);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage: () =>
          `sort must be one of: ${GRADING_QUEUE_SORT_FIELDS.join(', ')} (prefix "-" for descending)`,
      },
    });
  };
}

/** Request body for initial grading (`POST /submissions/:submissionId/grade`). */
export class GradeSubmissionDto {
  @ApiProperty({
    type: 'integer',
    minimum: GRADE_SCORE_MIN,
    maximum: GRADE_SCORE_MAX,
    description: 'Numeric grade on a 0-100 scale.',
    example: 85,
  })
  @IsInt()
  @Min(GRADE_SCORE_MIN)
  @Max(GRADE_SCORE_MAX)
  score!: number;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: GRADE_FEEDBACK_MAX_LENGTH,
    description: 'Visible teacher feedback for the student (trimmed, 1-5000 characters).',
    example: 'Clear structure and complete reasoning.',
  })
  @VisibleText('feedback')
  @IsString()
  @IsNotEmpty()
  @MaxLength(GRADE_FEEDBACK_MAX_LENGTH)
  feedback!: string;
}

/** Request body for regrading (`PATCH /submissions/:submissionId/grade`). */
export class RegradeSubmissionDto extends GradeSubmissionDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Expected current grade version for optimistic concurrency control.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  version!: number;
}

/** Grade record returned by grade creation, regrade, and read endpoints. */
export class GradeResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  submissionId!: string;

  @ApiProperty({ format: 'uuid' })
  activityId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  graderId!: string;

  @ApiProperty({ type: 'integer', minimum: GRADE_SCORE_MIN, maximum: GRADE_SCORE_MAX })
  score!: number;

  @ApiProperty({ type: String, minLength: 1, maxLength: GRADE_FEEDBACK_MAX_LENGTH })
  feedback!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Server-computed weighted points currently awarded for this grade.',
  })
  pointsAwarded!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Id of the initial earning ledger entry. It is never replaced by later regrade entries (even after a regrade to 0 points), and is null only when the first award was 0 points and no later regrade has credited points.',
  })
  pointTransactionId!: string | null;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  gradedAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** Query parameters for the staff grading queue (`GET /classrooms/:id/submissions`). */
export class ListGradingQueueQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: 'Optional filter by an active activity of this classroom.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'activityId must be a valid UUID' })
  activityId?: string;

  @ApiPropertyOptional({
    type: String,
    enum: [...SUBMISSION_GRADE_STATUSES],
    description: 'Optional filter by derived submission state (`submitted` or `graded`).',
  })
  @IsOptional()
  @IsIn(SUBMISSION_GRADE_STATUSES)
  state?: SubmissionGradeStatus;

  @ApiPropertyOptional({
    type: String,
    enum: [...GRADING_QUEUE_SORT_FIELDS, ...GRADING_QUEUE_SORT_FIELDS.map((field) => `-${field}`)],
    default: GRADING_QUEUE_DEFAULT_SORT.field,
    description:
      'Field to order by; prefix with "-" for descending. Default `submittedAt` ascending; ' +
      '`id` ascending is the deterministic tiebreaker.',
  })
  @IsOptional()
  @IsGradingQueueSort()
  sort?: string;
}

/** Grade summary embedded inside each graded item of the classroom grading queue. */
export class GradingQueueGradeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  graderId!: string;

  @ApiProperty({ type: 'integer', minimum: GRADE_SCORE_MIN, maximum: GRADE_SCORE_MAX })
  score!: number;

  @ApiProperty({ type: String, minLength: 1, maxLength: GRADE_FEEDBACK_MAX_LENGTH })
  feedback!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  pointsAwarded!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  gradedAt!: string;
}

/** Single submission entry in the staff grading queue (`GET /classrooms/:id/submissions`). */
export class GradingQueueItemDto {
  @ApiProperty({ format: 'uuid', description: 'Submission UUID.' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  activityId!: string;

  @ApiProperty({ type: String })
  activityTitle!: string;

  @ApiProperty({ enum: ActivityType, enumName: 'ActivityType' })
  activityType!: ActivityType;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({ type: String })
  studentDisplayName!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  submittedAt!: string;

  @ApiProperty({ type: 'boolean' })
  isLate!: boolean;

  @ApiProperty({ type: String, enum: [...SUBMISSION_GRADE_STATUSES] })
  status!: SubmissionGradeStatus;

  @ApiProperty({ type: 'integer', minimum: 0 })
  fileCount!: number;

  @ApiProperty({ type: GradingQueueGradeDto, nullable: true })
  grade!: GradingQueueGradeDto | null;
}
