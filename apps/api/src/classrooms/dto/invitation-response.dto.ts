import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationKind, InvitationRole, InvitationState } from '@prisma/client';

export class ClassroomInvitationResponseDto {
  @ApiProperty({ description: 'Invitation UUID' })
  id!: string;

  @ApiProperty({ enum: InvitationKind, description: 'Type of invitation' })
  kind!: InvitationKind;

  @ApiPropertyOptional({ description: 'Target email for EMAIL invitations', nullable: true })
  targetEmail!: string | null;

  @ApiProperty({ enum: InvitationRole, description: 'Assigned role upon joining' })
  role!: InvitationRole;

  @ApiPropertyOptional({ description: 'Maximum allowed uses, null if unlimited', nullable: true })
  maxUses!: number | null;

  @ApiProperty({ description: 'Number of times this invitation has been used' })
  useCount!: number;

  @ApiProperty({ enum: InvitationState, description: 'Current lifecycle state' })
  state!: InvitationState;

  @ApiProperty({ description: 'Expiration timestamp' })
  expiresAt!: Date;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;
}

export class CreatedClassroomInvitationResponseDto extends ClassroomInvitationResponseDto {
  @ApiProperty({
    description: 'Raw invitation secret token, returned only once upon creation',
    example: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
  })
  token!: string;
}

export class RevokeInvitationResponseDto {
  @ApiProperty({ description: 'Revoked invitation UUID' })
  id!: string;

  @ApiProperty({ enum: InvitationState, example: InvitationState.REVOKED })
  state!: InvitationState;
}
