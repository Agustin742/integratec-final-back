import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationPath } from '@aula/contracts';

export class SchoolSummaryDto {
  @ApiProperty({
    example: '3f6c2d9e-0000-4000-8000-000000000000',
    description: 'Unique school identifier (UUID)',
  })
  id!: string;

  @ApiProperty({
    example: 'Colegio Belgrano Day',
    description: 'Name of the created school',
  })
  name!: string;

  @ApiProperty({
    example: 'colegio-belgrano-day',
    description: 'Unique slug generated for the school',
  })
  slug!: string;

  @ApiProperty({
    example: 'America/Argentina/Buenos_Aires',
    description: 'IANA time zone for the school',
  })
  timeZone!: string;
}

export class RegisterResponseDto {
  @ApiProperty({
    example: '3f6c2d9e-0000-4000-8000-000000000000',
    description: 'Unique user identifier (UUID)',
  })
  id!: string;

  @ApiProperty({
    example: 'profesora.ana@example.com',
    description: 'Registered user email address',
  })
  email!: string;

  @ApiProperty({
    example: 'Prof. Ana García',
    description: 'User display name',
  })
  displayName!: string;

  @ApiProperty({
    enum: RegistrationPath,
    example: RegistrationPath.INDEPENDENT_TEACHER,
    description: 'Organizational path chosen during registration',
  })
  path!: RegistrationPath;

  @ApiPropertyOptional({
    type: SchoolSummaryDto,
    description: 'Created school details if path is SCHOOL',
  })
  school?: SchoolSummaryDto;

  @ApiProperty({
    example: '2026-11-05T20:00:00.000Z',
    description: 'Account creation instant in UTC (ISO 8601)',
  })
  createdAt!: string;
}
