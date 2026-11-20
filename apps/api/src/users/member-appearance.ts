import { UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Prisma } from '@prisma/client';
import type { AppearanceSlotName } from '@aula/contracts';
import { SLOT_NAME_BY_ENUM } from '../equipment/equipment.dto';
import type { EquippedItemPayloadDto } from '../internal/realtime/realtime-join.dto';
import { compatibilityErrors } from './avatar-access.port';
import { AvatarDto, avatarSnapshot, DEFAULT_AVATAR } from './avatar.dto';

/**
 * Single place the public appearance snapshots are built from (#114), so the join-verification
 * answer and the `realtime.classroom-appearance-changed` outbox payload cannot diverge. Accepts
 * the caller's transaction client, so a snapshot can be read inside the transaction that caused
 * the change it describes.
 */
export type AppearanceReader = Pick<Prisma.TransactionClient, 'user' | 'equippedItem'>;

export interface ReadBaseAppearanceOptions {
  /**
   * Called when the stored JSON is unsupported and the default avatar is used instead; the
   * caller decides how to log it, keeping `UsersService.readAppearance`'s privacy-safe warning.
   */
  onUnsupported?: () => void;
}

/** Serializes all appearance writers for a user without changing the profile's `updatedAt`. */
export async function advanceAppearanceRevision(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const updatedRows = await tx.$executeRaw`
    UPDATE "users"
    SET "appearance_revision" = "appearance_revision" + 1
    WHERE "id" = ${userId}::uuid
  `;
  if (updatedRows !== 1) throw new Error('Appearance revision owner was not found');
}

/**
 * Reads the stored base-avatar JSON with the exact `UsersService.readAppearance` semantics: absent
 * or empty storage yields the default avatar, unsupported values fall back to the default avatar
 * through the caller's `onUnsupported`, and valid storage is projected to the five public fields.
 */
export function readBaseAppearance(
  value: Prisma.JsonValue | undefined,
  options: ReadBaseAppearanceOptions = {},
): AvatarDto {
  if (
    value === undefined ||
    (value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  ) {
    return { ...DEFAULT_AVATAR };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    options.onUnsupported?.();
    return { ...DEFAULT_AVATAR };
  }
  const appearance = plainToInstance(AvatarDto, avatarSnapshot(value as unknown as AvatarDto));
  if (validateSync(appearance).length || compatibilityErrors(appearance).length) {
    options.onUnsupported?.();
    return { ...DEFAULT_AVATAR };
  }
  return avatarSnapshot(appearance);
}

/** All four slots are always present, null when nothing is equipped. */
export async function equippedItemsFor(
  client: AppearanceReader,
  userId: string,
  classroomId: string,
): Promise<Record<AppearanceSlotName, EquippedItemPayloadDto | null>> {
  const equipped = await client.equippedItem.findMany({
    where: { classroomId, studentId: userId },
    select: {
      slot: true,
      shopItem: { select: { id: true, code: true, name: true, kind: true } },
    },
  });
  const items: Record<AppearanceSlotName, EquippedItemPayloadDto | null> = {
    head: null,
    face: null,
    back: null,
    desk_decor: null,
  };
  for (const row of equipped) {
    const slot = SLOT_NAME_BY_ENUM[row.slot];
    items[slot] = {
      slot,
      shopItemId: row.shopItem.id,
      shopItemCode: row.shopItem.code,
      shopItemName: row.shopItem.name,
      kind: row.shopItem.kind,
    };
  }
  return items;
}

/** A member's public appearance in one classroom, plus the display name read on the way. */
export interface MemberAppearanceSnapshot {
  displayName: string;
  appearanceRevision: number;
  appearance: {
    baseAvatar: AvatarDto;
    items: Record<AppearanceSlotName, EquippedItemPayloadDto | null>;
  };
}

/**
 * Builds the full per-classroom appearance snapshot: the global base avatar plus this classroom's
 * equipped items. Throws `401` semantics (as `RealtimeAccessService.identityFor` did) when the
 * user no longer exists.
 */
export async function memberAppearanceFor(
  client: AppearanceReader,
  userId: string,
  classroomId: string,
  options: ReadBaseAppearanceOptions = {},
): Promise<MemberAppearanceSnapshot> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      appearanceRevision: true,
      avatarConfig: { select: { appearance: true } },
    },
  });
  if (user === null) throw new UnauthorizedException();
  return {
    displayName: user.displayName,
    appearanceRevision: user.appearanceRevision,
    appearance: {
      baseAvatar: readBaseAppearance(user.avatarConfig?.appearance, options),
      items: await equippedItemsFor(client, userId, classroomId),
    },
  };
}
