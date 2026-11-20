import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One row inside a review section, shaped by the frontend contract (issue #119). */
export class DailyReviewItemDto {
  @ApiProperty({
    enum: ['pending_activity', 'recent_grade', 'announcement', 'teacher_review'],
    description: 'Row kind; the frontend renders each kind with its own layout.',
  })
  kind!: 'pending_activity' | 'recent_grade' | 'announcement' | 'teacher_review';

  @ApiProperty({ maxLength: 120, example: 'Trabajo práctico de fotosíntesis' })
  title!: string;

  @ApiProperty({ maxLength: 120, example: 'Biología 3°B' })
  classroomName!: string;

  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'ISO 8601 UTC instant; the frontend displays it in the school time zone.',
  })
  dueAt!: string | null;

  @ApiProperty({
    nullable: true,
    maxLength: 280,
    description: 'Kind-specific detail, for example a grade rendered as "9/10".',
  })
  detail!: string | null;
}

/** Ordered group of review rows. */
export class DailyReviewSectionDto {
  @ApiProperty({ enum: ['pending', 'news'] })
  kind!: 'pending' | 'news';

  @ApiProperty({ type: [DailyReviewItemDto] })
  items!: DailyReviewItemDto[];
}

/** Daily question built from teacher-approved material; the answer key never leaves the server. */
export class DailyQuestionDto {
  @ApiProperty({ format: 'uuid', description: 'Question id to submit with the chosen answer.' })
  id!: string;

  @ApiProperty({ maxLength: 280, example: '¿Qué organelo realiza la fotosíntesis?' })
  prompt!: string;

  @ApiProperty({
    type: [String],
    minItems: 2,
    maxItems: 6,
    description: 'Answer options; the submission sends the chosen option text.',
  })
  options!: string[];

  @ApiProperty({
    nullable: true,
    maxLength: 120,
    description: 'Source material title the question was built from, when known.',
  })
  materialTitle!: string | null;
}

/**
 * Streak snapshot returned with an answered daily question (contract #119 maps
 * the gamification summary's `lastQualifyingDay` to `lastQualifiedDate`).
 */
export class DailyQuestionStreakDto {
  @ApiProperty({ minimum: 0, example: 5, description: 'Chain alive as of today.' })
  currentStreak!: number;

  @ApiProperty({ minimum: 0, example: 9 })
  bestStreak!: number;

  @ApiProperty({
    nullable: true,
    example: '2026-11-19',
    description:
      'Local day (YYYY-MM-DD, America/Argentina/Buenos_Aires) of the last qualifying activity.',
  })
  lastQualifiedDate!: string | null;
}

/** Request body for answering the day's question (POST, contract #119). */
export class AnswerDailyQuestionDto {
  // No @IsUUID on purpose: a malformed id must answer 404 exactly like a foreign
  // id, because both mean there is no question for this user, and neither may
  // leak which question rows exist.
  @ApiProperty({
    example: '00000000-0000-4000-8000-000000000000',
    description: 'Id of the daily question delivered to this user today.',
  })
  @IsString()
  questionId!: string;

  @ApiProperty({ maxLength: 120, example: 'Cloroplasto' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  answer!: string;
}

/** Answer evaluation with the live streak summary (POST, contract #119). */
export class DailyQuestionAnswerResponseDto {
  @ApiProperty({
    example: true,
    description: 'Exact trimmed-text match against the stored answer key.',
  })
  correct!: boolean;

  @ApiProperty({
    maxLength: 280,
    example: '¡Muy bien! Respuesta correcta y día de racha ganado.',
    description: 'Server-authored feedback in the product language; never model output.',
  })
  feedback!: string;

  @ApiProperty({ type: DailyQuestionStreakDto, description: 'Live streak after this answer.' })
  streak!: DailyQuestionStreakDto;
}

/**
 * Server-decided daily review state (HU-BOT-003, contract in issue #119).
 * `not_due` covers every non-delivery cause (already delivered today, another
 * tab, parent, no classroom access, exam in progress); the client does not
 * distinguish causes. When `status` is `due`, `audience`, `contentKind`,
 * `summary`, `sections` and `dailyQuestion` are present.
 */
export class DailyReviewResponseDto {
  @ApiProperty({ enum: ['not_due', 'due'] })
  status!: 'not_due' | 'due';

  @ApiPropertyOptional({
    enum: ['STUDENT', 'TEACHER'],
    description:
      'Present when status is `due`: students get review + question, teachers review only.',
  })
  audience?: 'STUDENT' | 'TEACHER';

  @ApiPropertyOptional({
    enum: ['generated', 'structured'],
    description:
      'Present when status is `due`. `structured` is the fallback built only from ' +
      'PostgreSQL data with `summary: null`; the frontend labels it non-generated.',
  })
  contentKind?: 'generated' | 'structured';

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 400,
    description: 'Model wording when contentKind is `generated`; null on the structured fallback.',
  })
  summary?: string | null;

  @ApiPropertyOptional({ type: [DailyReviewSectionDto] })
  sections?: DailyReviewSectionDto[];

  @ApiPropertyOptional({
    nullable: true,
    type: DailyQuestionDto,
    description:
      'Present for students when the server has a question for the day; null on the structured fallback.',
  })
  dailyQuestion?: DailyQuestionDto | null;
}
