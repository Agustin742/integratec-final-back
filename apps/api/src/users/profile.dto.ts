import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { VisibleText } from '../http/visible-text';
import { AvatarDto } from './avatar.dto';

export class UpdateProfileDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'Prof. Ana',
    description:
      '1–100 characters after surrounding-space trimming. C0/C1 controls and Unicode line/paragraph separators are rejected before trimming; requires a character other than whitespace, default-ignorables, combining marks or braille blank. Unicode names, punctuation and joiners within visible names are preserved.',
  })
  @VisibleText('displayName')
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
