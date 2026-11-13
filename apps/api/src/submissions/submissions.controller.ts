import {
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { SUBMISSION_MAX_FILE_BYTES, SUBMISSION_MAX_FILES } from './submission-file-policy';
import {
  CreateSubmissionBodyDto,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  SubmissionResponseDto,
} from './submissions.dto';
import { SubmissionsService } from './submissions.service';

/**
 * multer hands over the multipart file name decoded as Latin-1, but browsers send UTF-8, so
 * "ñandú.pdf" arrives as "Ã±andÃº.pdf". Re-reads the bytes as UTF-8 and keeps the original when
 * that is not valid UTF-8 (a genuinely Latin-1 name).
 */
function decodeUploadedName(name: string): string {
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('�') ? name : decoded;
}

/** Transport adapter only: access, rules and storage live in `SubmissionsService`. */
@ApiTags('submissions')
@ApiBearerAuth()
@ApiParam({ name: 'activityId', description: 'Activity UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
@Controller('activities/:activityId/submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Post()
  // Memory storage (no `dest`): the service validates the real bytes before anything is stored.
  // multer aborts an oversized file (413) or too many files (400) before the handler runs.
  @UseInterceptors(
    FilesInterceptor('files', SUBMISSION_MAX_FILES, {
      limits: { fileSize: SUBMISSION_MAX_FILE_BYTES, files: SUBMISSION_MAX_FILES },
    }),
  )
  @HttpCode(201)
  @ApiOperation({
    summary: 'Submit files to an activity',
    description:
      'Student only. Uploads 1-5 files (PDF, PNG, JPEG or DOCX, up to 10 MB each, type detected ' +
      "from the bytes) to a published FILE activity of the student's classroom. One submission " +
      'per student and activity. The server clock decides the window: before `opensAt` or after ' +
      '`dueAt` with `allowLate = false` is rejected (409); after `dueAt` with `allowLate = true` ' +
      'is stored with `isLate = true`. Retrying with the same `Idempotency-Key` returns the ' +
      'stored submission (200) without storing anything new; a different key after a ' +
      'submission exists is 409. Unknown, draft or deactivated activities and non-members ' +
      'answer 404; staff and linked parents answer 403.',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: `Client-generated key, 1-${IDEMPOTENCY_KEY_MAX_LENGTH} characters (a UUID is recommended).`,
    schema: { type: 'string', minLength: 1, maxLength: IDEMPOTENCY_KEY_MAX_LENGTH },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateSubmissionBodyDto })
  @ApiCreatedResponse({ type: SubmissionResponseDto, description: 'Submission stored.' })
  @ApiOkResponse({
    type: SubmissionResponseDto,
    description: 'Idempotent replay: the existing submission, nothing new stored.',
  })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description:
      'Missing or invalid `Idempotency-Key`, no files, disallowed or empty files (`VALIDATION_FAILED` ' +
      'with details), or too many files / unexpected field (`BAD_REQUEST`).',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but not a student (staff, linked parent).',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid, nonexistent, draft or deactivated activity, or not a member.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description:
      'Already submitted with another key, window closed or not yet open, or not a file activity ' +
      '(`details` names the reason).',
  })
  @ApiPayloadTooLargeResponse({
    type: ErrorEnvelopeDto,
    description: 'A file exceeds 10 MB.',
  })
  async create(
    @CurrentUser('userId') actorId: string,
    @Param('activityId') activityId: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SubmissionResponseDto> {
    const { submission, created } = await this.submissions.submit(
      actorId,
      activityId,
      idempotencyKey,
      (files ?? []).map((file) => ({
        originalName: decodeUploadedName(file.originalname),
        declaredContentType: file.mimetype,
        bytes: file.buffer,
      })),
    );
    if (!created) res.status(200);
    return submission;
  }
}
