import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { MembershipState } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../http/pagination/pagination-query.dto';

export class RosterQueryDto extends PickType(PaginationQueryDto, ['page', 'pageSize'] as const) {
  @ApiPropertyOptional({ enum: MembershipState, description: 'Omit to include both states.' })
  @IsOptional()
  @IsEnum(MembershipState)
  state?: MembershipState;

  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive display-name prefix.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class RosterGuardianDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({
    enum: MembershipState,
    description: 'Historical link state, not access authority.',
  })
  state!: MembershipState;
}

export class RosterStudentDto {
  @ApiProperty({ format: 'uuid' })
  membershipId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ enum: MembershipState })
  state!: MembershipState;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  deletedAt!: string | null;

  @ApiProperty({ type: [RosterGuardianDto] })
  guardians!: RosterGuardianDto[];
}
