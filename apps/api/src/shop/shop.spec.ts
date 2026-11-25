import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClassroomItemState, PointEntryKind, Prisma, ShopItemKind } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import { createValidationPipe, RequestValidationException } from '../http/validation';
import type { PointsLedgerService } from '../points/points-ledger.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ShopPurchaseRateLimiter } from './shop-purchase-rate-limiter.service';
import {
  ListShopItemsQueryDto,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  PurchaseShopItemDto,
  parseIdempotencyKeyHeader,
} from './shop.dto';
import { buildShopLedgerIdempotencyKey, ShopService } from './shop.service';

const classroomId = '00000000-0000-4000-8000-000000000001';
const studentId = '00000000-0000-4000-8000-000000000002';
const itemId = '00000000-0000-4000-8000-000000000010';
const otherItemId = '00000000-0000-4000-8000-000000000011';
const txEntryId = '00000000-0000-4000-8000-000000000020';
const now = new Date('2026-11-14T12:00:00.000Z');

describe('Shop DTO, header, and key helpers (unit)', () => {
  const pipe = createValidationPipe();

  it('validates and trims Idempotency-Key header cleanly', () => {
    expect(parseIdempotencyKeyHeader('  req-123  ')).toBe('req-123');
    expect(parseIdempotencyKeyHeader('a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH))).toBe(
      'a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH),
    );

    for (const bad of [undefined, null, 123, ['a', 'b'], '', '   ', 'a'.repeat(129)]) {
      expect(() => parseIdempotencyKeyHeader(bad)).toThrow(RequestValidationException);
    }
  });

  it('rejects extra body fields and invalid UUIDs on PurchaseShopItemDto', async () => {
    const valid = await pipe.transform(
      { shopItemId: itemId },
      { type: 'body', metatype: PurchaseShopItemDto },
    );
    expect(valid).toEqual({ shopItemId: itemId });

    await expect(
      pipe.transform(
        { shopItemId: itemId, price: 1, studentId, balance: 9999 },
        { type: 'body', metatype: PurchaseShopItemDto },
      ),
    ).rejects.toThrow(RequestValidationException);

    await expect(
      pipe.transform({ shopItemId: 'not-a-uuid' }, { type: 'body', metatype: PurchaseShopItemDto }),
    ).rejects.toThrow(RequestValidationException);
  });

  it('validates optional kind filter on ListShopItemsQueryDto', async () => {
    const parsed = await pipe.transform(
      { kind: ShopItemKind.AVATAR_ACCESSORY, page: '1', pageSize: '10', sort: '-defaultPrice' },
      { type: 'query', metatype: ListShopItemsQueryDto },
    );
    expect(parsed.kind).toBe(ShopItemKind.AVATAR_ACCESSORY);

    await expect(
      pipe.transform({ kind: 'invalid_kind' }, { type: 'query', metatype: ListShopItemsQueryDto }),
    ).rejects.toThrow(RequestValidationException);
  });

  it('builds deterministic <= 128 char ledger keys without truncation collisions', () => {
    const key1 = buildShopLedgerIdempotencyKey(classroomId, studentId, `${'x'.repeat(120)}-1`);
    const key2 = buildShopLedgerIdempotencyKey(classroomId, studentId, `${'x'.repeat(120)}-2`);

    expect(key1.length).toBe(69);
    expect(key1).toMatch(/^shop:[0-9a-f]{64}$/);
    expect(key1).not.toBe(key2);
    expect(key1).toBe(
      buildShopLedgerIdempotencyKey(classroomId, studentId, `${'x'.repeat(120)}-1`),
    );
  });
});

describe('ShopPurchaseRateLimiter (unit)', () => {
  it('blocks requests past maxAttempts within the window and isolates users', () => {
    const limiter = new ShopPurchaseRateLimiter(undefined, { windowMs: 1000, maxAttempts: 2 });

    expect(() => limiter.consume('user-a')).not.toThrow();
    expect(() => limiter.consume('user-a')).not.toThrow();

    try {
      limiter.consume('user-a');
      expect.unreachable('Expected 429 TOO_MANY_REQUESTS');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    expect(() => limiter.consume('user-b')).not.toThrow();
  });

  it('reads defaults from ApiConfig when provided', () => {
    const limiter = new ShopPurchaseRateLimiter({
      shopPurchaseRateLimitWindowSeconds: 30,
      shopPurchaseRateLimitMaxAttempts: 1,
    });
    expect(() => limiter.consume('user-a')).not.toThrow();
    expect(() => limiter.consume('user-a')).toThrow(HttpException);
  });

  it('expires older attempts outside the sliding window', async () => {
    const limiter = new ShopPurchaseRateLimiter(undefined, { windowMs: 40, maxAttempts: 1 });
    limiter.consume('user-a');
    expect(() => limiter.consume('user-a')).toThrow(HttpException);
    await new Promise((resolve) => setTimeout(resolve, 55));
    expect(() => limiter.consume('user-a')).not.toThrow();
  });
});

describe('ShopService (unit)', () => {
  let txClient: {
    $queryRaw: ReturnType<typeof vi.fn>;
    studentPurchase: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    classroomItem: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    shopItem: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    studentPurchase: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };
  let access: {
    verifyClassroomAccess: ReturnType<typeof vi.fn>;
  };
  let pointsLedger: {
    debit: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
  };
  let rateLimiter: ShopPurchaseRateLimiter;
  let service: ShopService;

  beforeEach(() => {
    txClient = {
      $queryRaw: vi.fn(),
      studentPurchase: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      classroomItem: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
    };
    prisma = {
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return (arg as (client: typeof txClient) => Promise<unknown>)(txClient);
        }
        return Promise.all(arg as Promise<unknown>[]);
      }),
      shopItem: {
        count: vi.fn(),
        findMany: vi.fn(),
      },
      studentPurchase: {
        count: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    access = {
      verifyClassroomAccess: vi.fn().mockResolvedValue({ myRole: 'STUDENT' }),
    };
    pointsLedger = {
      debit: vi.fn(),
      getBalance: vi.fn(),
    };
    rateLimiter = new ShopPurchaseRateLimiter(undefined, { windowMs: 60_000, maxAttempts: 20 });
    service = new ShopService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
      pointsLedger as unknown as PointsLedgerService,
      rateLimiter,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves price overrides, ownership flags, and isPurchasable in listItems', async () => {
    prisma.shopItem.count.mockResolvedValue(2);
    prisma.shopItem.findMany.mockResolvedValue([
      {
        id: itemId,
        code: 'cap_blue',
        name: 'Blue Cap',
        description: 'Cap',
        kind: ShopItemKind.AVATAR_ACCESSORY,
        defaultPrice: 50,
        isActive: true,
        isImplemented: true,
        metadata: { assetId: 'cap' },
        createdAt: now,
        classroomOverrides: [{ priceOverride: 35, isEnabled: true }],
        purchases: [],
        classroomItems: [],
      },
      {
        id: otherItemId,
        code: 'minigame_pong',
        name: 'Pong',
        description: 'Planned',
        kind: ShopItemKind.CLASSROOM_ITEM,
        defaultPrice: 200,
        isActive: true,
        isImplemented: false,
        metadata: { planned: true },
        createdAt: now,
        classroomOverrides: [],
        purchases: [],
        classroomItems: [{ id: 'ci-1' }],
      },
    ]);

    const res = await service.listItems(studentId, classroomId, { page: 1, pageSize: 20 });

    expect(access.verifyClassroomAccess).toHaveBeenCalledWith(studentId, classroomId, {
      requiredRole: 'STUDENT',
    });
    expect(res.total).toBe(2);
    expect(res.items[0]).toMatchObject({
      id: itemId,
      price: 35,
      isImplemented: true,
      isPurchasable: true,
      ownedByStudent: false,
      ownedByClassroom: false,
      metadata: { assetId: 'cap' },
    });
    expect(res.items[1]).toMatchObject({
      id: otherItemId,
      price: 200,
      isImplemented: false,
      isPurchasable: false,
      ownedByClassroom: true,
    });
  });

  it('returns idempotent replay without calling pointsLedger.debit', async () => {
    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce({
      id: 'purchase-1',
      classroomId,
      studentId,
      shopItemId: itemId,
      pointTransactionId: txEntryId,
      pricePaid: 50,
      idempotencyKey: 'idem-1',
      createdAt: now,
      shopItem: { code: 'cap_blue', name: 'Blue Cap', kind: ShopItemKind.AVATAR_ACCESSORY },
      classroomItem: null,
    });
    pointsLedger.getBalance.mockResolvedValueOnce(150);

    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const result = await service.purchase(studentId, classroomId, { shopItemId: itemId }, 'idem-1');

    expect(result).toEqual({
      purchase: {
        id: 'purchase-1',
        classroomId,
        studentId,
        shopItemId: itemId,
        shopItemCode: 'cap_blue',
        shopItemName: 'Blue Cap',
        shopItemKind: ShopItemKind.AVATAR_ACCESSORY,
        pointTransactionId: txEntryId,
        pricePaid: 50,
        createdAt: now.toISOString(),
      },
      classroomItem: null,
      balance: 150,
      replayed: true,
    });
    expect(pointsLedger.debit).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('rejects replay when idempotency key is reused for a different shopItemId', async () => {
    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce({
      id: 'purchase-1',
      classroomId,
      studentId,
      shopItemId: otherItemId,
      pointTransactionId: txEntryId,
      pricePaid: 50,
      idempotencyKey: 'idem-1',
      createdAt: now,
      shopItem: { code: 'other', name: 'Other', kind: ShopItemKind.AVATAR_ACCESSORY },
      classroomItem: null,
    });

    await expect(
      service.purchase(studentId, classroomId, { shopItemId: itemId }, 'idem-1'),
    ).rejects.toThrow(ConflictException);
    expect(pointsLedger.debit).not.toHaveBeenCalled();
  });

  it('rejects disabled classroom overrides (404) and unimplemented items (409) before debit', async () => {
    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]).mockResolvedValueOnce([
      {
        id: itemId,
        code: 'cap_blue',
        name: 'Blue Cap',
        description: '',
        kind: 'avatar_accessory',
        defaultPrice: 50,
        isActive: true,
        isImplemented: true,
        priceOverride: null,
        isEnabled: false,
      },
    ]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.purchase(studentId, classroomId, { shopItemId: itemId }, 'idem-disabled'),
    ).rejects.toThrow(NotFoundException);

    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]).mockResolvedValueOnce([
      {
        id: itemId,
        code: 'minigame_pong',
        name: 'Pong',
        description: '',
        kind: 'classroom_item',
        defaultPrice: 200,
        isActive: true,
        isImplemented: false,
        priceOverride: null,
        isEnabled: null,
      },
    ]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.purchase(studentId, classroomId, { shopItemId: itemId }, 'idem-unimpl'),
    ).rejects.toThrow(ConflictException);
    expect(pointsLedger.debit).not.toHaveBeenCalled();
  });

  it('rejects duplicate ClassroomItem before debiting points', async () => {
    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]).mockResolvedValueOnce([
      {
        id: itemId,
        code: 'theme_warm',
        name: 'Warm Theme',
        description: '',
        kind: 'classroom_item',
        defaultPrice: 150,
        isActive: true,
        isImplemented: true,
        priceOverride: 120,
        isEnabled: true,
      },
    ]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    txClient.classroomItem.findUnique.mockResolvedValueOnce({ id: 'ci-existing' });

    await expect(
      service.purchase(studentId, classroomId, { shopItemId: itemId }, 'idem-dup-ci'),
    ).rejects.toThrow(ConflictException);
    expect(pointsLedger.debit).not.toHaveBeenCalled();
  });

  it('debits effective price, records purchase + ClassroomItem, and logs non-PII event', async () => {
    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]).mockResolvedValueOnce([
      {
        id: itemId,
        code: 'theme_warm',
        name: 'Warm Theme',
        description: '',
        kind: 'classroom_item',
        defaultPrice: 150,
        isActive: true,
        isImplemented: true,
        priceOverride: 120,
        isEnabled: true,
      },
    ]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    txClient.classroomItem.findUnique.mockResolvedValueOnce(null);

    pointsLedger.debit.mockResolvedValueOnce({
      created: true,
      entry: {
        id: txEntryId,
        classroomId,
        studentId,
        actorId: studentId,
        entryKind: PointEntryKind.DEBIT,
        amount: -120,
        sourceType: 'shop_purchase',
        sourceId: 'generated',
        idempotencyKey: 'shop:hash',
        reason: 'Shop purchase: Warm Theme',
        createdAt: now.toISOString(),
      },
    });
    txClient.studentPurchase.create.mockImplementationOnce(
      async ({ data }: { data: { id: string } }) => ({
        id: data.id,
        classroomId,
        studentId,
        shopItemId: itemId,
        pointTransactionId: txEntryId,
        pricePaid: 120,
        idempotencyKey: 'idem-new',
        createdAt: now,
        shopItem: { code: 'theme_warm', name: 'Warm Theme', kind: ShopItemKind.CLASSROOM_ITEM },
      }),
    );
    txClient.classroomItem.create.mockImplementationOnce(
      async ({ data }: { data: { purchaseId: string } }) => ({
        id: 'ci-new',
        classroomId,
        shopItemId: itemId,
        purchaseId: data.purchaseId,
        state: ClassroomItemState.ACTIVE,
        createdAt: now,
        updatedAt: now,
      }),
    );
    pointsLedger.getBalance.mockResolvedValueOnce(80);

    const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const result = await service.purchase(
      studentId,
      classroomId,
      { shopItemId: itemId },
      '  idem-new  ',
    );

    expect(pointsLedger.debit).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId,
        studentId,
        amount: 120,
        sourceType: 'shop_purchase',
        sourceId: result.purchase.id,
        actorId: studentId,
        idempotencyKey: buildShopLedgerIdempotencyKey(classroomId, studentId, 'idem-new'),
        reason: 'Shop purchase: Warm Theme',
      }),
      txClient,
    );
    expect(result.replayed).toBe(false);
    expect(result.balance).toBe(80);
    expect(result.purchase.pricePaid).toBe(120);
    expect(result.classroomItem).toMatchObject({
      id: 'ci-new',
      purchaseId: result.purchase.id,
      state: ClassroomItemState.ACTIVE,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'shop_item_purchased',
        classroomId,
        studentId,
        purchaseId: result.purchase.id,
        shopItemId: itemId,
        kind: ShopItemKind.CLASSROOM_ITEM,
        pricePaid: 120,
      }),
    );
  });

  it('maps Prisma P2002 race conflicts cleanly to ConflictException', async () => {
    txClient.$queryRaw.mockResolvedValueOnce([{ id: 'cm-1' }]).mockResolvedValueOnce([
      {
        id: itemId,
        code: 'cap_blue',
        name: 'Blue Cap',
        description: '',
        kind: 'avatar_accessory',
        defaultPrice: 50,
        isActive: true,
        isImplemented: true,
        priceOverride: null,
        isEnabled: null,
      },
    ]);
    txClient.studentPurchase.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    pointsLedger.debit.mockResolvedValueOnce({ entry: { id: txEntryId }, created: true });
    txClient.studentPurchase.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '6.4.1',
      }),
    );

    await expect(
      service.purchase(studentId, classroomId, { shopItemId: itemId }, 'idem-race'),
    ).rejects.toThrow(ConflictException);
  });
});
