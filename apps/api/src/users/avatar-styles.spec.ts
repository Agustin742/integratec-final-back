import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, ShopItemKind } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { SessionVerifier } from '../auth/session-verifier.service';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { ShopPurchaseRateLimiter } from '../shop/shop-purchase-rate-limiter.service';
import { FREE_HAIR_IDS, FREE_TOP_IDS, HAIR_IDS, TOP_IDS } from './avatar-catalog';

// Real PostgreSQL and root AppModule; only session token verification is stubbed.
const databaseUrl = loadIsolatedTestDatabaseUrl();

const FREE_LOOK = {
  bodyId: 'male',
  hairId: 'classic-short',
  topId: 'school-sweatshirt',
  hairColor: '#6C4D48',
  clothingColor: '#5B4F96',
};

function makeIds() {
  return {
    student: randomUUID(),
    otherStudent: randomUUID(),
    school: randomUUID(),
    classroomA: randomUUID(),
    classroomB: randomUUID(),
    dreads: randomUUID(),
    hoodie: randomUUID(),
    fakeBraid: randomUUID(),
    cap: randomUUID(),
  };
}

describe('Paid avatar styles (#145)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let rateLimiter: ShopPurchaseRateLimiter;
  let ids: ReturnType<typeof makeIds>;

  const as = (actor: string) => ({ Authorization: `Bearer ${actor}` });
  const styles = (actor: string) =>
    request(app.getHttpServer()).get('/users/me/avatar/styles').set(as(actor));
  const saveAvatar = (actor: string, body: object) =>
    request(app.getHttpServer()).patch('/users/me/avatar').set(as(actor)).send(body);
  const buy = (classroomId: string, actor: string, shopItemId: string, key = randomUUID()) =>
    request(app.getHttpServer())
      .post(`/classrooms/${classroomId}/shop/purchase`)
      .set(as(actor))
      .set('Idempotency-Key', key)
      .send({ shopItemId });
  const equip = (classroomId: string, actor: string, slot: string, shopItemId: string) =>
    request(app.getHttpServer())
      .put(`/classrooms/${classroomId}/me/equipment/${slot}`)
      .set(as(actor))
      .send({ shopItemId });
  const envelope = (body: unknown, code: string) =>
    expect(body).toMatchObject({
      error: { code, message: expect.any(String), correlationId: expect.any(String) },
    });
  const storedAppearance = async (userId: string) =>
    (await prisma.avatarConfiguration.findUnique({ where: { userId } }))?.appearance ?? null;

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
      data: [ids.student, ids.otherStudent].map((id) => ({
        id,
        email: `avatar-styles-${id}@example.invalid`,
        displayName: 'Synthetic User',
        passwordHash: 'unused-synthetic-hash',
        registrationPath: 'SCHOOL',
      })),
    });
    await prisma.school.create({
      data: { id: ids.school, name: 'Synthetic School', slug: ids.school },
    });
    await prisma.classroom.createMany({
      data: [ids.classroomA, ids.classroomB].map((id) => ({
        id,
        schoolId: ids.school,
        name: 'Synthetic Classroom',
        adultMode: false,
      })),
    });
    await prisma.classroomMembership.createMany({
      data: [ids.classroomA, ids.classroomB].flatMap((classroomId) =>
        [ids.student, ids.otherStudent].map((userId) => ({
          classroomId,
          userId,
          role: ClassroomRole.STUDENT,
        })),
      ),
    });
    await prisma.shopItem.createMany({
      data: [
        {
          id: ids.dreads,
          code: `style_hair_dreads_${ids.dreads}`,
          name: 'Dreads',
          description: 'Paid hairstyle',
          kind: ShopItemKind.AVATAR_STYLE,
          defaultPrice: 160,
          isImplemented: true,
          metadata: { styleType: 'hair', styleId: 'dreads' },
        },
        {
          id: ids.hoodie,
          code: `style_top_hoodie_${ids.hoodie}`,
          name: 'Hoodie',
          description: 'Paid top',
          kind: ShopItemKind.AVATAR_STYLE,
          defaultPrice: 140,
          isImplemented: true,
          metadata: { styleType: 'top', styleId: 'hoodie' },
        },
        {
          // Same metadata shape as a style but a different, non-avatar kind: must never unlock anything.
          id: ids.fakeBraid,
          code: `fake_braid_${ids.fakeBraid}`,
          name: 'Fake braid',
          description: 'Accessory carrying style-like metadata',
          kind: ShopItemKind.PET_ACCESSORY,
          defaultPrice: 10,
          isImplemented: true,
          metadata: { styleType: 'hair', styleId: 'braid', slot: 'head' },
        },
        {
          id: ids.cap,
          code: `style_hair_cap_${ids.cap}`,
          name: 'Style with an equipment slot',
          description: 'Style kind that wrongly declares a slot',
          kind: ShopItemKind.AVATAR_STYLE,
          defaultPrice: 10,
          isImplemented: true,
          metadata: { styleType: 'hair', styleId: 'wavy', slot: 'head' },
        },
      ],
    });
    for (const classroomId of [ids.classroomA, ids.classroomB]) {
      for (const studentId of [ids.student, ids.otherStudent]) {
        await ledger.credit({
          classroomId,
          studentId,
          amount: 1000,
          sourceType: 'submission_grade',
          sourceId: randomUUID(),
          reason: 'Synthetic points',
          actorId: ids.student,
        });
      }
    }
  });

  afterEach(async () => {
    // Shop items are global: remove this test's fixtures so style codes stay unambiguous.
    const itemIds = [ids.dreads, ids.hoodie, ids.fakeBraid, ids.cap];
    await prisma.equippedItem.deleteMany({ where: { shopItemId: { in: itemIds } } });
    await prisma.classroomShopItem.deleteMany({ where: { shopItemId: { in: itemIds } } });
    await prisma.classroomItem.deleteMany({ where: { shopItemId: { in: itemIds } } });
    await prisma.studentPurchase.deleteMany({ where: { shopItemId: { in: itemIds } } });
    await prisma.shopItem.deleteMany({ where: { id: { in: itemIds } } });
  });

  it('requires authentication on the styles listing', async () => {
    const res = await request(app.getHttpServer()).get('/users/me/avatar/styles');
    expect(res.status).toBe(401);
    envelope(res.body, 'UNAUTHENTICATED');
  });

  it('lists every hair and top with free, owned and shop code', async () => {
    const res = await styles(ids.student).expect(200);
    const items = res.body.items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(HAIR_IDS.length + TOP_IDS.length);
    for (const id of FREE_HAIR_IDS) {
      expect(items).toContainEqual({
        styleType: 'hair',
        styleId: id,
        free: true,
        owned: true,
        shopItemCode: null,
      });
    }
    for (const id of FREE_TOP_IDS) {
      expect(items).toContainEqual({
        styleType: 'top',
        styleId: id,
        free: true,
        owned: true,
        shopItemCode: null,
      });
    }
    expect(items.filter((i) => i.free === false && i.owned === true)).toEqual([]);
    expect(items).toContainEqual({
      styleType: 'hair',
      styleId: 'dreads',
      free: false,
      owned: false,
      shopItemCode: `style_hair_dreads_${ids.dreads}`,
    });
  });

  it('rejects a paid style the user does not own and keeps the stored avatar', async () => {
    const res = await saveAvatar(ids.student, { ...FREE_LOOK, hairId: 'dreads' }).expect(403);
    envelope(res.body, 'FORBIDDEN');
    expect(await storedAppearance(ids.student)).toBeNull();
    const top = await saveAvatar(ids.student, { ...FREE_LOOK, topId: 'hoodie' }).expect(403);
    envelope(top.body, 'FORBIDDEN');
  });

  it('accepts free styles without any purchase', async () => {
    await saveAvatar(ids.student, { ...FREE_LOOK, hairId: 'bob', topId: 'tank-top' }).expect(200);
  });

  it('unlocks a paid style globally once bought in any classroom', async () => {
    await buy(ids.classroomA, ids.student, ids.dreads).expect(201);

    const listed = (await styles(ids.student).expect(200)).body.items as Array<{
      styleId: string;
      owned: boolean;
    }>;
    expect(listed.find((i) => i.styleId === 'dreads')?.owned).toBe(true);
    expect(listed.find((i) => i.styleId === 'hoodie')?.owned).toBe(false);

    const saved = { ...FREE_LOOK, hairId: 'dreads' };
    expect((await saveAvatar(ids.student, saved).expect(200)).body).toEqual(saved);
    expect(await storedAppearance(ids.student)).toEqual(saved);

    // Ownership is per user: the classmate still cannot use it.
    await saveAvatar(ids.otherStudent, saved).expect(403);
  });

  it('keeps the unlock when the shop item is later deactivated', async () => {
    await buy(ids.classroomA, ids.student, ids.hoodie).expect(201);
    await prisma.shopItem.update({ where: { id: ids.hoodie }, data: { isActive: false } });
    await saveAvatar(ids.student, { ...FREE_LOOK, topId: 'hoodie' }).expect(200);
  });

  it('does not unlock a style through a non-style item or a different style id', async () => {
    await buy(ids.classroomA, ids.student, ids.fakeBraid).expect(201);
    // Global shop rows are visible to concurrently running specs: take it off sale right away.
    await prisma.shopItem.update({ where: { id: ids.fakeBraid }, data: { isActive: false } });
    await buy(ids.classroomA, ids.student, ids.dreads).expect(201);
    await saveAvatar(ids.student, { ...FREE_LOOK, hairId: 'braid' }).expect(403);
    await saveAvatar(ids.student, { ...FREE_LOOK, hairId: 'long-curls' }).expect(403);
    const listed = (await styles(ids.student).expect(200)).body.items as Array<{
      styleId: string;
      owned: boolean;
    }>;
    expect(listed.find((i) => i.styleId === 'braid')?.owned).toBe(false);
  });

  it('rejects buying a style already owned from another classroom without charging', async () => {
    await buy(ids.classroomA, ids.student, ids.dreads).expect(201);
    const before = await ledger.getBalance(ids.classroomB, ids.student);
    const res = await buy(ids.classroomB, ids.student, ids.dreads).expect(409);
    envelope(res.body, 'CONFLICT');
    expect(await ledger.getBalance(ids.classroomB, ids.student)).toBe(before);
    expect(
      await prisma.studentPurchase.count({
        where: { studentId: ids.student, shopItemId: ids.dreads },
      }),
    ).toBe(1);
  });

  it('shows a style bought elsewhere as owned and not purchasable in the other classroom', async () => {
    await buy(ids.classroomA, ids.student, ids.dreads).expect(201);
    const res = await request(app.getHttpServer())
      .get(`/classrooms/${ids.classroomB}/shop/items?kind=AVATAR_STYLE&pageSize=100`)
      .set(as(ids.student))
      .expect(200);
    const dreads = res.body.items.find((i: { id: string }) => i.id === ids.dreads);
    expect(dreads).toMatchObject({
      kind: 'AVATAR_STYLE',
      ownedByStudent: true,
      isPurchasable: false,
    });
  });

  it('never equips a style item, even when it declares a slot', async () => {
    for (const [id, slot] of [
      [ids.dreads, 'head'],
      [ids.cap, 'head'],
    ] as const) {
      await buy(ids.classroomA, ids.student, id).expect(201);
      const res = await equip(ids.classroomA, ids.student, slot, id).expect(409);
      envelope(res.body, 'CONFLICT');
    }
    expect(await prisma.equippedItem.count({ where: { studentId: ids.student } })).toBe(0);
  });
});
