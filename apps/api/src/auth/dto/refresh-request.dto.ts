import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Upper bound for a presented refresh token; real tokens are 43 characters. */
export const REFRESH_TOKEN_MAX_LENGTH = 512;

export class RefreshRequestDto {
  @ApiProperty({
    example: 'q3VZk0mH1xk4oQe2l7Yw5r8m9uJcT6bNf0aXsD1pLhE',
    description:
      'The current opaque refresh token. It is single-use: the response carries its replacement.',
    maxLength: REFRESH_TOKEN_MAX_LENGTH,
  })
  @IsString({ message: 'refreshToken must be a string' })
  @IsNotEmpty({ message: 'refreshToken must not be empty' })
  @MaxLength(REFRESH_TOKEN_MAX_LENGTH, {
    message: `refreshToken must not exceed ${REFRESH_TOKEN_MAX_LENGTH} characters`,
  })
  refreshToken!: string;
}
