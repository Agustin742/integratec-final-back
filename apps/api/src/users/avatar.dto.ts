import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn } from 'class-validator';

export const HAIR_COLORS = ['#6C4D48', '#AF6D63', '#E5AD58', '#353849', '#C77DAA'];
export const CLOTHING_COLORS = ['#5B4F96', '#75B7DA', '#F2C85C', '#EFA5AE', '#7EBA8B', '#F4E6D2'];
export const BASE_OPTIONS: Record<string, { hairId: string[]; topId: string[] }> = {
  male: { hairId: ['afro', 'dreads'], topId: ['hoodie', 'tank'] },
  female: { hairId: ['afro', 'original'], topId: ['hoodie', 'tank', 'tshirt'] },
};
const uppercase = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.toUpperCase() : value;

/** Complete base appearance snapshot, used for both requests and responses. */
export class AvatarDto {
  @ApiProperty({ enum: ['male', 'female'], example: 'male' })
  @IsIn(['male', 'female'])
  bodyId!: string;

  @ApiProperty({
    enum: ['afro', 'dreads', 'original'],
    example: 'afro',
    description: 'male: afro/dreads; female: afro/original.',
  })
  @IsIn(['afro', 'dreads', 'original'])
  hairId!: string;

  @ApiProperty({
    enum: ['hoodie', 'tank', 'tshirt'],
    example: 'hoodie',
    description: 'male: hoodie/tank; female: hoodie/tank/tshirt. Uniforms excluded.',
  })
  @IsIn(['hoodie', 'tank', 'tshirt'])
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
  hairId: 'afro',
  topId: 'hoodie',
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
