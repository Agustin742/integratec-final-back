import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';
import { VisibleText } from '../http/visible-text';

/** Limits shared by validation, OpenAPI and the service. */
export const ANNOUNCEMENT_LIMITS = {
  titleMax: 200,
  contentMax: 5000,
  maxMentions: 20,
} as const;

/**
 * Announcements are read-only bulletin-board notices for a classroom:
 * teacher-level staff write, every member reads chronologically.
 */
export class AnnouncementDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  authorId!: string;

  @ApiProperty({ maxLength: ANNOUNCEMENT_LIMITS.titleMax })
  title!: string;

  @ApiProperty({ maxLength: ANNOUNCEMENT_LIMITS.contentMax })
  content!: string;

  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Classroom members resolved from @mentions in the content.',
  })
  mentionedUserIds!: string[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

/**
 * The property may be absent, but an explicit `null` is a validation error. `@IsOptional`
 * also skips `null`, so it must not be used on fields whose column is NOT NULL.
 */
function OptionalButNotNull() {
  return ValidateIf((_object: unknown, value: unknown) => value !== undefined);
}

/**
 * Announcement bodies are stored and returned as plain text; the backend never interprets
 * or renders them as HTML. Multi-line text is allowed, but C0 control characters other than
 * tab, newline and carriage return, plus C1 controls, are rejected.
 */
function AnnouncementContent(property: string): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    // eslint-disable-next-line no-control-regex -- Explicitly reject unsafe control characters.
    Matches(/^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]*$/u, {
      message: `${property} must not contain control characters`,
    }),
    Matches(/\S/u, {
      message: `${property} must contain text other than whitespace`,
    }),
  );
}

export class CreateAnnouncementDto {
  @ApiProperty({
    description: 'Single-line notice title.',
    maxLength: ANNOUNCEMENT_LIMITS.titleMax,
  })
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @VisibleText('title')
  @MaxLength(ANNOUNCEMENT_LIMITS.titleMax)
  title!: string;

  @ApiProperty({
    description:
      'Plain text body; `@Name` tokens matching active classroom member display names become ' +
      `mentions (at most ${ANNOUNCEMENT_LIMITS.maxMentions} per announcement).`,
    maxLength: ANNOUNCEMENT_LIMITS.contentMax,
  })
  @IsString()
  @IsNotEmpty({ message: 'content must not be empty' })
  @AnnouncementContent('content')
  @MaxLength(ANNOUNCEMENT_LIMITS.contentMax)
  content!: string;
}

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ maxLength: ANNOUNCEMENT_LIMITS.titleMax })
  @OptionalButNotNull()
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @VisibleText('title')
  @MaxLength(ANNOUNCEMENT_LIMITS.titleMax)
  title?: string;

  @ApiPropertyOptional({ maxLength: ANNOUNCEMENT_LIMITS.contentMax })
  @OptionalButNotNull()
  @IsString()
  @IsNotEmpty({ message: 'content must not be empty' })
  @AnnouncementContent('content')
  @MaxLength(ANNOUNCEMENT_LIMITS.contentMax)
  content?: string;
}

/** Bulletin-board listing shares the standard offset pagination contract. */
export class ListAnnouncementsQueryDto extends PaginationQueryDto {}
