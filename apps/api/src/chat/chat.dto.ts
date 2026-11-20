import { ApiProperty, PickType } from '@nestjs/swagger';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';
import { IsString, IsUUID } from 'class-validator';
import { CHAT_INBOX_PREVIEW_MAX_LENGTH, CHAT_MAX_BODY_LENGTH } from './chat-policy';

export class ListMessagesQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {}

export class SendMessageDto {
  @ApiProperty({
    description:
      'Plain text; 1–2000 characters after trimming. Unsafe control characters are rejected. @Name resolves active classroom members, at most 20 distinct users.',
    minLength: 1,
    // No raw maxLength: surrounding whitespace is removed before the length check.
  })
  @IsString()
  body!: string;
}

export class ChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({
    maxLength: CHAT_MAX_BODY_LENGTH,
    description: 'Trimmed plain text, never interpreted as HTML.',
  })
  body!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Distinct resolved active classroom members.',
  })
  mentionedUserIds!: string[];

  @ApiProperty({ format: 'date-time', description: 'Server-assigned UTC creation instant.' })
  createdAt!: string;
}

export class ChatHistoryMessageDto extends ChatMessageDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  hiddenAt!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  hiddenById!: string | null;
}

export class MarkChatReadDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Newest visible message of this classroom the caller has seen. The marker only moves forward; an older or equal message keeps the current marker.',
  })
  @IsUUID(undefined, { message: 'messageId must be a valid UUID' })
  messageId!: string;
}

export class ChatInboxLastMessageDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({ description: 'Current display name of the author.' })
  authorDisplayName!: string;

  @ApiProperty({
    maxLength: CHAT_INBOX_PREVIEW_MAX_LENGTH,
    description:
      'Message text with whitespace collapsed, cut to 120 characters (the last one is an ellipsis when cut). Plain text, never HTML.',
  })
  bodyPreview!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class ChatInboxItemDto {
  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty()
  classroomName!: string;

  @ApiProperty({
    type: ChatInboxLastMessageDto,
    nullable: true,
    description: 'Latest VISIBLE message (hidden ones are skipped), or null when there is none.',
  })
  lastMessage!: ChatInboxLastMessageDto | null;

  @ApiProperty({
    minimum: 0,
    description:
      'Visible messages from other users after the caller read marker; every visible message from others when no marker exists. Never counts own or hidden messages.',
  })
  unreadCount!: number;
}

export class ChatInboxDto {
  @ApiProperty({ type: [ChatInboxItemDto] })
  items!: ChatInboxItemDto[];
}
