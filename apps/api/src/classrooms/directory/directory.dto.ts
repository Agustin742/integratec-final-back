import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../http/pagination/pagination-query.dto';
import { AvatarDto } from '../../users/avatar.dto';

export class ClassroomMembersQueryDto extends PickType(PaginationQueryDto, [
  'page',
  'pageSize',
] as const) {
  @ApiPropertyOptional({ maxLength: 100, description: 'Case-insensitive display-name prefix.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export type ClassroomMemberRole = 'TEACHER' | 'STUDENT';

export class ClassroomMemberDto {
  @ApiProperty({ format: 'uuid', description: 'User identifier.' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'User identifier (matches id).' })
  userId!: string;

  @ApiProperty({ description: 'Display name.' })
  displayName!: string;

  @ApiProperty({
    enum: ['TEACHER', 'STUDENT'],
    description: 'Classroom member role (Teacher or Student).',
  })
  role!: ClassroomMemberRole;

  @ApiProperty({
    type: AvatarDto,
    description: 'Avatar appearance configuration.',
  })
  avatar!: AvatarDto;
}
