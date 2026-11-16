import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import type { Paginated } from '../http/pagination/paginated';
import {
  GradeResponseDto,
  GradeSubmissionDto,
  GradingQueueGradeDto,
  GradingQueueItemDto,
  ListGradingQueueQueryDto,
  RegradeSubmissionDto,
} from './grades.dto';
import { GradesService } from './grades.service';

/** Transport adapter for grading and reading a single submission's grade. */
@ApiTags('grades')
@ApiBearerAuth()
@ApiParam({ name: 'submissionId', description: 'Submission UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
@Controller('submissions/:submissionId/grade')
export class SubmissionGradesController {
  constructor(private readonly grades: GradesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Grade a file submission',
    description:
      'Classroom staff (`OWNER`, `ADMIN`, or assigned `TEACHER`) only. Assigns a 0-100 score and ' +
      'visible feedback (`1-5000` characters) to an ungraded `FILE` submission, computes ' +
      'server-weighted points (`round(score * typeWeight * activity.weightMultiplier)`), credits ' +
      'the points ledger atomically when points > 0, and records a student-only `grade_posted` ' +
      'notification. Returns `409` if already graded or not a `FILE` activity, `403` for ' +
      'classroom students or linked parents, and `404` for out-of-scope actors.',
  })
  @ApiCreatedResponse({ type: GradeResponseDto, description: 'Grade created and points credited.' })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid score, blank/control-character feedback, or extra body fields.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom/child submission, but caller lacks teacher authority.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Submission not found, deleted activity, or out-of-scope actor.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description: 'Submission already graded or activity format is not FILE.',
  })
  grade(
    @CurrentUser('userId') actorId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: GradeSubmissionDto,
  ): Promise<GradeResponseDto> {
    return this.grades.gradeSubmission(actorId, submissionId, dto);
  }

  @Patch()
  @ApiOperation({
    summary: 'Regrade an existing submission grade',
    description:
      'Classroom staff (`OWNER`, `ADMIN`, or assigned `TEACHER`) only. Uses optimistic ' +
      'concurrency (`version`) to update score and feedback, appends a `GradeRevision` row, ' +
      'applies a compensating ledger entry (or initial earning from 0) when weighted points ' +
      'change, and records a student-only `grade_posted` notification. Returns `409` on stale ' +
      '`version` or if a negative delta would drive student points below zero.',
  })
  @ApiOkResponse({ type: GradeResponseDto, description: 'Grade updated and revision appended.' })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid score, feedback, version, or extra body fields.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom/child submission, but caller lacks teacher authority.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Submission or grade not found, deleted activity, or out-of-scope actor.',
  })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description:
      'Stale grade version, non-FILE activity, or insufficient points balance for delta.',
  })
  regrade(
    @CurrentUser('userId') actorId: string,
    @Param('submissionId') submissionId: string,
    @Body() dto: RegradeSubmissionDto,
  ): Promise<GradeResponseDto> {
    return this.grades.regradeSubmission(actorId, submissionId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Read a submission grade',
    description:
      'Readable by classroom staff (`OWNER`, `ADMIN`, `TEACHER`, preserved even if the student ' +
      'later leaves), the active owning student, and active linked parents outside adult mode. ' +
      'Never exposes file storage keys or signed download URLs. Classmate students receive ' +
      '`403`; ungraded submissions, deleted activities, unlinked/adult-mode parents, and ' +
      'out-of-scope callers receive `404`.',
  })
  @ApiOkResponse({ type: GradeResponseDto })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Classmate student attempting to read another student grade.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Submission or grade not found, deleted activity, or out-of-scope actor.',
  })
  getGrade(
    @CurrentUser('userId') actorId: string,
    @Param('submissionId') submissionId: string,
  ): Promise<GradeResponseDto> {
    return this.grades.getGrade(actorId, submissionId);
  }
}

/** Transport adapter for the staff classroom grading queue (`GET /classrooms/:id/submissions`). */
@ApiTags('grades')
@ApiBearerAuth()
@ApiExtraModels(GradingQueueGradeDto)
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
@Controller('classrooms/:id/submissions')
export class ClassroomSubmissionsController {
  constructor(private readonly grades: GradesService) {}

  @Get()
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiOperation({
    summary: 'List classroom submissions for staff grading',
    description:
      'Classroom staff (`OWNER`, `ADMIN`, or assigned `TEACHER`) only. Returns a paginated ' +
      'grading queue across non-deleted classroom activities (preserving submissions of ' +
      'deactivated students), optionally filtered by `activityId` and derived `state` ' +
      '(`submitted` or `graded`). Ordered by `submittedAt` ascending by default (supports ' +
      '`submittedAt`, `gradedAt`, and `-` descending prefix) with `id` ascending tiebreaker.',
  })
  @ApiPaginatedResponse(GradingQueueItemDto, 'Paginated grading queue for classroom staff.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination, filter, or sort parameters.',
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom, but caller lacks teacher authority.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom or filtered activity not found, or caller is out of scope.',
  })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListGradingQueueQueryDto,
  ): Promise<Paginated<GradingQueueItemDto>> {
    return this.grades.listGradingQueue(actorId, classroomId, query);
  }
}
