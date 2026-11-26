import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateClassroomInvitationDto {
  @ApiProperty({
    description: 'Target email address to invite',
    example: 'student@example.edu.ar',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiPropertyOptional({
    description:
      'Classroom role for the invitee (STUDENT or PARENT). Teacher invitations belong to the school-teacher invitation flow.',
    enum: [InvitationRole.STUDENT, InvitationRole.PARENT],
    default: InvitationRole.STUDENT,
  })
  @IsOptional()
  @IsIn([InvitationRole.STUDENT, InvitationRole.PARENT], {
    message: 'role must be STUDENT or PARENT',
  })
  role?: InvitationRole = InvitationRole.STUDENT;

  @ApiPropertyOptional({
    description:
      'UUID of the enrolled student to link when role is PARENT. Must be omitted when role is STUDENT.',
    format: 'uuid',
    example: '4e5f6a7b-0000-4000-8000-000000000009',
  })
  @IsOptional()
  @IsUUID('all', { message: 'childId must be a valid UUID' })
  childId?: string;
}
