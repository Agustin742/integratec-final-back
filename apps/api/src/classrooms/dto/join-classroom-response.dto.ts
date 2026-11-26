import { ApiProperty } from '@nestjs/swagger';
import { ClassroomRole, InvitationRole } from '@prisma/client';

export class AssignedDeskDto {
  @ApiProperty({ description: 'Desk UUID' })
  id!: string;

  @ApiProperty({
    description:
      '1-based index of the assigned desk in the classroom. When every desk is taken, the server creates a new desk (highest index + 1) so each enrolled student has one; classrooms have no capacity limit',
  })
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

export class AcceptInvitationResponseDto {
  @ApiProperty({ description: 'Classroom UUID' })
  classroomId!: string;

  @ApiProperty({
    type: String,
    description: 'Created or existing classroom membership UUID (null for PARENT invitations)',
    format: 'uuid',
    nullable: true,
  })
  membershipId!: string | null;

  @ApiProperty({
    enum: [InvitationRole.STUDENT, InvitationRole.PARENT],
    description: 'Role granted by the accepted invitation',
  })
  role!: 'STUDENT' | 'PARENT';

  @ApiProperty({
    type: AssignedDeskDto,
    nullable: true,
    description: 'Assigned desk for STUDENT invitations; null for PARENT invitations',
  })
  desk!: AssignedDeskDto | null;

  @ApiProperty({
    type: Number,
    description:
      '1-based index of the assigned desk for STUDENT invitations; null for PARENT invitations',
    nullable: true,
  })
  deskIndex!: number | null;

  @ApiProperty({
    type: String,
    description: 'Linked student user UUID for PARENT invitations; null for STUDENT invitations',
    format: 'uuid',
    nullable: true,
  })
  childId!: string | null;

  @ApiProperty({
    type: String,
    description:
      'Created or existing ParentLink UUID for PARENT invitations; null for STUDENT invitations',
    format: 'uuid',
    nullable: true,
  })
  parentLinkId!: string | null;

  @ApiProperty({
    description:
      'True if the caller already held an active membership or parent link (idempotent retry)',
  })
  alreadyMember!: boolean;
}
