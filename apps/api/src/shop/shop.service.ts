import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ClassroomItemState, Prisma, ShopItemKind } from '@prisma/client';
import { AccessVerificationService } from '../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import { parseSort } from '../http/pagination/sort';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { isUniqueViolation } from '../prisma/unique-violation';
import { ShopPurchaseRateLimiter } from './shop-purchase-rate-limiter.service';
import {
  parseIdempotencyKeyHeader,
  SHOP_ITEM_SORT_OPTIONS,
  SHOP_PURCHASE_SORT_OPTIONS,
  type ClassroomItemDto,
  type ListShopItemsQueryDto,
  type ListShopPurchasesQueryDto,
  type PurchaseResponseDto,
  type PurchaseShopItemDto,
  type ShopCatalogItemDto,
  type StudentPurchaseDto,
} from './shop.dto';

export const SHOP_PURCHASE_SOURCE_TYPE = 'shop_purchase';

type LockedShopItemRow = {
  id: string;
  code: string;
  name: string;
  description: string;
  kind: ShopItemKind | string;
  defaultPrice: number;
  isActive: boolean;
  isImplemented: boolean;
  priceOverride: number | null;
  isEnabled: boolean | null;
};

type PurchaseRowWithItem = Prisma.StudentPurchaseGetPayload<{
  include: {
    shopItem: { select: { code: true; name: true; kind: true } };
    classroomItem: true;
  };
}>;

type CreatedPurchaseRow = Prisma.StudentPurchaseGetPayload<{
  include: {
    shopItem: { select: { code: true; name: true; kind: true } };
  };
}>;

type ClassroomItemRow = Prisma.ClassroomItemGetPayload<Record<string, never>>;

/**
 * Derives a deterministic `<= 128`-char ledger idempotency key scoped by
 * `(classroomId, studentId, idempotencyKey)` without truncation collisions.
 */
export function buildShopLedgerIdempotencyKey(
  classroomId: string,
  studentId: string,
  idempotencyKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${classroomId}:${studentId}:${idempotencyKey}`)
    .digest('hex');
  return `shop:${digest}`;
}

function mapShopItemKind(raw: ShopItemKind | string): ShopItemKind {
  switch (raw) {
    case ShopItemKind.CLASSROOM_ITEM:
    case 'classroom_item':
      return ShopItemKind.CLASSROOM_ITEM;
    case ShopItemKind.AVATAR_ACCESSORY:
    case 'avatar_accessory':
      return ShopItemKind.AVATAR_ACCESSORY;
    case ShopItemKind.DESK_UPGRADE:
    case 'desk_upgrade':
      return ShopItemKind.DESK_UPGRADE;
    case ShopItemKind.PET_ACCESSORY:
    case 'pet_accessory':
      return ShopItemKind.PET_ACCESSORY;
    default:
      throw new Error(`Unsupported shop item kind: ${String(raw)}`);
  }
}

function toMetadataRecord(value: Prisma.JsonValue): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toPurchaseDto(row: CreatedPurchaseRow | PurchaseRowWithItem): StudentPurchaseDto {
  return {
    id: row.id,
    classroomId: row.classroomId,
    studentId: row.studentId,
    shopItemId: row.shopItemId,
    shopItemCode: row.shopItem.code,
    shopItemName: row.shopItem.name,
    shopItemKind: row.shopItem.kind,
    pointTransactionId: row.pointTransactionId,
    pricePaid: row.pricePaid,
    createdAt: row.createdAt.toISOString(),
  };
}

function toClassroomItemDto(row: ClassroomItemRow): ClassroomItemDto {
  return {
    id: row.id,
    classroomId: row.classroomId,
    shopItemId: row.shopItemId,
    purchaseId: row.purchaseId,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Server-owned classroom shop catalog, purchase history, and atomic purchase workflow.
 * Prices, item availability, and balances are always resolved server-side.
 */
@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly pointsLedger: PointsLedgerService,
    private readonly rateLimiter: ShopPurchaseRateLimiter,
  ) {}

  /**
   * Lists active shop catalog items available in the classroom for an enrolled student,
   * resolving per-classroom price overrides and ownership flags.
   */
  async listItems(
    actorUserId: string,
    classroomId: string,
    query: ListShopItemsQueryDto,
  ): Promise<Paginated<ShopCatalogItemDto>> {
    await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STUDENT',
    });

    const sort = parseSort(query.sort, SHOP_ITEM_SORT_OPTIONS);
    const where: Prisma.ShopItemWhereInput = {
      isActive: true,
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      NOT: {
        classroomOverrides: {
          some: {
            classroomId,
            isEnabled: false,
          },
        },
      },
    };
    const orderBy: Prisma.ShopItemOrderByWithRelationInput[] = [
      { [sort.field]: sort.direction },
      { id: sort.direction },
    ];

    const [total, rows] = await this.prisma.$transaction(
      [
        this.prisma.shopItem.count({ where }),
        this.prisma.shopItem.findMany({
          where,
          orderBy,
          ...toSkipTake(query),
          include: {
            classroomOverrides: {
              where: { classroomId },
              select: { priceOverride: true, isEnabled: true },
            },
            purchases: {
              where: { classroomId, studentId: actorUserId },
              select: { id: true },
            },
            classroomItems: {
              where: { classroomId },
              select: { id: true },
            },
          },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const items: ShopCatalogItemDto[] = rows.map((row) => {
      const override = row.classroomOverrides[0];
      const ownedByStudent = row.purchases.length > 0;
      const ownedByClassroom = row.classroomItems.length > 0;
      const isPurchasable =
        row.isImplemented &&
        !ownedByStudent &&
        !(row.kind === ShopItemKind.CLASSROOM_ITEM && ownedByClassroom);

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        kind: row.kind,
        price: override?.priceOverride ?? row.defaultPrice,
        isImplemented: row.isImplemented,
        isPurchasable,
        ownedByStudent,
        ownedByClassroom,
        metadata: toMetadataRecord(row.metadata),
        createdAt: row.createdAt.toISOString(),
      };
    });

    return paginated(items, total, query);
  }

  /** Lists the authenticated student's own purchases in the classroom. */
  async listPurchases(
    actorUserId: string,
    classroomId: string,
    query: ListShopPurchasesQueryDto,
  ): Promise<Paginated<StudentPurchaseDto>> {
    await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STUDENT',
    });

    const sort = parseSort(query.sort, SHOP_PURCHASE_SORT_OPTIONS);
    const where: Prisma.StudentPurchaseWhereInput = {
      classroomId,
      studentId: actorUserId,
    };
    const orderBy: Prisma.StudentPurchaseOrderByWithRelationInput[] = [
      { [sort.field]: sort.direction },
      { id: sort.direction },
    ];

    const [total, rows] = await this.prisma.$transaction(
      [
        this.prisma.studentPurchase.count({ where }),
        this.prisma.studentPurchase.findMany({
          where,
          orderBy,
          ...toSkipTake(query),
          include: {
            shopItem: { select: { code: true, name: true, kind: true } },
          },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return paginated(rows.map(toPurchaseDto), total, query);
  }

  /**
   * Atomically purchases a catalog shop item for an enrolled student in a classroom.
   * Serializes per-student attempts via `FOR UPDATE OF cm`, resolves idempotent retries before
   * debiting the ledger, and rolls back the entire transaction on any ownership or balance conflict.
   */
  async purchase(
    actorUserId: string,
    classroomId: string,
    dto: PurchaseShopItemDto,
    rawIdempotencyKey: unknown,
  ): Promise<PurchaseResponseDto> {
    const idempotencyKey = parseIdempotencyKeyHeader(rawIdempotencyKey);
    this.rateLimiter.consume(actorUserId);

    await this.access.verifyClassroomAccess(actorUserId, classroomId, {
      requiredRole: 'STUDENT',
    });

    let result: PurchaseResponseDto;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockActiveStudentMembership(tx, classroomId, actorUserId);

        const existingByKey = await tx.studentPurchase.findUnique({
          where: {
            classroomId_studentId_idempotencyKey: {
              classroomId,
              studentId: actorUserId,
              idempotencyKey,
            },
          },
          include: {
            shopItem: { select: { code: true, name: true, kind: true } },
            classroomItem: true,
          },
        });
        if (existingByKey) {
          if (existingByKey.shopItemId !== dto.shopItemId) {
            throw new ConflictException('Idempotency key already used for a different item');
          }
          const balance = await this.pointsLedger.getBalance(classroomId, actorUserId, tx);
          return {
            purchase: toPurchaseDto(existingByKey),
            classroomItem: existingByKey.classroomItem
              ? toClassroomItemDto(existingByKey.classroomItem)
              : null,
            balance,
            replayed: true,
          };
        }

        const item = await this.readLockedCatalogItem(tx, classroomId, dto.shopItemId);
        if (!item || !item.isActive || item.isEnabled === false) {
          throw new NotFoundException('Shop item is not available in this classroom');
        }
        if (!item.isImplemented) {
          throw new ConflictException('Shop item is not implemented and cannot be purchased');
        }

        const kind = mapShopItemKind(item.kind);
        await this.assertNotAlreadyOwned(tx, classroomId, actorUserId, item.id, kind);

        const effectivePrice = item.priceOverride ?? item.defaultPrice;
        const purchaseId = randomUUID();
        const scopedLedgerKey = buildShopLedgerIdempotencyKey(
          classroomId,
          actorUserId,
          idempotencyKey,
        );

        const debitResult = await this.pointsLedger.debit(
          {
            classroomId,
            studentId: actorUserId,
            amount: effectivePrice,
            sourceType: SHOP_PURCHASE_SOURCE_TYPE,
            sourceId: purchaseId,
            actorId: actorUserId,
            idempotencyKey: scopedLedgerKey,
            reason: `Shop purchase: ${item.name}`,
          },
          tx,
        );

        const createdPurchase = await tx.studentPurchase.create({
          data: {
            id: purchaseId,
            classroomId,
            studentId: actorUserId,
            shopItemId: item.id,
            pointTransactionId: debitResult.entry.id,
            pricePaid: effectivePrice,
            idempotencyKey,
          },
          include: {
            shopItem: { select: { code: true, name: true, kind: true } },
          },
        });

        let createdClassroomItem: ClassroomItemDto | null = null;
        if (kind === ShopItemKind.CLASSROOM_ITEM) {
          const classroomItemRow = await tx.classroomItem.create({
            data: {
              classroomId,
              shopItemId: item.id,
              purchaseId: createdPurchase.id,
              state: ClassroomItemState.ACTIVE,
            },
          });
          createdClassroomItem = toClassroomItemDto(classroomItemRow);
        }

        const balance = await this.pointsLedger.getBalance(classroomId, actorUserId, tx);
        return {
          purchase: toPurchaseDto(createdPurchase),
          classroomItem: createdClassroomItem,
          balance,
          replayed: false,
        };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Shop item is already owned');
      }
      throw error;
    }

    if (!result.replayed) {
      // Non-PII structured audit log per rules/observability-and-privacy.md.
      this.logger.log({
        event: 'shop_item_purchased',
        classroomId,
        studentId: actorUserId,
        purchaseId: result.purchase.id,
        shopItemId: result.purchase.shopItemId,
        kind: result.purchase.shopItemKind,
        pricePaid: result.purchase.pricePaid,
      });
    }

    return result;
  }

  private async lockActiveStudentMembership(
    tx: Prisma.TransactionClient,
    classroomId: string,
    studentId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT cm."id"
      FROM "classroom_memberships" cm
      INNER JOIN "classrooms" c ON c."id" = cm."classroom_id"
      LEFT JOIN "schools" s ON s."id" = c."school_id"
      WHERE cm."classroom_id" = ${classroomId}::uuid
        AND cm."user_id" = ${studentId}::uuid
        AND cm."role" = 'student'::"classroom_role"
        AND cm."state" = 'active'::"membership_state"
        AND cm."deleted_at" IS NULL
        AND c."deleted_at" IS NULL
        AND (c."school_id" IS NULL OR s."deleted_at" IS NULL)
      FOR UPDATE OF cm
    `;
    if (rows.length === 0) {
      throw new NotFoundException('Active student membership not found in classroom');
    }
  }

  private async readLockedCatalogItem(
    tx: Prisma.TransactionClient,
    classroomId: string,
    shopItemId: string,
  ): Promise<LockedShopItemRow | null> {
    const rows = await tx.$queryRaw<LockedShopItemRow[]>`
      SELECT
        si."id",
        si."code",
        si."name",
        si."description",
        si."kind"::text AS "kind",
        si."default_price" AS "defaultPrice",
        si."is_active" AS "isActive",
        si."is_implemented" AS "isImplemented",
        csi."price_override" AS "priceOverride",
        csi."is_enabled" AS "isEnabled"
      FROM "shop_items" si
      LEFT JOIN "classroom_shop_items" csi
        ON csi."shop_item_id" = si."id"
        AND csi."classroom_id" = ${classroomId}::uuid
      WHERE si."id" = ${shopItemId}::uuid
      FOR SHARE OF si
    `;
    return rows[0] ?? null;
  }

  private async assertNotAlreadyOwned(
    tx: Prisma.TransactionClient,
    classroomId: string,
    studentId: string,
    shopItemId: string,
    kind: ShopItemKind,
  ): Promise<void> {
    const existingStudentPurchase = await tx.studentPurchase.findUnique({
      where: {
        classroomId_studentId_shopItemId: {
          classroomId,
          studentId,
          shopItemId,
        },
      },
      select: { id: true },
    });
    if (existingStudentPurchase) {
      throw new ConflictException('Shop item already purchased by student');
    }

    if (kind === ShopItemKind.CLASSROOM_ITEM) {
      const existingClassroomItem = await tx.classroomItem.findUnique({
        where: {
          classroomId_shopItemId: {
            classroomId,
            shopItemId,
          },
        },
        select: { id: true },
      });
      if (existingClassroomItem) {
        throw new ConflictException('Classroom item already unlocked in this classroom');
      }
    }
  }
}
