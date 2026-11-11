import { ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationState } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../http/pagination/pagination-query.dto';

export const INVITATION_STATUS_OPTIONS = [...Object.values(InvitationState), 'ALL'] as const;
export type InvitationStatusFilter = (typeof INVITATION_STATUS_OPTIONS)[number];

export class ListInvitationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter invitations by status (default is PENDING)',
    enum: INVITATION_STATUS_OPTIONS,
    default: InvitationState.PENDING,
  })
  @IsOptional()
  @IsEnum(INVITATION_STATUS_OPTIONS, {
    message: 'status must be a valid InvitationState or ALL',
  })
  status?: InvitationStatusFilter = InvitationState.PENDING;
}
