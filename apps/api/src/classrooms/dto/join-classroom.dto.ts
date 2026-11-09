import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class JoinClassroomWithCodeDto {
  @ApiProperty({
    description: 'Classroom access code (normalized uppercase alphanumeric)',
    example: 'K7P9X2M',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @IsNotEmpty()
  @Length(4, 32, { message: 'code must be between 4 and 32 characters' })
  @Matches(/^[A-Z0-9]+$/, { message: 'code must contain only alphanumeric characters' })
  code!: string;
}
