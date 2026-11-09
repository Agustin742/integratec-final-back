import { ApiProperty } from '@nestjs/swagger';
import { ClassroomRole } from '@prisma/client';

export class AssignedDeskDto {
  @ApiProperty({ description: 'Desk UUID' })
  id!: string;

  @ApiProperty({ description: '1-based index of the assigned desk in the classroom' })
  deskIndex!: number;
}

export class JoinClassroomResponseDto {
  @ApiProperty({ description: 'Classroom UUID' })
  classroomId!: string;

  @ApiProperty({ description: 'Created or existing membership UUID' })
  membershipId!: string;

  @ApiProperty({ enum: ClassroomRole, default: ClassroomRole.STUDENT })
  role!: ClassroomRole;

  @ApiProperty({ type: AssignedDeskDto, nullable: true })
  desk!: AssignedDeskDto | null;

  @ApiProperty({
    description: 'True if the caller was already enrolled in this classroom (idempotent rejoin)',
  })
  alreadyMember!: boolean;
}
