import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';

export class ListMaterialsQueryDto extends PaginationQueryDto {}

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
