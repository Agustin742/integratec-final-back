import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ChatInboxDto, MarkChatReadDto } from './chat.dto';
import { ChatInboxService } from './chat-inbox.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller()
export class ChatInboxController {
  constructor(private readonly inbox: ChatInboxService) {}

  @Get('chats')
  @ApiOperation({
    summary: 'List the caller chat inbox',
    description:
      'One summary per classroom where the caller is a current student or staff member (parents and removed members get none), at most 100 classrooms. Each item has the latest VISIBLE message (hidden ones are skipped for every role) with a trimmed preview, or null, and the unread count: visible messages from other users after the caller read marker (all of them when there is no marker). Ordered by latest message createdAt DESC (id DESC on ties); classrooms without messages last, by name. Not paginated.',
  })
  @ApiOkResponse({ type: ChatInboxDto })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  list(@CurrentUser('userId') actorId: string): Promise<ChatInboxDto> {
    return this.inbox.list(actorId);
  }

  @Put('classrooms/:id/messages/read-marker')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiOperation({
    summary: 'Advance the caller chat read marker',
    description:
      'Same access as chat history: current students and staff; parents denied. The message must be a visible message of this classroom. The marker only moves forward by (createdAt, id); an older or equal message leaves it unchanged, so the call is idempotent. Only messageId is accepted.',
  })
  @ApiNoContentResponse({ description: 'Marker advanced, or already at or beyond that message.' })
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Missing or malformed messageId, or unknown fields.',
  })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Parent role.' })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description:
      'Invalid, nonexistent or inaccessible classroom, or unknown/foreign/hidden message in it.',
  })
  markRead(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Body() dto: MarkChatReadDto,
  ): Promise<void> {
    return this.inbox.markRead(actorId, classroomId, dto.messageId);
  }
}
