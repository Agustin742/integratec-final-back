import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { AvatarDto } from './avatar.dto';

export class UpdateProfileDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'Prof. Ana',
    description: 'Trimmed before validation.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;
}

export class OwnProfileDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'teacher@example.test' })
  email!: string;

  @ApiProperty({ example: 'Prof. Ana' })
  displayName!: string;

  @ApiProperty({ type: AvatarDto })
  avatar!: AvatarDto;
}
