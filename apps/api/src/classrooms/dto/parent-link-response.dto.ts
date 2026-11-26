import { ApiProperty } from '@nestjs/swagger';
import { MembershipState } from '@prisma/client';

export class ClassroomParentLinkDto {
  @ApiProperty({ format: 'uuid', description: 'ParentLink UUID' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Guardian user UUID' })
  parentId!: string;

  @ApiProperty({ description: 'Guardian display name' })
  parentDisplayName!: string;

  @ApiProperty({ format: 'uuid', description: 'Linked student user UUID' })
  childId!: string;

  @ApiProperty({ description: 'Linked student display name' })
  childDisplayName!: string;

  @ApiProperty({ enum: MembershipState, description: 'Current link state' })
  state!: MembershipState;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;
}

export class ClassroomParentLinksResponseDto {
  @ApiProperty({
    type: [ClassroomParentLinkDto],
    description: 'Active parent links for the classroom',
  })
  items!: ClassroomParentLinkDto[];
}
