import { ApiProperty } from '@nestjs/swagger';

export const AVATAR_STYLE_TYPES = ['hair', 'top'] as const;

/** Availability of one hair or top style for the authenticated user. */
export class AvatarStyleAvailabilityDto {
  @ApiProperty({ enum: AVATAR_STYLE_TYPES, example: 'hair' })
  styleType!: (typeof AVATAR_STYLE_TYPES)[number];

  @ApiProperty({ example: 'dreads', description: 'Catalog id used in `hairId` or `topId`.' })
  styleId!: string;

  @ApiProperty({ description: 'Free styles never need a purchase.' })
  free!: boolean;

  @ApiProperty({
    description:
      'True for free styles and for paid styles the user bought in any classroom. Ownership is global to the user.',
  })
  owned!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'hair_dreads',
    description:
      'Code of the shop item that sells the style, or null for free styles and styles not yet on sale. Buy it through the classroom shop.',
  })
  shopItemCode!: string | null;
}

export class AvatarStylesDto {
  @ApiProperty({
    type: [AvatarStyleAvailabilityDto],
    description: 'Every hair id followed by every top id, alphabetical within each type.',
  })
  items!: AvatarStyleAvailabilityDto[];
}
