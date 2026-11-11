import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InvitationRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional } from 'class-validator';

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
      'Classroom role for the invitee. Only STUDENT is supported; teacher invitations are out of scope for classroom invitations.',
    enum: [InvitationRole.STUDENT],
    default: InvitationRole.STUDENT,
  })
  @IsOptional()
  @IsIn([InvitationRole.STUDENT], { message: 'role must be STUDENT' })
  role?: InvitationRole = InvitationRole.STUDENT;
}
