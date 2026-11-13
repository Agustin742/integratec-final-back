import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, OmitType, PartialType, PickType } from '@nestjs/swagger';
import { ActivityFormat, ActivityState, ActivityType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';
import { VisibleText } from '../http/visible-text';

/** Limits shared by validation, OpenAPI and (later) the service. */
export const ACTIVITY_LIMITS = {
  titleMax: 120,
  descriptionMax: 5000,
  maxScore: { min: 0, max: 100 },
  weight: { min: 0.5, max: 3, decimals: 2, default: 1 },
  questions: { min: 1, max: 50 },
  options: { min: 2, max: 6 },
  promptMax: 1000,
  labelMax: 500,
} as const;

/** Sort allow-list for the list endpoint; every ORDER BY adds `id` as tiebreaker. */
export const ACTIVITY_SORT_FIELDS = ['dueAt', 'createdAt'] as const;
export const ACTIVITY_DEFAULT_SORT = { field: 'dueAt', direction: 'asc' } as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** ISO 8601 instant that must carry an explicit offset (`Z` or `+hh:mm`), so it is never ambiguous. */
function IsInstant(property: string) {
  return applyDecorators(
    IsISO8601({ strict: true, strictSeparator: true }, { message: `${property} must be ISO 8601` }),
    Matches(/(Z|[+-]\d{2}:\d{2})$/, {
      message: `${property} must include a UTC offset (Z or +hh:mm)`,
    }),
  );
}

/** Each question must have exactly one option with `isCorrect: true`. */
export function ExactlyOneCorrectOption(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'exactlyOneCorrectOption',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) =>
          Array.isArray(value) &&
          value.filter((o: { isCorrect?: unknown }) => o?.isCorrect === true).length === 1,
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must contain exactly one correct option`,
      },
    });
  };
}

/** `questions` may only be sent for multiple-choice activities. */
function QuestionsOnlyForMultipleChoice(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'questionsOnlyForMultipleChoice',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (_value: unknown, args: ValidationArguments) =>
          (args.object as { format?: ActivityFormat }).format === ActivityFormat.MULTIPLE_CHOICE,
        defaultMessage: () => 'questions are only allowed when format is MULTIPLE_CHOICE',
      },
    });
  };
}

export class OptionInputDto {
  @ApiProperty({ maxLength: ACTIVITY_LIMITS.labelMax })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACTIVITY_LIMITS.labelMax)
  label!: string;

  @ApiProperty({ description: 'Exactly one option per question must be correct.' })
  @IsBoolean()
  isCorrect!: boolean;
}

export class QuestionInputDto {
  @ApiProperty({ maxLength: ACTIVITY_LIMITS.promptMax })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACTIVITY_LIMITS.promptMax)
  prompt!: string;

  @ApiProperty({
    type: [OptionInputDto],
    minItems: ACTIVITY_LIMITS.options.min,
    maxItems: ACTIVITY_LIMITS.options.max,
    description:
      'Order is the display order. Exactly one option must have `isCorrect: true` (single answer).',
  })
  @IsArray()
  @ArrayMinSize(ACTIVITY_LIMITS.options.min)
  @ArrayMaxSize(ACTIVITY_LIMITS.options.max)
  @ValidateNested({ each: true })
  @Type(() => OptionInputDto)
  @ExactlyOneCorrectOption()
  options!: OptionInputDto[];
}

export class CreateActivityDto {
  @ApiProperty({ enum: ActivityType })
  @IsEnum(ActivityType)
  type!: ActivityType;

  @ApiProperty({ enum: ActivityFormat, description: 'Immutable after creation.' })
  @IsEnum(ActivityFormat)
  format!: ActivityFormat;

  @ApiProperty({ minLength: 1, maxLength: ACTIVITY_LIMITS.titleMax })
  @VisibleText('title')
  @IsString()
  @IsNotEmpty()
  @MaxLength(ACTIVITY_LIMITS.titleMax)
  title!: string;

  @ApiPropertyOptional({ maxLength: ACTIVITY_LIMITS.descriptionMax, default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(ACTIVITY_LIMITS.descriptionMax)
  description?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Only meaningful for EXAM (TP must not set it; enforced by the service). Must be strictly ' +
      'before dueAt. ISO 8601 with offset; stored as UTC.',
  })
  @IsOptional()
  @IsInstant('opensAt')
  opensAt?: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Deadline. ISO 8601 with offset; stored as UTC.',
  })
  @IsInstant('dueAt')
  dueAt!: string;

  @ApiPropertyOptional({ default: false, description: 'Accept submissions after dueAt.' })
  @IsOptional()
  @IsBoolean()
  allowLate?: boolean;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100 })
  @IsInt()
  @Min(ACTIVITY_LIMITS.maxScore.min)
  @Max(ACTIVITY_LIMITS.maxScore.max)
  maxScore!: number;

  @ApiPropertyOptional({
    type: 'number',
    minimum: ACTIVITY_LIMITS.weight.min,
    maximum: ACTIVITY_LIMITS.weight.max,
    default: ACTIVITY_LIMITS.weight.default,
    description:
      'Weight in the period average. At most 2 decimals. Defaults are applied by the service, ' +
      'not on the DTO, so PATCH never resets them.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: ACTIVITY_LIMITS.weight.decimals })
  @Min(ACTIVITY_LIMITS.weight.min)
  @Max(ACTIVITY_LIMITS.weight.max)
  weightMultiplier?: number;

  @ApiPropertyOptional({
    type: [QuestionInputDto],
    minItems: ACTIVITY_LIMITS.questions.min,
    maxItems: ACTIVITY_LIMITS.questions.max,
    description: 'Required when format is MULTIPLE_CHOICE; forbidden for FILE.',
  })
  @ValidateIf(
    (o: CreateActivityDto) =>
      o.format === ActivityFormat.MULTIPLE_CHOICE || o.questions !== undefined,
  )
  @QuestionsOnlyForMultipleChoice()
  @IsArray()
  @ArrayMinSize(ACTIVITY_LIMITS.questions.min)
  @ArrayMaxSize(ACTIVITY_LIMITS.questions.max)
  @ValidateNested({ each: true })
  @Type(() => QuestionInputDto)
  questions?: QuestionInputDto[];
}

/** `type` and `format` are immutable; all other fields are optional. */
class UpdatableFieldsDto extends OmitType(CreateActivityDto, [
  'type',
  'format',
  'questions',
] as const) {}

export class UpdateActivityDto extends PartialType(UpdatableFieldsDto) {
  @ApiPropertyOptional({
    type: [QuestionInputDto],
    minItems: ACTIVITY_LIMITS.questions.min,
    maxItems: ACTIVITY_LIMITS.questions.max,
    description:
      'Replaces all questions and options. Only for MULTIPLE_CHOICE activities, and only until ' +
      'the first submission exists (then 409).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(ACTIVITY_LIMITS.questions.min)
  @ArrayMaxSize(ACTIVITY_LIMITS.questions.max)
  @ValidateNested({ each: true })
  @Type(() => QuestionInputDto)
  questions?: QuestionInputDto[];
}

export class ListActivitiesQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
  'sort',
] as const) {
  @ApiPropertyOptional({
    enum: ActivityState,
    description:
      'Staff only. Students always receive published activities only and may not filter drafts.',
  })
  @IsOptional()
  @IsEnum(ActivityState)
  state?: ActivityState;
}

export class TeacherOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  position!: number;

  @ApiProperty()
  label!: string;

  @ApiProperty({ description: 'Teacher view only; never present in the student view.' })
  isCorrect!: boolean;
}

/** Deliberately has no `isCorrect`: the student shape must not be able to carry it. */
export class StudentOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  position!: number;

  @ApiProperty()
  label!: string;
}

export class TeacherQuestionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  position!: number;

  @ApiProperty()
  prompt!: string;

  @ApiProperty({ type: [TeacherOptionDto] })
  options!: TeacherOptionDto[];
}

export class StudentQuestionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  position!: number;

  @ApiProperty()
  prompt!: string;

  @ApiProperty({ type: [StudentOptionDto] })
  options!: StudentOptionDto[];
}

/** List item and common part of both detail views (no questions, so nothing sensitive). */
export class ActivitySummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ enum: ActivityType })
  type!: ActivityType;

  @ApiProperty({ enum: ActivityFormat })
  format!: ActivityFormat;

  @ApiProperty({ enum: ActivityState })
  state!: ActivityState;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 UTC.' })
  opensAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', description: 'ISO 8601 UTC.' })
  dueAt!: string;

  @ApiProperty()
  allowLate!: boolean;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 100 })
  maxScore!: number;

  @ApiProperty({ type: 'number', example: 1.5, description: 'Number, not a decimal string.' })
  weightMultiplier!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ISO 8601 UTC.' })
  publishedAt!: string | null;

  @ApiProperty({
    example: 'America/Argentina/Buenos_Aires',
    description: 'School IANA time zone for rendering the instants above.',
  })
  timeZone!: string;

  @ApiProperty({ type: 'integer', minimum: 0 })
  questionCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

export class TeacherActivityResponseDto extends ActivitySummaryDto {
  @ApiProperty({ format: 'uuid' })
  createdById!: string;

  @ApiProperty({ type: [TeacherQuestionDto], description: 'Includes correct answers.' })
  questions!: TeacherQuestionDto[];
}

export class StudentActivityResponseDto extends ActivitySummaryDto {
  @ApiProperty({ type: [StudentQuestionDto], description: 'Never includes correct answers.' })
  questions!: StudentQuestionDto[];
}
