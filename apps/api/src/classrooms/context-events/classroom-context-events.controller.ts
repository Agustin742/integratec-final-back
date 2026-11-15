import { Controller, Get, Param, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { VerifiedSession } from '../../auth/session-verifier.service';
import { ClassroomContextEventsService } from './classroom-context-events.service';

@ApiTags('Classrooms')
@ApiBearerAuth()
@Controller('classrooms')
export class ClassroomContextEventsController {
  constructor(private readonly events: ClassroomContextEventsService) {}

  // Nest 11 @Sse commits headers before async authorization: use explicit Express streaming.
  @Get(':id/context-events')
  @ApiOperation({
    summary:
      'Subscribe to live context hints; refetch classroom context on every connection and hint',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('text/event-stream')
  @ApiResponse({
    status: 200,
    description: 'classroom.context-invalidated events with JSON data {classroomId}; no replay',
    schema: { type: 'string' },
  })
  @ApiResponse({ status: 401, description: 'Missing, invalid, expired or revoked session' })
  @ApiResponse({ status: 404, description: 'Classroom unavailable or inaccessible' })
  @ApiResponse({ status: 503, description: 'Authorization setup timed out or service is stopping' })
  async connect(
    @CurrentUser() identity: VerifiedSession,
    @Param('id') classroomId: string,
    @Res() response: Response,
  ): Promise<void> {
    await this.events.connect(identity, classroomId, response);
  }
}
