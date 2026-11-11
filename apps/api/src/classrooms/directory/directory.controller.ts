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
import { ClassroomMemberDto, ClassroomMembersQueryDto } from './directory.dto';
import { ClassroomDirectoryService } from './directory.service';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms/:id/members')
export class ClassroomDirectoryController {
  constructor(private readonly directory: ClassroomDirectoryService) {}

  @Get()
  @ApiOperation({
    summary: 'List classroom member directory readable by members',
    description:
      'Provides public member cards (displayName, role, avatar) for classroom members. Accessible to active teachers and enrolled students (and school staff). Strict privacy: never leaks emails, parent links, password hashes, or grades.',
  })
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiPaginatedResponse(ClassroomMemberDto, 'Classroom member directory.')
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid or unknown query parameters.',
  })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Classroom member directory is only accessible to classroom members.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid, nonexistent or out-of-scope classroom.',
  })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ClassroomMembersQueryDto,
  ) {
    return this.directory.list(actorId, classroomId, query);
  }
}
