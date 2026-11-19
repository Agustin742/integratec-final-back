import { ApiProperty, OmitType } from '@nestjs/swagger';
import { SUBMISSION_MAX_FILE_BYTES, SUBMISSION_MAX_FILES } from './submission-file-policy';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** One stored file of a submission. Storage keys and download URLs are deliberately absent. */
export class SubmissionFileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Sanitized display name (no path, no control characters).' })
  originalName!: string;

  @ApiProperty({
    description: 'Detected from the file bytes, never from the client-declared type.',
    example: 'application/pdf',
  })
  contentType!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: SUBMISSION_MAX_FILE_BYTES })
  sizeBytes!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: SUBMISSION_MAX_FILES - 1,
    description: 'Zero-based order in which the files were sent.',
  })
  position!: number;
}

/** One chosen option per question of a multiple-choice submission. Never carries `isCorrect`. */
export class SubmissionAnswerResponseDto {
  @ApiProperty({ format: 'uuid' })
  questionId!: string;

  @ApiProperty({ format: 'uuid' })
  optionId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Zero-based order in which the answers were sent.',
  })
  position!: number;
}

export class SubmissionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  activityId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Server clock, ISO 8601 UTC, taken once the activity row was locked.',
  })
  submittedAt!: string;

  @ApiProperty({
    description: 'True when submitted after `dueAt` on an activity with `allowLate`.',
  })
  isLate!: boolean;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 100,
    nullable: true,
    description:
      'Server-computed score of a MULTIPLE_CHOICE submission (0..maxScore), never supplied by ' +
      'the client; null for file submissions, which a teacher grades through the grade endpoint.',
  })
  autoScore!: number | null;

  @ApiProperty({
    type: String,
    enum: ['submitted', 'graded'],
    description: 'Derived state of the work.',
  })
  status!: 'submitted' | 'graded';

  @ApiProperty({ type: [SubmissionFileResponseDto] })
  files!: SubmissionFileResponseDto[];

  @ApiProperty({
    type: [SubmissionAnswerResponseDto],
    description:
      'Chosen options of a MULTIPLE_CHOICE submission in the order they were sent; empty for ' +
      'file submissions.',
  })
  answers!: SubmissionAnswerResponseDto[];
}

/** A stored file on the read endpoints: the upload shape plus a short-lived signed URL. */
export class SubmissionFileDownloadDto extends SubmissionFileResponseDto {
  @ApiProperty({
    description:
      'Short-lived signed URL that downloads the file without credentials. Treat it as a ' +
      'secret: do not log or share it; request the submission again for a fresh one.',
  })
  downloadUrl!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'ISO 8601 UTC instant after which `downloadUrl` stops working.',
  })
  downloadUrlExpiresAt!: string;
}

/** The submission as read back: same fields as {@link SubmissionResponseDto} plus download URLs. */
export class SubmissionDownloadResponseDto extends OmitType(SubmissionResponseDto, [
  'files',
] as const) {
  @ApiProperty({ type: [SubmissionFileDownloadDto] })
  files!: SubmissionFileDownloadDto[];
}

/** Documents the multipart body for OpenAPI only; multer, not the validation pipe, parses it. */
export class CreateSubmissionBodyDto {
  @ApiProperty({
    type: 'array',
    items: { type: 'string', format: 'binary' },
    minItems: 1,
    maxItems: SUBMISSION_MAX_FILES,
    description:
      `1-${SUBMISSION_MAX_FILES} files of at most ${SUBMISSION_MAX_FILE_BYTES / (1024 * 1024)} MB each. ` +
      'Allowed content (detected from the bytes): PDF, PNG, JPEG, DOCX. Required for FILE ' +
      'activities; rejected for MULTIPLE_CHOICE activities.',
  })
  files!: string[];

  @ApiProperty({
    type: String,
    required: false,
    description:
      'MULTIPLE_CHOICE answers: a JSON-encoded array of { questionId, optionId } pairs, at least ' +
      'one. Required for MULTIPLE_CHOICE activities; rejected for FILE activities. The server ' +
      'grades the answers and returns the score; correct answers are never sent back.',
  })
  answers?: string;
}
