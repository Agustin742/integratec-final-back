import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PasswordPolicy } from './password-policy';

/** Upper bound for a presented reset token; real tokens are 43 characters. */
export const PASSWORD_RESET_TOKEN_MAX_LENGTH = 512;

export class PasswordResetConfirmRequestDto {
  @ApiProperty({
    example: 'q3VZk0mH1xk4oQe2l7Yw5r8m9uJcT6bNf0aXsD1pLhE',
    description: 'The opaque token from the emailed link (`?token=`). It works once.',
    maxLength: PASSWORD_RESET_TOKEN_MAX_LENGTH,
  })
  @IsString({ message: 'token must be a string' })
  @IsNotEmpty({ message: 'token must not be empty' })
  @MaxLength(PASSWORD_RESET_TOKEN_MAX_LENGTH, {
    message: `token must not exceed ${PASSWORD_RESET_TOKEN_MAX_LENGTH} characters`,
  })
  token!: string;

  @ApiProperty({
    example: 'passwordSegura123',
    description: 'The new password, under the same policy as registration',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @PasswordPolicy()
  newPassword!: string;
}
