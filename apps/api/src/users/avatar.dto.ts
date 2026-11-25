import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';
import { AVATAR_BODY_IDS, HAIR_IDS, TOP_IDS } from './avatar-catalog';

export const HAIR_COLORS = ['#6C4D48', '#AF6D63', '#E5AD58', '#353849', '#C77DAA'];
export const CLOTHING_COLORS = ['#5B4F96', '#75B7DA', '#F2C85C', '#EFA5AE', '#7EBA8B', '#F4E6D2'];
export const BASE_OPTIONS: Record<string, { hairId: readonly string[]; topId: readonly string[] }> =
  Object.fromEntries(
    AVATAR_BODY_IDS.map((bodyId) => [bodyId, { hairId: HAIR_IDS, topId: TOP_IDS }]),
  );
const uppercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toUpperCase() : value;

/** Complete base appearance snapshot, used for both requests and responses. */
export class AvatarDto {
  @ApiProperty({ enum: AVATAR_BODY_IDS, example: 'male' })
  @IsIn(AVATAR_BODY_IDS)
  bodyId!: string;

  @ApiProperty({
    enum: HAIR_IDS,
    example: 'classic-short',
    description: 'Allowed for both bodies. Some styles are unlocked through the shop.',
  })
  @IsIn(HAIR_IDS)
  hairId!: string;

  @ApiProperty({
    enum: TOP_IDS,
    example: 'school-sweatshirt',
    description: 'Allowed for both bodies. Some styles are unlocked through the shop.',
  })
  @IsIn(TOP_IDS)
  topId!: string;

  @ApiProperty({
    enum: HAIR_COLORS,
    example: '#6C4D48',
    description: 'Case-insensitive; returned uppercase.',
  })
  @Transform(uppercase)
  @IsIn(HAIR_COLORS)
  hairColor!: string;

  @ApiProperty({
    enum: CLOTHING_COLORS,
    example: '#5B4F96',
    description: 'Case-insensitive; returned uppercase.',
  })
  @Transform(uppercase)
  @IsIn(CLOTHING_COLORS)
  clothingColor!: string;
}

export const DEFAULT_AVATAR: Readonly<AvatarDto> = {
  bodyId: 'male',
  hairId: 'classic-short',
  topId: 'school-sweatshirt',
  hairColor: '#6C4D48',
  clothingColor: '#5B4F96',
};

/** Explicit projection also strips unknown keys from previously stored JSON. */
export function avatarSnapshot(value: AvatarDto): AvatarDto {
  return {
    bodyId: value.bodyId,
    hairId: value.hairId,
    topId: value.topId,
    hairColor: value.hairColor,
    clothingColor: value.clothingColor,
  };
}
