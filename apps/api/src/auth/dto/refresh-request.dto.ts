import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshRequestDto {
  @ApiProperty({
    example: 'q3VZk0mH1xk4oQe2l7Yw5r8m9uJcT6bNf0aXsD1pLhE',
    description:
      'The current opaque refresh token. It is single-use: the response carries its replacement.',
    maxLength: 512,
  })
  @IsString({ message: 'refreshToken must be a string' })
  @IsNotEmpty({ message: 'refreshToken must not be empty' })
  @MaxLength(512, { message: 'refreshToken must not exceed 512 characters' })
  refreshToken!: string;
}
