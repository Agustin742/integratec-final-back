import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RegistrationPath } from '@aula/contracts';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PasswordPolicy } from './password-policy';

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
    description: 'User password (between 8 characters and 72 UTF-8 bytes)',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @PasswordPolicy()
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
