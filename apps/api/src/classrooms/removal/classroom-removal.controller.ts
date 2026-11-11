import { Controller, Delete, HttpCode, HttpStatus, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../../http/error-envelope.dto';
import { ClassroomRemovalService } from './classroom-removal.service';

@ApiTags('classrooms')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomRemovalController {
  constructor(private readonly removal: ClassroomRemovalService) {}

  @Delete(':id/students/:studentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logically remove a student and revoke child-specific parent access' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Classroom UUID' })
  @ApiParam({
    name: 'studentId',
    format: 'uuid',
    description: 'Student USER UUID, not membership UUID',
  })
  @ApiNoContentResponse({ description: 'Removed, or already inactive/deleted; no response body.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Missing or invalid session.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Visible classroom, insufficient role.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid UUID, foreign/unknown classroom, or unknown/nonstudent target.',
  })
  remove(
    @CurrentUser('userId') actorUserId: string,
    @Param('id') classroomId: string,
    @Param('studentId') studentId: string,
  ): Promise<void> {
    return this.removal.remove(actorUserId, classroomId, studentId);
  }
}
