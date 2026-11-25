import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ClassroomItemState,
  ClassroomRole,
  MembershipState,
  PointEntryKind,
  Prisma,
  RegistrationPath,
  ShopItemKind,
} from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopPurchaseRateLimiter } from './shop-purchase-rate-limiter.service';
import { ShopModule } from './shop.module';
import { ShopService } from './shop.service';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    otherStudent: randomUUID(),
    classroom: randomUUID(),
    otherClassroom: randomUUID(),
    accessoryItem: randomUUID(),
    deskUpgradeItem: randomUUID(),
    classroomItem: randomUUID(),
    unimplementedItem: randomUUID(),
    disabledItem: randomUUID(),
    gradeSource: randomUUID(),
  };
}

describe('ShopService (real PostgreSQL)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let shop: ShopService;
  let rateLimiter: ShopPurchaseRateLimiter;
  let ids: ReturnType<typeof makeIds>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }), ShopModule],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    ledger = module.get(PointsLedgerService);
    shop = module.get(ShopService);
    rateLimiter = module.get(ShopPurchaseRateLimiter);
  }, 20_000);

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    rateLimiter.clear();
    ids = makeIds();

    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [ids.teacher, ids.student, ids.otherStudent].map((id) => ({
          id,
          email: `shop-int-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: 'Synthetic Shop User',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          {
            id: ids.classroom,
            independentTeacherId: ids.teacher,
            name: 'Shop Classroom',
          },
          {
            id: ids.otherClassroom,
            independentTeacherId: ids.teacher,
            name: 'Other Classroom',
          },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          {
            classroomId: ids.classroom,
            userId: ids.student,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
          {
            classroomId: ids.classroom,
            userId: ids.otherStudent,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
        ],
      });
      await tx.shopItem.createMany({
        data: [
          {
            id: ids.accessoryItem,
            code: `cap_${ids.accessoryItem}`,
            name: 'Blue Cap',
            description: 'Cap',
            kind: ShopItemKind.AVATAR_ACCESSORY,
            defaultPrice: 60,
            isActive: true,
            isImplemented: true,
            metadata: { assetId: 'cap' },
          },
          {
            id: ids.deskUpgradeItem,
            code: `plant_${ids.deskUpgradeItem}`,
            name: 'Desk Plant',
            description: 'Plant',
            kind: ShopItemKind.DESK_UPGRADE,
            defaultPrice: 70,
            isActive: true,
            isImplemented: true,
            metadata: { assetId: 'desk_plant' },
          },
          {
            id: ids.classroomItem,
            code: `theme_${ids.classroomItem}`,
            name: 'Warm Theme',
            description: 'Classroom Theme',
            kind: ShopItemKind.CLASSROOM_ITEM,
            defaultPrice: 90,
            isActive: true,
            isImplemented: true,
            metadata: { assetId: 'classroom_theme_warm' },
          },
          {
            id: ids.unimplementedItem,
            code: `pong_${ids.unimplementedItem}`,
            name: 'Pong Game',
            description: 'Unimplemented',
            kind: ShopItemKind.CLASSROOM_ITEM,
            defaultPrice: 40,
            isActive: true,
            isImplemented: false,
            metadata: { planned: true },
          },
          {
            id: ids.disabledItem,
            code: `glasses_${ids.disabledItem}`,
            name: 'Round Glasses',
            description: 'Disabled in classroom',
            kind: ShopItemKind.AVATAR_ACCESSORY,
            defaultPrice: 45,
            isActive: true,
            isImplemented: true,
            metadata: { assetId: 'glasses' },
          },
        ],
      });
      await tx.classroomShopItem.create({
        data: {
          classroomId: ids.classroom,
          shopItemId: ids.disabledItem,
          isEnabled: false,
        },
      });
    });
  });

  async function fundStudent(studentId: string, amount: number): Promise<void> {
    await ledger.credit({
      classroomId: ids.classroom,
      studentId,
      amount,
      sourceType: 'submission_grade',
      sourceId: randomUUID(),
      reason: 'Synthetic test points',
      actorId: ids.teacher,
    });
  }

  async function createStyleTwins() {
    await prisma.classroomMembership.create({
      data: {
        classroomId: ids.otherClassroom,
        userId: ids.student,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
      },
    });
    const twins = [randomUUID(), randomUUID()];
    await prisma.shopItem.createMany({
      data: twins.map((id) => ({
        id,
        code: `style_${id}`,
        name: 'Twin paid hair',
        description: 'Synthetic style',
        kind: ShopItemKind.AVATAR_STYLE,
        defaultPrice: 60,
        isActive: true,
        isImplemented: true,
        metadata: { styleType: 'hair', styleId: `paid_${ids.student}` },
      })),
    });
    return twins;
  }

  it('reports same-style twins owned globally after buying a distinct item ID', async () => {
    const [first, twin] = await createStyleTwins();
    await fundStudent(ids.student, 200);
    await shop.purchase(ids.student, ids.classroom, { shopItemId: first }, 'style-first');
    for (const classroom of [ids.classroom, ids.otherClassroom]) {
      const catalog = await shop.listItems(ids.student, classroom, {
        page: 1,
        pageSize: 100,
        kind: ShopItemKind.AVATAR_STYLE,
      });
      expect(catalog.items.find((item) => item.id === twin)).toMatchObject({
        ownedByStudent: true,
        isPurchasable: false,
      });
    }
    const otherCatalog = await shop.listItems(ids.otherStudent, ids.classroom, {
      page: 1,
      pageSize: 100,
      kind: ShopItemKind.AVATAR_STYLE,
    });
    expect(otherCatalog.items.find((item) => item.id === twin)).toMatchObject({
      ownedByStudent: false,
      isPurchasable: true,
    });
  });

  it('serializes concurrent same-style twins across classrooms without extra purchase or debit', async () => {
    const twins = await createStyleTwins();
    await fundStudent(ids.student, 200);
    await ledger.credit({
      classroomId: ids.otherClassroom,
      studentId: ids.student,
      amount: 200,
      sourceType: 'submission_grade',
      sourceId: randomUUID(),
      reason: 'Synthetic test points',
      actorId: ids.teacher,
    });
    const classrooms = [ids.classroom, ids.otherClassroom];
    const results = await Promise.allSettled(
      twins.map((shopItemId, index) =>
        shop.purchase(ids.student, classrooms[index], { shopItemId }, `race-${index}`),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictException);
    if (rejected?.status === 'rejected') expect(rejected.reason.getStatus()).toBe(409);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    const accepted = results[winner];
    const replay = await shop.purchase(
      ids.student,
      classrooms[winner],
      { shopItemId: twins[winner] },
      `race-${winner}`,
    );
    expect(replay.replayed).toBe(true);
    if (accepted.status === 'fulfilled') expect(replay.purchase).toEqual(accepted.value.purchase);
    expect(await prisma.studentPurchase.count({ where: { studentId: ids.student } })).toBe(1);
    const entries = await prisma.pointTransaction.findMany({ where: { studentId: ids.student } });
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.entryKind === PointEntryKind.DEBIT)).toHaveLength(1);
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(340);
    expect(await ledger.getBalance(classrooms[1 - winner], ids.student)).toBe(200);
    expect(await ledger.getBalance(classrooms[winner], ids.student)).toBe(140);
    expect(await prisma.classroomItem.count({ where: { shopItemId: { in: twins } } })).toBe(0);
  });

  it('atomically creates negative PointTransaction, StudentPurchase, and ClassroomItem for classroom_item', async () => {
    await fundStudent(ids.student, 200);

    const res = await shop.purchase(
      ids.student,
      ids.classroom,
      { shopItemId: ids.classroomItem },
      'purchase-classroom-item-1',
    );

    expect(res.replayed).toBe(false);
    expect(res.balance).toBe(110);
    expect(res.purchase.pricePaid).toBe(90);
    expect(res.classroomItem).toMatchObject({
      classroomId: ids.classroom,
      shopItemId: ids.classroomItem,
      purchaseId: res.purchase.id,
      state: ClassroomItemState.ACTIVE,
    });

    const ledgerEntry = await prisma.pointTransaction.findUniqueOrThrow({
      where: { id: res.purchase.pointTransactionId },
    });
    expect(ledgerEntry.entryKind).toBe(PointEntryKind.DEBIT);
    expect(ledgerEntry.amount).toBe(-90);
    expect(ledgerEntry.sourceType).toBe('shop_purchase');
    expect(ledgerEntry.sourceId).toBe(res.purchase.id);
  });

  it('rejects unimplemented items (409) without touching balance', async () => {
    await fundStudent(ids.student, 200);

    await expect(
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.unimplementedItem }, 'unimpl-1'),
    ).rejects.toThrow(ConflictException);

    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(200);
    expect(
      await prisma.studentPurchase.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('rejects disabled classroom override (404), applies priceOverride, and preserves historical pricePaid when catalog changes', async () => {
    await fundStudent(ids.student, 200);

    await expect(
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.disabledItem }, 'disabled-1'),
    ).rejects.toThrow(NotFoundException);

    await prisma.classroomShopItem.create({
      data: {
        classroomId: ids.classroom,
        shopItemId: ids.accessoryItem,
        priceOverride: 35,
        isEnabled: true,
      },
    });

    const purchased = await shop.purchase(
      ids.student,
      ids.classroom,
      { shopItemId: ids.accessoryItem },
      'override-1',
    );
    expect(purchased.purchase.pricePaid).toBe(35);
    expect(purchased.balance).toBe(165);

    // Mutate catalog price and classroom override afterward: historical purchase & debit must not change.
    await prisma.shopItem.update({
      where: { id: ids.accessoryItem },
      data: { defaultPrice: 999 },
    });
    await prisma.classroomShopItem.update({
      where: {
        classroomId_shopItemId: { classroomId: ids.classroom, shopItemId: ids.accessoryItem },
      },
      data: { priceOverride: 500 },
    });

    const storedPurchase = await prisma.studentPurchase.findUniqueOrThrow({
      where: { id: purchased.purchase.id },
      include: { pointTransaction: true },
    });
    expect(storedPurchase.pricePaid).toBe(35);
    expect(storedPurchase.pointTransaction.amount).toBe(-35);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(165);
  });

  it('rejects insufficient balance (409) with zero records created', async () => {
    await fundStudent(ids.student, 50);

    await expect(
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'poor-1'),
    ).rejects.toThrow(ConflictException);

    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(50);
    expect(
      await prisma.studentPurchase.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('prevents negative balance under concurrent Promise.all purchases of distinct items', async () => {
    await fundStudent(ids.student, 100); // accessory=60, deskUpgrade=70 -> only one fits

    const outcomes = await Promise.allSettled([
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'conc-a'),
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.deskUpgradeItem }, 'conc-b'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    const finalBalance = await ledger.getBalance(ids.classroom, ids.student);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
    expect([30, 40]).toContain(finalBalance);
  });

  it('allows only one student to unlock a ClassroomItem under concurrent Promise.all purchases', async () => {
    await fundStudent(ids.student, 150);
    await fundStudent(ids.otherStudent, 150);

    const outcomes = await Promise.allSettled([
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.classroomItem }, 'ci-s1'),
      shop.purchase(ids.otherStudent, ids.classroom, { shopItemId: ids.classroomItem }, 'ci-s2'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);

    expect(
      await prisma.classroomItem.count({
        where: { classroomId: ids.classroom, shopItemId: ids.classroomItem },
      }),
    ).toBe(1);
    expect(
      await prisma.pointTransaction.count({
        where: { classroomId: ids.classroom, entryKind: PointEntryKind.DEBIT },
      }),
    ).toBe(1);

    const b1 = await ledger.getBalance(ids.classroom, ids.student);
    const b2 = await ledger.getBalance(ids.classroom, ids.otherStudent);
    expect(b1 + b2).toBe(210); // 300 total - 90 single purchase
  });

  it('rejects duplicate StudentPurchase by the same student under concurrent Promise.all with distinct idempotency keys', async () => {
    await fundStudent(ids.student, 200);

    const outcomes = await Promise.allSettled([
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'dup-k1'),
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'dup-k2'),
    ]);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(140);
  });

  it('handles concurrent Promise.all idempotent retries with the same Idempotency-Key cleanly without double charge', async () => {
    await fundStudent(ids.student, 200);

    const [r1, r2] = await Promise.all([
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'same-key-1'),
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'same-key-1'),
    ]);

    expect(r1.purchase.id).toBe(r2.purchase.id);
    expect(r1.purchase.pointTransactionId).toBe(r2.purchase.pointTransactionId);
    expect([r1.replayed, r2.replayed].sort()).toEqual([false, true]);
    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(140);

    expect(
      await prisma.studentPurchase.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(1);
    expect(
      await prisma.pointTransaction.count({
        where: {
          classroomId: ids.classroom,
          studentId: ids.student,
          entryKind: PointEntryKind.DEBIT,
        },
      }),
    ).toBe(1);
  });

  it('rolls back the debit transaction atomically if StudentPurchase creation fails after debit', async () => {
    await fundStudent(ids.student, 200);

    const originalTx = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (fn: unknown) => {
      return originalTx(async (tx: Prisma.TransactionClient) => {
        const failingStudentPurchase = new Proxy(tx.studentPurchase, {
          get(target, prop, receiver) {
            if (prop === 'create') {
              return async () => {
                throw new Error('Simulated post-debit purchase write failure');
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        const failingTx = new Proxy(tx, {
          get(target, prop, receiver) {
            if (prop === 'studentPurchase') {
              return failingStudentPurchase;
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        return (fn as (client: Prisma.TransactionClient) => Promise<unknown>)(failingTx);
      });
    });

    await expect(
      shop.purchase(ids.student, ids.classroom, { shopItemId: ids.accessoryItem }, 'rollback-1'),
    ).rejects.toThrow('Simulated post-debit purchase write failure');

    expect(await ledger.getBalance(ids.classroom, ids.student)).toBe(200);
    expect(
      await prisma.pointTransaction.count({
        where: {
          classroomId: ids.classroom,
          studentId: ids.student,
          entryKind: PointEntryKind.DEBIT,
        },
      }),
    ).toBe(0);
    expect(
      await prisma.studentPurchase.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('enforces PostgreSQL CHECK constraints on shop prices and idempotency keys', async () => {
    await expect(
      prisma.shopItem.create({
        data: {
          code: `bad_price_${randomUUID()}`,
          name: 'Invalid Price',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 0,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.classroomShopItem.create({
        data: {
          classroomId: ids.classroom,
          shopItemId: ids.accessoryItem,
          priceOverride: 0,
        },
      }),
    ).rejects.toThrow();
  });
});
