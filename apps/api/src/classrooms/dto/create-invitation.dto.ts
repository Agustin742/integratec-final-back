import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';

export class CreateClassroomInvitationDto {
  @ApiProperty({
    description: 'Target email address to invite',
    example: 'student@example.edu.ar',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @ApiPropertyOptional({
    description: 'Classroom role for the invitee (defaults to STUDENT)',
    enum: InvitationRole,
    default: InvitationRole.STUDENT,
  })
  @IsOptional()
  @IsEnum(InvitationRole, { message: 'role must be a valid invitation role' })
  role?: InvitationRole = InvitationRole.STUDENT;
}
