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
    description:
      'Present for students when the server has a question for the day; null on the structured fallback.',
  })
  dailyQuestion?: DailyQuestionDto | null;
}
