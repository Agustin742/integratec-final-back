import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MaxUtf8Bytes } from './password-policy';

export class LoginRequestDto {
  @ApiProperty({
    example: 'profesora.ana@example.com',
    description: 'Account email address, normalized to lowercase and trimmed',
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
    description: 'Account password (at most 72 UTF-8 bytes, the bcrypt input limit)',
    maxLength: 72,
  })
  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password must not be empty' })
  @MaxLength(72, { message: 'password must not exceed 72 characters' })
  @MaxUtf8Bytes(72, { message: 'password must not exceed 72 UTF-8 bytes' })
  password!: string;
}
