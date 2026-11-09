import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { AvatarDto } from './avatar.dto';

const forbiddenNameCharacters = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export class UpdateProfileDto {
  @ApiProperty({
    minLength: 1,
    maxLength: 100,
    example: 'Prof. Ana',
    description:
      '1–100 characters after surrounding-space trimming. C0/C1 controls and Unicode line/paragraph separators are rejected before trimming; requires a character other than whitespace, default-ignorables, combining marks or braille blank. Unicode names, punctuation and joiners within visible names are preserved.',
  })
  // Keep forbidden raw characters for validation: trim must not erase edge newlines/tabs.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && !forbiddenNameCharacters.test(value) ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^(?!.*[\p{Cc}\p{Zl}\p{Zp}])/su, {
    message: 'displayName must not contain control characters or line breaks',
  })
  @Matches(/[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{M}\u2800]/u, {
    message: 'displayName must contain a visible character',
  })
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
