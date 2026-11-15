import { ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { EquippedSlot, ShopItemKind } from '@prisma/client';
import { IsOptional, IsUUID } from 'class-validator';
import { NotFoundException } from '@nestjs/common';

/** URL slot names accepted by the equipment endpoints. */
export const EQUIPPED_SLOT_NAMES = ['head', 'face', 'back', 'desk_decor'] as const;
export type EquippedSlotName = (typeof EQUIPPED_SLOT_NAMES)[number];

export const SLOT_NAME_BY_ENUM: Record<EquippedSlot, EquippedSlotName> = {
  [EquippedSlot.HEAD]: 'head',
  [EquippedSlot.FACE]: 'face',
  [EquippedSlot.BACK]: 'back',
  [EquippedSlot.DESK_DECOR]: 'desk_decor',
};

export const SLOT_ENUM_BY_NAME: Record<EquippedSlotName, EquippedSlot> = {
  head: EquippedSlot.HEAD,
  face: EquippedSlot.FACE,
  back: EquippedSlot.BACK,
  desk_decor: EquippedSlot.DESK_DECOR,
};

/**
 * Validates the `:slot` path parameter against the known equipment slot names.
 * Throws `404 NOT_FOUND` for any unknown name (including wrong casing).
 */
export function parseEquippedSlotName(raw: string): EquippedSlotName {
  if (!(EQUIPPED_SLOT_NAMES as readonly string[]).includes(raw)) {
    throw new NotFoundException('Unknown equipment slot');
  }
  return raw as EquippedSlotName;
}

/** Strict request body for `PUT /classrooms/:id/me/equipment/:slot`. */
export class EquipItemDto {
  @ApiProperty({
    nullable: true,
    format: 'uuid',
    description:
      'UUID of the purchased shop item to equip in the slot, or null to unequip the slot.',
    example: '00000000-0000-4000-8000-000000000101',
  })
  @IsOptional()
  @IsUUID('4')
  shopItemId!: string | null;
}

/** One equipped purchase projection inside a slot. */
export class EquippedSlotDto {
  @ApiProperty({ enum: EQUIPPED_SLOT_NAMES, enumName: 'EquippedSlotName' })
  slot!: EquippedSlotName;

  @ApiProperty({ format: 'uuid' })
  shopItemId!: string;

  @ApiProperty({ maxLength: 80, example: 'cap_blue' })
  shopItemCode!: string;

  @ApiProperty({ maxLength: 120, example: 'Blue Classroom Cap' })
  shopItemName!: string;

  @ApiProperty({ enum: ShopItemKind, enumName: 'ShopItemKind' })
  kind!: ShopItemKind;
}

/** Classroom-scoped equipment state of the authenticated student. */
export class EquipmentStateDto {
  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { $ref: getSchemaPath(EquippedSlotDto), nullable: true },
    example: { head: null, face: null, back: null, desk_decor: null },
    description: 'Equipped purchase per slot; null when the slot is empty.',
  })
  slots!: Record<EquippedSlotName, EquippedSlotDto | null>;
}
