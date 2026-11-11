import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationRole, InvitationState } from '@prisma/client';

export class JoinCodeResponseDto {
  @ApiProperty({ description: 'Invitation UUID' })
  id!: string;

  @ApiProperty({
    description:
      'Raw shareable join code (6-8 alphanumeric characters). Shown ONCE upon generation.',
    example: 'K7P9X2M',
  })
  code!: string;

  @ApiProperty({ enum: InvitationRole, default: InvitationRole.STUDENT })
  role!: InvitationRole;

  @ApiPropertyOptional({ description: 'Maximum uses, null if unlimited', nullable: true })
  maxUses!: number | null;

  @ApiProperty({ description: 'Current use count', default: 0 })
  useCount!: number;

  @ApiProperty({ enum: InvitationState, default: InvitationState.PENDING })
  state!: InvitationState;

  @ApiProperty({ description: 'Expiration timestamp' })
  expiresAt!: Date;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;
}
