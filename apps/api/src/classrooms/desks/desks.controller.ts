import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../../http/error-envelope.dto';
import { ClassroomDeskMapDto } from './desks.dto';
import { ClassroomDesksService } from './desks.service';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms/:id/desks')
export class ClassroomDesksController {
  constructor(private readonly desks: ClassroomDesksService) {}

  @Get()
  @ApiOperation({
    summary: 'Read the complete classroom desk map',
    description:
      'Available to enrolled students, classroom teachers and the school Owner/Admin. Includes free and expanded desks, ordered by deskIndex ascending. One unpaginated physical layout; no mutations or implicit repair. Parent-only access is excluded.',
  })
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiOkResponse({ type: ClassroomDeskMapDto })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Parent-only access to a visible classroom.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid, nonexistent, deleted or out-of-scope classroom.',
  })
  read(@CurrentUser('userId') actorId: string, @Param('id') classroomId: string) {
    return this.desks.read(actorId, classroomId);
  }
}
