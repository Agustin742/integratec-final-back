import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClassroomItemState, ShopItemKind } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../http/pagination/pagination-query.dto';
import type { SortOptions } from '../http/pagination/sort';
import { RequestValidationException } from '../http/validation';

export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

export const SHOP_ITEM_SORT_FIELDS = ['defaultPrice', 'name', 'createdAt'] as const;
export type ShopItemSortField = (typeof SHOP_ITEM_SORT_FIELDS)[number];

/** Allow-list and default order for classroom shop catalog queries. */
export const SHOP_ITEM_SORT_OPTIONS: SortOptions<ShopItemSortField> = {
  allowed: SHOP_ITEM_SORT_FIELDS,
  default: { field: 'createdAt', direction: 'asc' },
};

export const SHOP_PURCHASE_SORT_FIELDS = ['createdAt', 'pricePaid'] as const;
export type ShopPurchaseSortField = (typeof SHOP_PURCHASE_SORT_FIELDS)[number];

/** Allow-list and default order for student shop purchase history queries. */
export const SHOP_PURCHASE_SORT_OPTIONS: SortOptions<ShopPurchaseSortField> = {
  allowed: SHOP_PURCHASE_SORT_FIELDS,
  default: { field: 'createdAt', direction: 'desc' },
};

/**
 * Validates and trims the required `Idempotency-Key` HTTP header (`1..128` non-empty chars).
 * Throws `RequestValidationException` (`400 VALIDATION_FAILED`) when invalid.
 */
export function parseIdempotencyKeyHeader(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new RequestValidationException([
      {
        field: 'idempotency-key',
        messages: ['Idempotency-Key header is required'],
      },
    ]);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new RequestValidationException([
      {
        field: 'idempotency-key',
        messages: [
          `Idempotency-Key header must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
        ],
      },
    ]);
  }
  return trimmed;
}

/** Query parameters for `GET /classrooms/:id/shop/items`. */
export class ListShopItemsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ShopItemKind,
    enumName: 'ShopItemKind',
    description: 'Optional filter by shop item kind.',
  })
  @IsOptional()
  @IsEnum(ShopItemKind)
  kind?: ShopItemKind;
}

/** Query parameters for `GET /classrooms/:id/shop/purchases`. */
export class ListShopPurchasesQueryDto extends PaginationQueryDto {}

/** Strict request body for `POST /classrooms/:id/shop/purchase`; server derives price and buyer. */
export class PurchaseShopItemDto {
  @ApiProperty({
    format: 'uuid',
    description: 'UUID of the catalog shop item to purchase.',
    example: '00000000-0000-4000-8000-000000000101',
  })
  @IsUUID('4')
  shopItemId!: string;
}

/** Catalog item projection resolved for a specific classroom and student. */
export class ShopCatalogItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: 80, example: 'cap_blue' })
  code!: string;

  @ApiProperty({ maxLength: 120, example: 'Blue Classroom Cap' })
  name!: string;

  @ApiProperty({ example: 'Classic blue cap accessory for your 3D avatar.' })
  description!: string;

  @ApiProperty({ enum: ShopItemKind, enumName: 'ShopItemKind' })
  kind!: ShopItemKind;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Effective server price in this classroom (override when set, else defaultPrice).',
    example: 50,
  })
  price!: number;

  @ApiProperty({
    type: 'boolean',
    description: 'Whether this catalog item has a working server/client implementation.',
  })
  isImplemented!: boolean;

  @ApiProperty({
    type: 'boolean',
    description: 'True when implemented and not already owned by the student or classroom.',
  })
  isPurchasable!: boolean;

  @ApiProperty({ type: 'boolean' })
  ownedByStudent!: boolean;

  @ApiProperty({ type: 'boolean' })
  ownedByClassroom!: boolean;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { assetId: 'cap', slot: 'head' },
    description: 'Server-defined item metadata for client asset rendering.',
  })
  metadata!: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Immutable purchase record returned in purchase responses and student purchase history. */
export class StudentPurchaseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  studentId!: string;

  @ApiProperty({ format: 'uuid' })
  shopItemId!: string;

  @ApiProperty({ maxLength: 80, example: 'cap_blue' })
  shopItemCode!: string;

  @ApiProperty({ maxLength: 120, example: 'Blue Classroom Cap' })
  shopItemName!: string;

  @ApiProperty({ enum: ShopItemKind, enumName: 'ShopItemKind' })
  shopItemKind!: ShopItemKind;

  @ApiProperty({ format: 'uuid' })
  pointTransactionId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'Server-recorded points paid at purchase time.',
    example: 50,
  })
  pricePaid!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Classroom-wide unlocked item created when purchasing a `CLASSROOM_ITEM`. */
export class ClassroomItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  classroomId!: string;

  @ApiProperty({ format: 'uuid' })
  shopItemId!: string;

  @ApiProperty({ format: 'uuid' })
  purchaseId!: string;

  @ApiProperty({ enum: ClassroomItemState, enumName: 'ClassroomItemState' })
  state!: ClassroomItemState;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** Result of `POST /classrooms/:id/shop/purchase` (`201 Created` or `200 OK` on replay). */
export class PurchaseResponseDto {
  @ApiProperty({ type: StudentPurchaseDto })
  purchase!: StudentPurchaseDto;

  @ApiProperty({ type: ClassroomItemDto, nullable: true })
  classroomItem!: ClassroomItemDto | null;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: 'Server-derived student points balance after this operation.',
    example: 70,
  })
  balance!: number;

  @ApiProperty({
    type: 'boolean',
    description: 'True when the response replays an earlier purchase for the same Idempotency-Key.',
  })
  replayed!: boolean;
}
