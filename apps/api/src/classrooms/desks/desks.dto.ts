import { ApiProperty } from '@nestjs/swagger';
import { EquippedItemPayloadDto } from '../../internal/realtime/realtime-join.dto';

export class ClassroomDeskDto {
  @ApiProperty({ format: 'uuid', description: 'Stable physical desk identifier.' })
  id!: string;

  @ApiProperty({
    minimum: 1,
    description: 'Persisted 1-based layout index; not a fixed seat count.',
  })
  deskIndex!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Assigned enrollment, or null for a free desk.',
  })
  membershipId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Assigned student user identifier, or null for a free desk. No directory profile data.',
  })
  userId!: string | null;

  @ApiProperty({
    type: EquippedItemPayloadDto,
    nullable: true,
    description:
      "The assigned student's equipped desk_decor item in this classroom, whether or not they are connected. Null for a free desk or an empty slot.",
  })
  deskDecor!: EquippedItemPayloadDto | null;
}

export class ClassroomDeskMapDto {
  @ApiProperty({
    type: [ClassroomDeskDto],
    description:
      'Complete physical layout ordered by deskIndex ascending, including unassigned desks. Unpaginated.',
  })
  items!: ClassroomDeskDto[];
}
