import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { ErrorEnvelopeDto } from '../http/error-envelope.dto';
import { ApiPaginatedResponse } from '../http/pagination/api-paginated-response';
import {
  ChatHistoryMessageDto,
  ChatMessageDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './chat.dto';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('classrooms/:id/messages')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiOperation({
    summary: 'Read classroom chat history',
    description:
      'Current students and staff only; parents denied. Latest first (createdAt DESC, id DESC). Students omit hidden rows and their mentions; staff retain full text and audit. Visible rows have null hiddenAt/hiddenById. Count, items and mentions share a repeatable-read snapshot. Only page/pageSize queries are accepted.',
  })
  @ApiPaginatedResponse(ChatHistoryMessageDto)
  @ApiBadRequestResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid pagination or unsupported query.',
  })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto })
  @ApiForbiddenResponse({ type: ErrorEnvelopeDto, description: 'Parent role.' })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description: 'Invalid, nonexistent or inaccessible classroom.',
  })
  list(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chat.list(actorId, classroomId, query);
  }

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

  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'Classroom UUID' })
  @ApiParam({ name: 'messageId', description: 'Message UUID inside this classroom' })
  @ApiOperation({
    summary: 'Hide a classroom chat message (teacher moderation)',
    description:
      'Current classroom staff only (Owner, Admin or Teacher); students and parents denied. Logical moderation: the server sets the hiddenAt/hiddenById audit pair atomically and the row is never deleted. Repeating moderation returns 204 without overwriting the original actor/time. Independent of the send rate limit. No unhide operation exists.',
  })
  @ApiNoContentResponse({ description: 'Message hidden, or already hidden by a first moderation.' })
  @ApiUnauthorizedResponse({ type: ErrorEnvelopeDto, description: 'Authentication required.' })
  @ApiForbiddenResponse({
    type: ErrorEnvelopeDto,
    description: 'Student or parent role in a visible classroom.',
  })
  @ApiNotFoundResponse({
    type: ErrorEnvelopeDto,
    description:
      'Invalid, nonexistent or inaccessible classroom, or unknown/foreign/invalid message UUID in it.',
  })
  hide(
    @CurrentUser('userId') actorId: string,
    @Param('id') classroomId: string,
    @Param('messageId') messageId: string,
  ): Promise<void> {
    return this.chat.hide(actorId, classroomId, messageId);
  }
}
