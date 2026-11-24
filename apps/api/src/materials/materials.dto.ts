import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';

export const UNASSIGNED_FILTER = 'unassigned';

export class ListMaterialsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Only materials of this module (UUID), or "unassigned" for materials in no module. Omit for all active materials.',
    example: UNASSIGNED_FILTER,
  })
  @IsOptional()
  @Matches(/^(?:unassigned|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i, {
    message: 'moduleId must be a UUID or "unassigned"',
  })
  moduleId?: string;
}

/** The only multipart text field accepted next to the file. */
export class UploadMaterialBodyDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Module of this classroom to place it in.' })
  @IsOptional()
  @IsUUID(undefined, { message: 'moduleId must be a UUID' })
  moduleId?: string;
}

export class MaterialDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid', description: 'Original author, retained after logical removal.' })
  authorId!: string;

  @ApiProperty({ maxLength: 120, example: 'lesson.pdf' })
  filename!: string;

  @ApiProperty({ enum: ['application/pdf', 'image/png', 'image/jpeg'] })
  contentType!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 10485760 })
  sizeBytes!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Module the material belongs to; null means unassigned.',
  })
  moduleId!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class MaterialDownloadDto {
  @ApiProperty({
    format: 'uri',
    description: 'Private bearer capability: do not log or persist this temporary URL.',
  })
  url!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 3600,
    description: 'Configured URL lifetime.',
  })
  expiresInSeconds!: number;
}
