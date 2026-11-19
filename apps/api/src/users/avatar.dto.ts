import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

export const HAIR_COLORS = ['#6C4D48', '#AF6D63', '#E5AD58', '#353849', '#C77DAA'];
export const CLOTHING_COLORS = ['#5B4F96', '#75B7DA', '#F2C85C', '#EFA5AE', '#7EBA8B', '#F4E6D2'];
export const BASE_OPTIONS: Record<string, { hairId: string[]; topId: string[] }> = {
  male: {
    hairId: ['afro', 'dreads', 'short-messy', 'buzz', 'curls'],
    topId: ['hoodie', 'tank', 'tshirt', 'sweater-shirt-tie'],
  },
  female: {
    hairId: ['afro', 'original', 'ponytail', 'bob', 'bun'],
    topId: ['hoodie', 'tank', 'tshirt', 'sweater-shirt-tie'],
  },
};
const ALL_HAIR_IDS = [...new Set(Object.values(BASE_OPTIONS).flatMap((o) => o.hairId))];
const ALL_TOP_IDS = [...new Set(Object.values(BASE_OPTIONS).flatMap((o) => o.topId))];
const uppercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toUpperCase() : value;

/** Complete base appearance snapshot, used for both requests and responses. */
export class AvatarDto {
  @ApiProperty({ enum: ['male', 'female'], example: 'male' })
  @IsIn(['male', 'female'])
  bodyId!: string;

  @ApiProperty({
    enum: ALL_HAIR_IDS,
    example: 'short-messy',
    description:
      'male: afro/dreads/short-messy/buzz/curls; female: afro/original/ponytail/bob/bun.',
  })
  @IsIn(ALL_HAIR_IDS)
  hairId!: string;

  @ApiProperty({
    enum: ALL_TOP_IDS,
    example: 'sweater-shirt-tie',
    description: 'Both bodies: hoodie/tank/tshirt/sweater-shirt-tie. Uniforms excluded.',
  })
  @IsIn(ALL_TOP_IDS)
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
  hairId: 'short-messy',
  topId: 'sweater-shirt-tie',
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
