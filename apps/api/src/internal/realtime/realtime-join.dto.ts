import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { ShopItemKind } from '@prisma/client';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { APPEARANCE_SLOT_NAMES, type AppearanceSlotName } from '@aula/contracts';

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

/** Re-check of a user admitted earlier; carries ids, never a token. */
export class AccessReverificationRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'userId must be a UUID' })
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'sessionId must be a UUID' })
  sessionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID(undefined, { message: 'classroomId must be a UUID' })
  classroomId!: string;
}

/** One equipped item broadcast in a member's appearance: public catalog fields only (#114). */
export class EquippedItemPayloadDto {
  @ApiProperty({ enum: APPEARANCE_SLOT_NAMES, enumName: 'AppearanceSlotName' })
  slot!: AppearanceSlotName;

  @ApiProperty({ format: 'uuid' })
  shopItemId!: string;

  @ApiProperty({ maxLength: 80, example: 'cap_blue' })
  shopItemCode!: string;

  @ApiProperty({ maxLength: 120, example: 'Blue Classroom Cap' })
  shopItemName!: string;

  @ApiProperty({ enum: ShopItemKind, enumName: 'ShopItemKind' })
  kind!: ShopItemKind;
}

/** Base avatar of a member's appearance: the five public `AvatarDto` fields, nothing else (#114). */
export class BaseAvatarPayloadDto {
  @ApiProperty({ example: 'female' })
  bodyId!: string;

  @ApiProperty({ example: 'afro' })
  hairId!: string;

  @ApiProperty({ example: 'tshirt' })
  topId!: string;

  @ApiProperty({ example: '#6C4D48' })
  hairColor!: string;

  @ApiProperty({ example: '#5B4F96' })
  clothingColor!: string;
}

/**
 * Public appearance of one classroom member: base avatar plus equipped items per slot. Mirrors
 * `MemberAppearance` in `@aula/contracts` (slot names from `APPEARANCE_SLOT_NAMES`).
 */
@ApiExtraModels(EquippedItemPayloadDto)
export class MemberAppearanceDto {
  @ApiProperty({ type: BaseAvatarPayloadDto })
  baseAvatar!: BaseAvatarPayloadDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(EquippedItemPayloadDto), nullable: true },
    example: { head: null, face: null, back: null, desk_decor: null },
    description: 'Equipped item per slot; null when the slot is empty.',
  })
  items!: Record<AppearanceSlotName, EquippedItemPayloadDto | null>;
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

  /** Public appearance data only (#114): base avatar and equipped items, no private fields. */
  @ApiProperty({ type: MemberAppearanceDto })
  appearance!: MemberAppearanceDto;

  /** Internal ordering token for appearance snapshots; not part of the synchronized avatar. */
  @ApiProperty({ minimum: 0 })
  appearanceRevision!: number;
}
