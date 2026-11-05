import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationPath } from '@aula/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export { RegistrationPath };

export class RegisterRequestDto {
  @ApiProperty({
    example: 'profesora.ana@example.com',
    description: 'User email address, normalized to lowercase and trimmed',
    maxLength: 255,
  })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(255, { message: 'email must not exceed 255 characters' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email!: string;

  @ApiProperty({
    example: 'passwordSegura123',
    description: 'User password (between 8 and 72 characters)',
    minLength: 8,
    maxLength: 72,
  })
  @IsString({ message: 'password must be a string' })
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(72, { message: 'password must not exceed 72 characters' })
  password!: string;

  @ApiProperty({
    example: 'Prof. Ana García',
    description: 'Display name for the user profile',
    maxLength: 100,
  })
  @IsString({ message: 'displayName must be a string' })
  @IsNotEmpty({ message: 'displayName must not be empty' })
  @MaxLength(100, { message: 'displayName must not exceed 100 characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  displayName!: string;

  @ApiProperty({
    enum: RegistrationPath,
    example: RegistrationPath.INDEPENDENT_TEACHER,
    description: 'Organizational path chosen during registration',
  })
  @IsEnum(RegistrationPath, { message: 'path must be either INDEPENDENT_TEACHER or SCHOOL' })
  path!: RegistrationPath;

  @ApiPropertyOptional({
    example: 'Colegio Belgrano Day',
    description: 'School name (required when path is SCHOOL)',
    maxLength: 150,
  })
  @ValidateIf((o: RegisterRequestDto) => o.path === RegistrationPath.SCHOOL)
  @IsString({ message: 'schoolName must be a string' })
  @IsNotEmpty({ message: 'schoolName is required when path is SCHOOL' })
  @MaxLength(150, { message: 'schoolName must not exceed 150 characters' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  schoolName?: string;
}
