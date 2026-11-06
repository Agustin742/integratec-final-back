import { ApiProperty } from '@nestjs/swagger';

/** Access and refresh token pair, returned by both login and refresh. */
export class TokenPairResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIuLi4ifQ.signature',
    description: 'Short-lived JWT (HS256). Send it as `Authorization: Bearer <accessToken>`.',
  })
  accessToken!: string;

  @ApiProperty({
    example: 'q3VZk0mH1xk4oQe2l7Yw5r8m9uJcT6bNf0aXsD1pLhE',
    description:
      'Opaque refresh token. Stored server-side only as a SHA-256 digest; keep it secret.',
  })
  refreshToken!: string;

  @ApiProperty({ example: 'Bearer', enum: ['Bearer'], description: 'Authorization scheme.' })
  tokenType!: 'Bearer';

  @ApiProperty({ example: 900, description: 'Access token lifetime in seconds.' })
  expiresIn!: number;
}
