import { ApiProperty } from '@nestjs/swagger';

/** Fixed acknowledgement: identical for registered and unregistered emails. */
export class PasswordResetRequestedResponseDto {
  @ApiProperty({
    example: 'If the email belongs to an account, a reset link has been sent.',
    description: 'Constant message; it never reveals whether the email is registered.',
  })
  message!: string;
}
