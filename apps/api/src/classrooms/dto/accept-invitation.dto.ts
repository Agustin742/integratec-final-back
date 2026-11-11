import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class AcceptInvitationDto {
  @ApiProperty({
    description: 'Opaque token received via invitation email',
    example: '4f7e2d9a8c1b3e5f7a9d0c2e4b6a8f1d3c5e7b9a0c2e4f6a8b0d2e4f6a8b0c2e',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @Length(16, 128, { message: 'token must be between 16 and 128 characters' })
  token!: string;
}
