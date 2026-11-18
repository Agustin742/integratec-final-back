import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ChatMessageDto, SendMessageDto } from './chat.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('classrooms/:id/messages')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiOperation({
    summary: 'Send a classroom chat message',
    description:
      'Current students and teaching staff only; parents denied. Muted classrooms reject students but allow staff. Message, resolved mentions and notification requests commit atomically before any future broadcast (#48). At most 5 sends per rolling 10 seconds per user/classroom, including staff and hidden messages. Only body is accepted; author and time are server-assigned.',
  })
  @ApiCreatedResponse({ type: ChatMessageDto })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid body, excess mentions or unknown fields.',
  })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Parent role or student in muted classroom.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid, nonexistent or inaccessible classroom.',
  })
  @ApiTooManyRequestsResponse({
    type: ErrorEnvelopeDto,
    description: 'Five messages already admitted in the rolling ten-second window.',
  })
  send(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() dto: SendMessageDto,
  ): Promise<ChatMessageDto> {
    return this.chat.send(actorId, classroomId, dto.body);
  }
}
