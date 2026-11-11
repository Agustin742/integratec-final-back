import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** Upper bound for a presented access token; real JWTs are a few hundred characters. */
export const JOIN_ACCESS_TOKEN_MAX_LENGTH = 4096;

export class JoinVerificationRequestDto {
  @ApiProperty({ maxLength: JOIN_ACCESS_TOKEN_MAX_LENGTH })
  @IsString({ message: 'accessToken must be a string' })
  @IsNotEmpty({ message: 'accessToken must not be empty' })
  @MaxLength(JOIN_ACCESS_TOKEN_MAX_LENGTH, {
    message: `accessToken must not exceed ${JOIN_ACCESS_TOKEN_MAX_LENGTH} characters`,
  })
  accessToken!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'classroomId must be a UUID' })
  classroomId!: string;
}

export class JoinVerificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  /** Parents never receive a live join (rules/realtime-and-presence.md). */
  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'TEACHER', 'STUDENT'] })
  role!: 'OWNER' | 'ADMIN' | 'TEACHER' | 'STUDENT';

  /** Name shown on the user's avatar in the live room. */
  @ApiProperty({ maxLength: 100 })
  displayName!: string;
}
