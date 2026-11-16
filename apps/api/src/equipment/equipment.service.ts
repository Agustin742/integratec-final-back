import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ShopItemKind } from '@prisma/client';
import { AccessVerificationService } from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  type EquipItemDto,
  type EquipmentStateDto,
  type EquippedSlotDto,
  type EquippedSlotName,
  EQUIPPED_SLOT_NAMES,
  SLOT_ENUM_BY_NAME,
  SLOT_NAME_BY_ENUM,
  parseEquippedSlotName,
} from './equipment.dto';
import { EquipmentRateLimiter } from './equipment-rate-limiter.service';

type EquipmentRow = Prisma.EquippedItemGetPayload<{
  include: { shopItem: { select: { code: true; name: true; kind: true } } };
}>;

function toMetadataRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Resolves the slot an item must be equipped into from its kind and `metadata.slot`,
 * throwing `409 CONFLICT` for non-equipable kinds or missing/invalid slot metadata.
 */
function deriveSlotForItem(kind: ShopItemKind, metadata: Prisma.JsonValue): EquippedSlotName {
  const slot = toMetadataRecord(metadata).slot;
  if (typeof slot !== 'string' || !(EQUIPPED_SLOT_NAMES as readonly string[]).includes(slot)) {
    throw new ConflictException('Shop item metadata does not declare a valid equipment slot');
  }

  const compatible =
    (kind === ShopItemKind.AVATAR_ACCESSORY && slot !== 'desk_decor') ||
    (kind === ShopItemKind.DESK_UPGRADE && slot === 'desk_decor');
  if (!compatible) {
    throw new ConflictException('Shop item kind does not fit the declared equipment slot');
  }

  return slot as EquippedSlotName;
}

function toSlotDto(row: EquipmentRow): EquippedSlotDto {
  return {
    slot: SLOT_NAME_BY_ENUM[row.slot],
    shopItemId: row.shopItemId,
    shopItemCode: row.shopItem.code,
    shopItemName: row.shopItem.name,
    kind: row.shopItem.kind,
  };
}

function buildState(
  classroomId: string,
  studentId: string,
  rows: EquipmentRow[],
): EquipmentStateDto {
  const slots: Record<EquippedSlotName, EquippedSlotDto | null> = {
    head: null,
    face: null,
    back: null,
    desk_decor: null,
  };
  for (const row of rows) {
    slots[SLOT_NAME_BY_ENUM[row.slot]] = toSlotDto(row);
  }
  return { classroomId, studentId, slots };
}

/**
 * Classroom-scoped student equipment state: one equipped purchase per
 * `(classroom, student, slot)`, with DB-verified ownership against
 * `StudentPurchase` (the realization of the ownership port left by card #20).
 */
@Injectable()
export class EquipmentService {
  private readonly logger = new Logger(EquipmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly rateLimiter: EquipmentRateLimiter,
  ) {}

  /** Returns the authenticated student's own classroom-scoped equipment state. */
  async getEquipment(actorUserId: string, classroomId: string): Promise<EquipmentStateDto> {
    await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STUDENT',
    });

    const rows = await this.prisma.equippedItem.findMany({
      where: { classroomId, studentId: actorUserId },
      include: { shopItem: { select: { code: true, name: true, kind: true } } },
    });
    return buildState(classroomId, actorUserId, rows);
  }

  /**
   * Equips or unequips one slot atomically. Rejected operations never change
   * persisted state: the slot validation (`404`), item validation (`404`),
   * kind/slot compatibility (`409`), and ownership check (`403`) all run
   * inside the equip transaction before any write.
   */
  async setSlot(
    actorUserId: string,
    classroomId: string,
    rawSlot: string,
    dto: EquipItemDto,
  ): Promise<EquipmentStateDto> {
    const slotName = parseEquippedSlotName(rawSlot);

    await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STUDENT',
    });

    this.rateLimiter.consume(actorUserId);

    const slot = SLOT_ENUM_BY_NAME[slotName];

    await this.prisma.$transaction(async (tx) => {
      if (dto.shopItemId === null || dto.shopItemId === undefined) {
        await tx.equippedItem.deleteMany({
          where: { classroomId, studentId: actorUserId, slot },
        });
        return;
      }

      const shopItemId: string = dto.shopItemId;
      const item = await tx.shopItem.findUnique({
        where: { id: shopItemId },
        select: { kind: true, metadata: true },
      });
      if (!item) {
        throw new NotFoundException('Shop item is not available in this classroom');
      }

      const expectedSlot = deriveSlotForItem(item.kind, item.metadata);
      if (expectedSlot !== slotName) {
        throw new ConflictException('Shop item does not fit this equipment slot');
      }

      const purchase = await tx.studentPurchase.findUnique({
        where: {
          classroomId_studentId_shopItemId: {
            classroomId,
            studentId: actorUserId,
            shopItemId,
          },
        },
        select: { id: true },
      });
      if (!purchase) {
        throw new ForbiddenException('Shop item has not been purchased in this classroom');
      }

      await tx.$executeRaw`
        INSERT INTO "equipped_items" (
          "id",
          "classroom_id",
          "student_id",
          "slot",
          "shop_item_id",
          "created_at",
          "updated_at"
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${classroomId}::uuid,
          ${actorUserId}::uuid,
          ${slotName}::"equipped_slot",
          ${shopItemId}::uuid,
          NOW(),
          NOW()
        )
        ON CONFLICT ("classroom_id", "student_id", "slot")
        DO UPDATE SET
          "shop_item_id" = EXCLUDED."shop_item_id",
          "updated_at" = NOW()
      `;
    });

    // Non-PII structured audit log per rules/observability-and-privacy.md.
    this.logger.log({
      event:
        dto.shopItemId === null || dto.shopItemId === undefined
          ? 'shop_item_unequipped'
          : 'shop_item_equipped',
      classroomId,
      studentId: actorUserId,
      slot: slotName,
      ...(dto.shopItemId === null || dto.shopItemId === undefined
        ? {}
        : { shopItemId: dto.shopItemId }),
    });

    const rows = await this.prisma.equippedItem.findMany({
      where: { classroomId, studentId: actorUserId },
      include: { shopItem: { select: { code: true, name: true, kind: true } } },
    });
    return buildState(classroomId, actorUserId, rows);
  }
}
