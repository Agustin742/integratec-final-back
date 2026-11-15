import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, SchoolRole, ShopItemKind } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertResourceAuthorization } from '../testing/resource-authorization';
import { ShopPurchaseRateLimiter } from './shop-purchase-rate-limiter.service';

// Real PostgreSQL and root AppModule; only session token verification is stubbed.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    owner: randomUUID(),
    admin: randomUUID(),
    teacher: randomUUID(),
    student: randomUUID(),
    otherStudent: randomUUID(),
    parent: randomUUID(),
    stranger: randomUUID(),
    school: randomUUID(),
    otherSchool: randomUUID(),
    classroom: randomUUID(),
    foreignClassroom: randomUUID(),
    capItem: randomUUID(),
    headphonesItem: randomUUID(),
    deskPlantItem: randomUUID(),
    themeItem: randomUUID(),
    unimplementedItem: randomUUID(),
    disabledItem: randomUUID(),
  };
}

describe('Shop HTTP contract (/classrooms/:id/shop/*)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let rateLimiter: ShopPurchaseRateLimiter;
  let ids: ReturnType<typeof makeIds>;

  const getItems = (classroomId: string, actor: string, query = '') =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/shop/items${query}`)
      .set('Authorization', `Bearer ${actor}`);

  const getPurchases = (classroomId: string, actor: string, query = '') =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/shop/purchases${query}`)
      .set('Authorization', `Bearer ${actor}`);

  const postPurchase = (
    classroomId: string,
    actor: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ) => {
    const req = request(app.getHttpServer())
      .post(`/classrooms/${classroomId}/shop/purchase`)
      .set('Authorization', `Bearer ${actor}`);
    if (idempotencyKey !== undefined) {
      req.set('Idempotency-Key', idempotencyKey);
    }
    return req.send(body);
  };

  const assertEnvelope = (body: unknown, code: string) => {
    expect(body).toMatchObject({
      error: { code, message: expect.any(String), correlationId: expect.any(String) },
    });
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot({ ...authTestConfig(), databaseUrl })],
    })
      .overrideProvider(SessionVerifier)
      .useValue({
        verifyAuthorizationHeader: async (header?: string) => {
          const actor = header?.replace('Bearer ', '');
          if (!actor || actor === 'invalid') throw new UnauthorizedException();
          return { userId: actor, sessionId: randomUUID() };
        },
      })
      .compile();

    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    ledger = app.get(PointsLedgerService);
    rateLimiter = app.get(ShopPurchaseRateLimiter);
  }, 20_000);

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    rateLimiter.clear();
    ids = makeIds();

    await prisma.user.createMany({
      data: [
        ids.owner,
        ids.admin,
        ids.teacher,
        ids.student,
        ids.otherStudent,
        ids.parent,
        ids.stranger,
      ].map((id) => ({
        id,
        email: `shop-http-${id}@example.invalid`,
        displayName: 'Synthetic User',
        passwordHash: 'unused-synthetic-hash',
        registrationPath: 'SCHOOL',
      })),
    });
    await prisma.school.createMany({
      data: [ids.school, ids.otherSchool].map((id) => ({
        id,
        name: 'Synthetic School',
        slug: id,
      })),
    });
    await prisma.schoolMember.createMany({
      data: [
        { schoolId: ids.school, userId: ids.owner, role: SchoolRole.OWNER },
        { schoolId: ids.school, userId: ids.admin, role: SchoolRole.ADMIN },
        { schoolId: ids.school, userId: ids.teacher, role: SchoolRole.TEACHER },
      ],
    });
    await prisma.classroom.createMany({
      data: [
        { id: ids.classroom, schoolId: ids.school, name: 'Main Classroom', adultMode: false },
        {
          id: ids.foreignClassroom,
          schoolId: ids.otherSchool,
          name: 'Foreign Classroom',
          adultMode: false,
        },
      ],
    });
    await prisma.classroomMembership.createMany({
      data: [
        { classroomId: ids.classroom, userId: ids.teacher, role: ClassroomRole.TEACHER },
        { classroomId: ids.classroom, userId: ids.student, role: ClassroomRole.STUDENT },
        { classroomId: ids.classroom, userId: ids.otherStudent, role: ClassroomRole.STUDENT },
        { classroomId: ids.foreignClassroom, userId: ids.stranger, role: ClassroomRole.STUDENT },
      ],
    });
    await prisma.parentLink.create({
      data: { classroomId: ids.classroom, parentId: ids.parent, childId: ids.student },
    });

    // Disable pre-existing global ShopItem rows in this classroom so catalog assertions stay isolated.
    const preexistingItems = await prisma.shopItem.findMany({ select: { id: true } });

    const t0 = new Date('2026-11-01T00:00:00.000Z');
    await prisma.shopItem.createMany({
      data: [
        {
          id: ids.capItem,
          code: `cap_${ids.capItem}`,
          name: 'Cap',
          description: 'Blue cap',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 50,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'cap' },
          createdAt: new Date(t0.getTime() + 1000),
        },
        {
          id: ids.headphonesItem,
          code: `hp_${ids.headphonesItem}`,
          name: 'Headphones',
          description: 'Studio headphones',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 80,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'headphones' },
          createdAt: new Date(t0.getTime() + 2000),
        },
        {
          id: ids.deskPlantItem,
          code: `plant_${ids.deskPlantItem}`,
          name: 'Desk Plant',
          description: 'Succulent',
          kind: ShopItemKind.DESK_UPGRADE,
          defaultPrice: 60,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'desk_plant' },
          createdAt: new Date(t0.getTime() + 3000),
        },
        {
          id: ids.themeItem,
          code: `theme_${ids.themeItem}`,
          name: 'Warm Theme',
          description: 'Warm classroom theme',
          kind: ShopItemKind.CLASSROOM_ITEM,
          defaultPrice: 120,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'classroom_theme_warm' },
          createdAt: new Date(t0.getTime() + 4000),
        },
        {
          id: ids.unimplementedItem,
          code: `pong_${ids.unimplementedItem}`,
          name: 'Pong',
          description: 'Not implemented yet',
          kind: ShopItemKind.CLASSROOM_ITEM,
          defaultPrice: 100,
          isActive: true,
          isImplemented: false,
          metadata: { planned: true },
          createdAt: new Date(t0.getTime() + 5000),
        },
        {
          id: ids.disabledItem,
          code: `disabled_${ids.disabledItem}`,
          name: 'Hidden Item',
          description: 'Disabled for this classroom',
          kind: ShopItemKind.PET_ACCESSORY,
          defaultPrice: 40,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'hidden' },
          createdAt: new Date(t0.getTime() + 6000),
        },
      ],
    });
    await prisma.classroomShopItem.createMany({
      data: [
        { classroomId: ids.classroom, shopItemId: ids.capItem, priceOverride: 35, isEnabled: true },
        { classroomId: ids.classroom, shopItemId: ids.disabledItem, isEnabled: false },
        ...preexistingItems.map((item) => ({
          classroomId: ids.classroom,
          shopItemId: item.id,
          isEnabled: false,
        })),
      ],
    });
    await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.student,
      amount: 300,
      sourceType: 'submission_grade',
      sourceId: randomUUID(),
      reason: 'Initial HTTP test points',
      actorId: ids.teacher,
    });
  });

  it('enforces 401, 403 for staff and non-adult parents, 404 for strangers/adult-mode parents, and #26 resource isolation', async () => {
    const unauth = await request(app.getHttpServer()).get(
      `/classrooms/${ids.classroom}/shop/items`,
    );
    expect(unauth.status).toBe(401);
    assertEnvelope(unauth.body, 'UNAUTHENTICATED');

    for (const deniedStaffOrParent of [ids.owner, ids.admin, ids.teacher, ids.parent]) {
      const itemsRes = await getItems(ids.classroom, deniedStaffOrParent);
      expect(itemsRes.status).toBe(403);
      assertEnvelope(itemsRes.body, 'FORBIDDEN');

      const purchasesRes = await getPurchases(ids.classroom, deniedStaffOrParent);
      expect(purchasesRes.status).toBe(403);
      assertEnvelope(purchasesRes.body, 'FORBIDDEN');

      const postRes = await postPurchase(
        ids.classroom,
        deniedStaffOrParent,
        { shopItemId: ids.capItem },
        `staff-${deniedStaffOrParent}`,
      );
      expect(postRes.status).toBe(403);
      assertEnvelope(postRes.body, 'FORBIDDEN');
    }

    // #26 resource isolation check for student across allowed vs foreign classroom (with untrusted query/body interaction)
    await assertResourceAuthorization({
      allowedResourceId: ids.classroom,
      foreignResourceId: ids.foreignClassroom,
      interaction: { shopItemId: ids.capItem },
      deniedStatus: 404,
      request: (classroomId) => getItems(classroomId, ids.student),
    });

    await assertResourceAuthorization({
      allowedResourceId: ids.classroom,
      foreignResourceId: ids.foreignClassroom,
      interaction: { shopItemId: ids.capItem },
      deniedStatus: 404,
      allowedStatus: 201,
      request: (classroomId, interaction) =>
        postPurchase(
          classroomId,
          ids.student,
          { shopItemId: interaction?.shopItemId ?? ids.headphonesItem },
          `iso-${classroomId}-${interaction ? 'int' : 'dir'}`,
        ),
    });

    // Adult mode hides classroom from linked parent (404 instead of 403)
    await prisma.classroom.update({
      where: { id: ids.classroom },
      data: { adultMode: true },
    });
    const adultParentItems = await getItems(ids.classroom, ids.parent);
    expect(adultParentItems.status).toBe(404);
    assertEnvelope(adultParentItems.body, 'NOT_FOUND');

    const adultParentPurchase = await postPurchase(
      ids.classroom,
      ids.parent,
      { shopItemId: ids.deskPlantItem },
      'parent-adult-mode',
    );
    expect(adultParentPurchase.status).toBe(404);
    assertEnvelope(adultParentPurchase.body, 'NOT_FOUND');
  });

  it('rejects client tampering (price/studentId/balance), missing/invalid Idempotency-Key, and invalid query params with 400 VALIDATION_FAILED', async () => {
    const tampered = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.capItem, price: 1, studentId: ids.otherStudent, balance: 9999 },
      'tamper-1',
    );
    expect(tampered.status).toBe(400);
    assertEnvelope(tampered.body, 'VALIDATION_FAILED');

    for (const badKey of [undefined, '', '   ', 'k'.repeat(129)]) {
      const missingKeyRes = await postPurchase(
        ids.classroom,
        ids.student,
        { shopItemId: ids.capItem },
        badKey,
      );
      expect(missingKeyRes.status).toBe(400);
      assertEnvelope(missingKeyRes.body, 'VALIDATION_FAILED');
    }

    const badSort = await getItems(ids.classroom, ids.student, '?sort=price');
    expect(badSort.status).toBe(400);
    assertEnvelope(badSort.body, 'VALIDATION_FAILED');

    const badQueryField = await getItems(ids.classroom, ids.student, '?balance=999');
    expect(badQueryField.status).toBe(400);
    assertEnvelope(badQueryField.body, 'VALIDATION_FAILED');
  });

  it('lists catalog with overrides, filters, sorting, and handles 201 purchase vs 200 idempotent replay vs 409 conflicts and purchase history', async () => {
    const filtered = await getItems(
      ids.classroom,
      ids.student,
      `?kind=${ShopItemKind.AVATAR_ACCESSORY}&sort=-defaultPrice`,
    );
    expect(filtered.status).toBe(200);
    expect(filtered.body.total).toBe(2);
    expect(filtered.body.items[0]).toMatchObject({
      id: ids.headphonesItem,
      price: 80,
      isPurchasable: true,
      ownedByStudent: false,
    });
    expect(filtered.body.items[1]).toMatchObject({
      id: ids.capItem,
      price: 35,
      isPurchasable: true,
    });

    // Disabled item excluded from catalog and 404 on purchase
    const allCatalog = await getItems(ids.classroom, ids.student);
    expect(allCatalog.status).toBe(200);
    expect(allCatalog.body.items.some((i: { id: string }) => i.id === ids.disabledItem)).toBe(
      false,
    );

    const disabledBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.disabledItem },
      'buy-disabled',
    );
    expect(disabledBuy.status).toBe(404);
    assertEnvelope(disabledBuy.body, 'NOT_FOUND');

    // Unimplemented item shown as unpurchasable and rejected 409 on purchase
    const unimplCatalogEntry = allCatalog.body.items.find(
      (i: { id: string }) => i.id === ids.unimplementedItem,
    );
    expect(unimplCatalogEntry).toMatchObject({ isImplemented: false, isPurchasable: false });

    const unimplBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.unimplementedItem },
      'buy-unimpl',
    );
    expect(unimplBuy.status).toBe(409);
    assertEnvelope(unimplBuy.body, 'CONFLICT');

    // First purchase -> 201 Created with classroomItem for CLASSROOM_ITEM
    const firstBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.themeItem },
      'buy-theme-1',
    );
    expect(firstBuy.status).toBe(201);
    expect(firstBuy.body).toMatchObject({
      replayed: false,
      balance: 180,
      purchase: {
        shopItemId: ids.themeItem,
        pricePaid: 120,
      },
      classroomItem: {
        classroomId: ids.classroom,
        shopItemId: ids.themeItem,
        state: 'ACTIVE',
      },
    });

    // Idempotent replay -> 200 OK with same purchase and replayed: true
    const replayBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.themeItem },
      'buy-theme-1',
    );
    expect(replayBuy.status).toBe(200);
    expect(replayBuy.body).toMatchObject({
      replayed: true,
      balance: 180,
      purchase: { id: firstBuy.body.purchase.id },
      classroomItem: { id: firstBuy.body.classroomItem.id },
    });

    // Same Idempotency-Key for a different item -> 409 Conflict
    const mismatchKeyBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.capItem },
      'buy-theme-1',
    );
    expect(mismatchKeyBuy.status).toBe(409);
    assertEnvelope(mismatchKeyBuy.body, 'CONFLICT');

    // Duplicate ClassroomItem by classmate -> 409 Conflict
    await ledger.credit({
      classroomId: ids.classroom,
      studentId: ids.otherStudent,
      amount: 200,
      sourceType: 'submission_grade',
      sourceId: randomUUID(),
      reason: 'Points for classmate',
      actorId: ids.teacher,
    });
    const classmateThemeBuy = await postPurchase(
      ids.classroom,
      ids.otherStudent,
      { shopItemId: ids.themeItem },
      'classmate-theme-1',
    );
    expect(classmateThemeBuy.status).toBe(409);
    assertEnvelope(classmateThemeBuy.body, 'CONFLICT');

    // Second purchase (cap with override price 35) -> 201 Created, classroomItem: null
    const capBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.capItem },
      'buy-cap-1',
    );
    expect(capBuy.status).toBe(201);
    expect(capBuy.body.balance).toBe(145);
    expect(capBuy.body.classroomItem).toBeNull();

    // Purchase history sorted by pricePaid asc
    const history = await getPurchases(ids.classroom, ids.student, '?sort=pricePaid');
    expect(history.status).toBe(200);
    expect(history.body.total).toBe(2);
    expect(history.body.items.map((p: { pricePaid: number }) => p.pricePaid)).toEqual([35, 120]);
  });

  it('returns 429 TOO_MANY_REQUESTS when a student exceeds the per-user purchase rate limit', async () => {
    // Exhaust default 20-request window using a synthetic non-existent item or valid attempts
    for (let i = 0; i < 20; i += 1) {
      const res = await postPurchase(
        ids.classroom,
        ids.student,
        { shopItemId: randomUUID() },
        `rate-limit-${i}`,
      );
      expect(res.status).toBe(404);
    }

    const blocked = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.capItem },
      'rate-limit-21',
    );
    expect(blocked.status).toBe(429);
    assertEnvelope(blocked.body, 'TOO_MANY_REQUESTS');
  });
});
