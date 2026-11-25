import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { TUTOR_BOT_SKINS, type TutorBotSkin } from '@aula/contracts';
import { VisibleText } from '../../http/visible-text';

export class UpdateClassroomDto {
  @ApiPropertyOptional({
    example: '3° Año B - Matemática Avanzada',
    description: 'Updated display name of the virtual classroom',
    maxLength: 120,
  })
  @IsOptional()
  @VisibleText('name')
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  @MaxLength(120, { message: 'name must not exceed 120 characters' })
  name?: string;

  @ApiPropertyOptional({
    example: 'Álgebra y Análisis',
    description: 'Updated subject or course description for the classroom',
    maxLength: 200,
    nullable: true,
  })
  @IsOptional()
  @VisibleText('subject')
  @IsString({ message: 'subject must be a string' })
  @IsNotEmpty({ message: 'subject must not be empty when provided' })
  @MaxLength(200, { message: 'subject must not exceed 200 characters' })
  subject?: string | null;

  @ApiPropertyOptional({
    example: false,
    description:
      'Whether the classroom runs in adult education mode (preserves existing parent links in DB while disabling parent access)',
  })
  @IsOptional()
  @IsBoolean({ message: 'adultMode must be a boolean' })
  adultMode?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether the classroom student chat channel is muted',
  })
  @IsOptional()
  @IsBoolean({ message: 'chatMuted must be a boolean' })
  chatMuted?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether collaborative editing in the classroom is locked',
  })
  @IsOptional()
  @IsBoolean({ message: 'collaborationLocked must be a boolean' })
  collaborationLocked?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Whether interactive classroom games are disabled',
  })
  @IsOptional()
  @IsBoolean({ message: 'gamesDisabled must be a boolean' })
  gamesDisabled?: boolean;

  @ApiPropertyOptional({
    enum: TUTOR_BOT_SKINS,
    enumName: 'TutorBotSkin',
    example: 'guardapolvo',
    description:
      'Skin of the classroom tutor bot, free to change; `none` removes it. Pushed to the live room',
  })
  @IsOptional()
  @IsIn(TUTOR_BOT_SKINS, { message: `tutorBotSkin must be one of: ${TUTOR_BOT_SKINS.join(', ')}` })
  tutorBotSkin?: TutorBotSkin;
}
