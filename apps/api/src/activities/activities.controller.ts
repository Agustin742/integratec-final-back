import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import {
  ActivitySummaryDto,
  CreateActivityDto,
  ListActivitiesQueryDto,
  StudentActivityResponseDto,
  TeacherActivityResponseDto,
  UpdateActivityDto,
} from './activities.dto';

const NOT_IMPLEMENTED = 'Activities contract only: implemented in a later task.';

/**
 * Contract-first stage (api-contracts D8/D9): every handler answers 501 until the service lands.
 * Activities are the academic assignments (TP/exam); they are unrelated to `ActivityMetric`,
 * which aggregates connected time.
 */
@ApiTags('activities')
@ApiBearerAuth()
@ApiParam({ name: 'id', description: 'Classroom UUID' })
@ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
@ApiNotFoundResponse({
  type: ErrorEnvelopeDto,
  description: 'Invalid, nonexistent or out-of-scope classroom or activity.',
})
@Controller('classrooms/:id/activities')
export class ActivitiesController {
  @Post()
  @ApiOperation({
    summary: 'Create a draft activity',
    description:
      'Teacher-level staff only. Creates a DRAFT (invisible to students). Cross-field rules ' +
      'checked by the service: `opensAt` only for EXAM and strictly before `dueAt`.',
  })
  @ApiCreatedResponse({ type: TeacherActivityResponseDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role (for example a student).',
  })
  create(@Param('id') _classroomId: string, @Body() _dto: CreateActivityDto): never {
    throw new NotImplementedException(NOT_IMPLEMENTED);
  }

  @Get()
  @ApiOperation({
    summary: 'List activities',
    description:
      'Staff see drafts and published (filter with `state`); students and linked parents see ' +
      'published only. Deactivated activities are never listed. Sortable by `dueAt` (default, ' +
      'ascending) or `createdAt`; `id` is the tiebreaker.',
  })
  @ApiPaginatedResponse(ActivitySummaryDto, 'Activities without questions.')
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Invalid query parameters.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role.',
  })
  list(@Param('id') _classroomId: string, @Query() _query: ListActivitiesQueryDto): never {
    throw new NotImplementedException(NOT_IMPLEMENTED);
  }

  @Get(':activityId')
  @ApiOperation({
    summary: 'Get one activity',
    description:
      'Role-dependent shape: staff receive the teacher view (questions with `isCorrect`); ' +
      'students receive the student view (no `isCorrect` anywhere) and only published activities.',
  })
  @ApiParam({ name: 'activityId', description: 'Activity UUID' })
  @ApiExtraModels(TeacherActivityResponseDto, StudentActivityResponseDto)
  @ApiOkResponse({
    description: 'Teacher view for staff, student view for students.',
    schema: {
      oneOf: [
        { $ref: getSchemaPath(TeacherActivityResponseDto) },
        { $ref: getSchemaPath(StudentActivityResponseDto) },
      ],
    },
  })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role.',
  })
  get(@Param('id') _classroomId: string, @Param('activityId') _activityId: string): never {
    throw new NotImplementedException(NOT_IMPLEMENTED);
  }

  @Patch(':activityId')
  @ApiOperation({
    summary: 'Update an activity',
    description:
      'Teacher-level staff only. Partial update; `type` and `format` are immutable. `questions` ' +
      'replaces all questions and stays editable only until the first submission exists.',
  })
  @ApiParam({ name: 'activityId', description: 'Activity UUID' })
  @ApiOkResponse({ type: TeacherActivityResponseDto })
  @ApiBadRequestResponse({ type: ErrorEnvelopeDto, description: 'Validation failed.' })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Insufficient role.' })
  @ApiConflictResponse({
    type: ErrorEnvelopeDto,
    description: 'Questions can no longer change because a submission exists.',
  })
  update(
    @Param('id') _classroomId: string,
    @Param('activityId') _activityId: string,
    @Body() _dto: UpdateActivityDto,
  ): never {
    throw new NotImplementedException(NOT_IMPLEMENTED);
  }

  @Post(':activityId/publish')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publish a draft activity',
    description:
      'Teacher-level staff only. Moves DRAFT to PUBLISHED and notifies active students after ' +
      'commit. Multiple-choice activities need valid questions.',
  })
  @ApiParam({ name: 'activityId', description: 'Activity UUID' })
  @ApiOkResponse({ type: TeacherActivityResponseDto })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Insufficient role.' })
  @ApiConflictResponse({ type: ErrorEnvelopeDto, description: 'Activity is already published.' })
  publish(@Param('id') _classroomId: string, @Param('activityId') _activityId: string): never {
    throw new NotImplementedException(NOT_IMPLEMENTED);
  }

  @Delete(':activityId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate an activity',
    description:
      'Teacher-level staff only. Logical deletion (`deletedAt`); rows are never physically removed.',
  })
  @ApiParam({ name: 'activityId', description: 'Activity UUID' })
  @ApiNoContentResponse({ description: 'Deactivated.' })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Insufficient role.' })
  deactivate(@Param('id') _classroomId: string, @Param('activityId') _activityId: string): never {
    throw new NotImplementedException(NOT_IMPLEMENTED);
  }
}
