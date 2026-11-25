import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { CHAT_MAX_BODY_LENGTH } from '../chat/chat-policy';
import { MAX_PAGE } from '../http/pagination/pagination-query.dto';
import { FamilyLinkDto } from './family.dto';

export const PARENT_LINK_MESSAGE_MAX_BODY_LENGTH = CHAT_MAX_BODY_LENGTH;
export const PARENT_LINK_MESSAGES_DEFAULT_PAGE = 1;
export const PARENT_LINK_MESSAGES_DEFAULT_PAGE_SIZE = 30;
export const PARENT_LINK_MESSAGES_MAX_PAGE_SIZE = 50;

export type ParentLinkMessageAuthorRole = 'PARENT' | 'STAFF';

// eslint-disable-next-line no-control-regex -- Allow tab/newline/CR, reject NUL and unsafe C0/C1 control characters.
export const UNSAFE_PARENT_MESSAGE_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u;

/** Query parameters for `GET /parent-links/:linkId/messages`. */
export class ListParentLinkMessagesQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: MAX_PAGE,
    default: PARENT_LINK_MESSAGES_DEFAULT_PAGE,
    description: '1-based page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = PARENT_LINK_MESSAGES_DEFAULT_PAGE;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: PARENT_LINK_MESSAGES_MAX_PAGE_SIZE,
    default: PARENT_LINK_MESSAGES_DEFAULT_PAGE_SIZE,
    description: 'Messages per page (1..50, default 30).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PARENT_LINK_MESSAGES_MAX_PAGE_SIZE)
  pageSize: number = PARENT_LINK_MESSAGES_DEFAULT_PAGE_SIZE;
}

/** Request payload for `POST /parent-links/:linkId/messages`. */
export class CreateParentLinkMessageDto {
  @ApiProperty({
    minLength: 1,
    maxLength: PARENT_LINK_MESSAGE_MAX_BODY_LENGTH,
    description:
      'Plain text message body; 1–2000 characters after trimming. Tabs and line breaks are ' +
      'allowed; NUL and unsafe C0/C1 control characters are rejected. Never interpreted as HTML.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && !UNSAFE_PARENT_MESSAGE_CONTROL_CHARS.test(value)
      ? value.trim()
      : value,
  )
  @IsString()
  // eslint-disable-next-line no-control-regex -- Explicitly reject unsafe C0/C1 control characters.
  @Matches(/^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]*$/u, {
    message: 'body must not contain control characters',
  })
  @Matches(/[^\s\u200B-\u200D\uFEFF]/u, {
    message: 'body must not be empty',
  })
  @MaxLength(PARENT_LINK_MESSAGE_MAX_BODY_LENGTH, {
    message: `body must not exceed ${PARENT_LINK_MESSAGE_MAX_BODY_LENGTH} characters`,
  })
  body!: string;
}

/** One persisted message in a private parent-teacher thread bound to a ParentLink. */
export class ParentLinkMessageDto {
  @ApiProperty({ format: 'uuid', description: 'Message UUID.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'ParentLink UUID this message belongs to.' })
  parentLinkId!: string;

  @ApiProperty({ format: 'uuid', description: 'Author user UUID.' })
  authorId!: string;

  @ApiProperty({ description: 'Current display name of the message author.' })
  authorDisplayName!: string;

  @ApiProperty({
    enum: ['PARENT', 'STAFF'],
    description: 'Whether the author is the linked parent (`PARENT`) or classroom staff (`STAFF`).',
  })
  authorRole!: ParentLinkMessageAuthorRole;

  @ApiProperty({
    maxLength: PARENT_LINK_MESSAGE_MAX_BODY_LENGTH,
    description: 'Trimmed plain text message body, never interpreted as HTML.',
  })
  body!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Server-assigned UTC creation timestamp (ISO-8601).',
  })
  createdAt!: string;
}

/** Paginated chronological message history for one parent-teacher thread. */
export class ParentLinkMessagesResponseDto {
  @ApiProperty({ type: FamilyLinkDto, description: 'Verified active parent-child link summary.' })
  link!: FamilyLinkDto;

  @ApiProperty({
    type: [ParentLinkMessageDto],
    description:
      'Visible messages in this parent-link thread, ordered chronologically (`createdAt ASC, id ASC`).',
  })
  items!: ParentLinkMessageDto[];

  @ApiProperty({ type: 'integer', minimum: 1, description: 'Current 1-based page number.' })
  page!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: PARENT_LINK_MESSAGES_MAX_PAGE_SIZE,
    description: 'Page size.',
  })
  pageSize!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Total number of visible messages in this thread.',
  })
  total!: number;
}

/** One active parent-child messaging thread visible to classroom staff (`GET /me/family-threads`). */
export class StaffFamilyThreadDto {
  @ApiProperty({ format: 'uuid', description: 'ParentLink UUID.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Classroom UUID.' })
  classroomId!: string;

  @ApiProperty({ description: 'Classroom display name.' })
  classroomName!: string;

  @ApiProperty({ format: 'uuid', description: 'Linked parent user UUID.' })
  parentId!: string;

  @ApiProperty({ description: 'Current display name of the linked parent.' })
  parentDisplayName!: string;

  @ApiProperty({ format: 'uuid', description: 'Linked student user UUID.' })
  childId!: string;

  @ApiProperty({ description: 'Current display name of the linked student.' })
  childDisplayName!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: PARENT_LINK_MESSAGE_MAX_BODY_LENGTH,
    description: 'Latest visible message body in this thread, or null if no messages exist yet.',
  })
  lastMessageBody!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'UTC ISO-8601 timestamp of the latest visible message, or null if none.',
  })
  lastMessageAt!: string | null;

  @ApiProperty({
    enum: ['PARENT', 'STAFF'],
    nullable: true,
    description:
      'Role of the author of the latest visible message (`PARENT` or `STAFF`), or null if none.',
  })
  lastMessageAuthorRole!: ParentLinkMessageAuthorRole | null;
}

/** Active family messaging threads across all classrooms where the caller holds a staff role. */
export class StaffFamilyThreadsResponseDto {
  @ApiProperty({
    type: [StaffFamilyThreadDto],
    description:
      'Active family threads ordered by `lastMessageAt DESC NULLS LAST`, then `createdAt ASC`, ' +
      'then `id ASC`. Empty when the authenticated user has no staff classrooms.',
  })
  items!: StaffFamilyThreadDto[];
}
