import { ApiProperty } from '@nestjs/swagger';

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
}

export class ClassroomDeskMapDto {
  @ApiProperty({
    type: [ClassroomDeskDto],
    description:
      'Complete physical layout ordered by deskIndex ascending, including unassigned desks. Unpaginated.',
  })
  items!: ClassroomDeskDto[];
}
