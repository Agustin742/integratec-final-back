import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CHAT_MAX_BODY_LENGTH } from './chat-policy';

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
