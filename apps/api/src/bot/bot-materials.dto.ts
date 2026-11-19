import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MaterialIndexState } from '@prisma/client';
import { IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';

export class ListBotMaterialsQueryDto extends PaginationQueryDto {}

export class EnableBotMaterialDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Study material that must belong to the same classroom.',
  })
  @IsUUID()
  materialId!: string;
}

export class BotMaterialDto {
  @ApiProperty({ format: 'uuid', description: 'Allowed-material record id.' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  materialId!: string;

  @ApiProperty({ maxLength: 120, example: 'lesson.pdf' })
  filename!: string;

  @ApiProperty({ enum: ['application/pdf', 'image/png', 'image/jpeg'] })
  contentType!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 10485760 })
  sizeBytes!: number;

  @ApiProperty({
    enum: MaterialIndexState,
    description:
      'Indexing state inside the classroom partition. `FAILED` leaves the material ' +
      'usable for its normal purposes and is visible to the teacher.',
  })
  indexState!: MaterialIndexState;

  @ApiPropertyOptional({
    nullable: true,
    maxLength: 300,
    description: 'Present only while indexState is `failed`.',
  })
  failureReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
