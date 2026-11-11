import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../../http/pagination/api-paginated-response';
import { RosterQueryDto, RosterStudentDto } from './roster.dto';
import { ClassroomRosterService } from './roster.service';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms/:id/roster')
export class ClassroomRosterController {
  constructor(private readonly roster: ClassroomRosterService) {}

  @Get()
  @ApiOperation({
    summary: 'List student roster for classroom staff',
    description:
      'Includes active and inactive student memberships and historical guardian links. Ordered by displayName ascending, then membership id ascending. Separate from the D12 member directory.',
  })
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiPaginatedResponse(RosterStudentDto, 'Student roster including historical logical rows.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid or unknown query parameters.',
  })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom but insufficient role.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid, nonexistent or out-of-scope classroom.',
  })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: RosterQueryDto,
  ) {
    return this.roster.list(actorId, classroomId, query);
  }
}
