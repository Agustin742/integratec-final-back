import { randomUUID } from 'node:crypto';
import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClassroomRole, EquippedSlot, SchoolRole, ShopItemKind } from '@prisma/client';
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
import { EquipmentRateLimiter } from './equipment-rate-limiter.service';

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
    capItem: randomUUID(), // AVATAR_ACCESSORY, slot: head
    headphonesItem: randomUUID(), // AVATAR_ACCESSORY, slot: head
    deskPlantItem: randomUUID(), // DESK_UPGRADE, slot: desk_decor
    backpackItem: randomUUID(), // AVATAR_ACCESSORY, slot: back (never purchased)
    themeItem: randomUUID(), // CLASSROOM_ITEM (not equipable)
    noSlotItem: randomUUID(), // AVATAR_ACCESSORY without metadata.slot
  };
}

describe('Equipment HTTP contract (/classrooms/:id/me/equipment/*)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let rateLimiter: EquipmentRateLimiter;
  let ids: ReturnType<typeof makeIds>;

  const getEquipment = (classroomId: string, actor: string) =>
    request(app.getHttpServer())
      .get(`/classrooms/${classroomId}/me/equipment`)
      .set('Authorization', `Bearer ${actor}`);

  const putEquipment = (
    classroomId: string,
    actor: string,
    slot: string,
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .put(`/classrooms/${classroomId}/me/equipment/${slot}`)
      .set('Authorization', `Bearer ${actor}`)
      .send(body);

  const postPurchase = (
    classroomId: string,
    actor: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ) =>
    request(app.getHttpServer())
      .post(`/classrooms/${classroomId}/shop/purchase`)
      .set('Authorization', `Bearer ${actor}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(body);

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
    rateLimiter = app.get(EquipmentRateLimiter);
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
        email: `equip-http-${id}@example.invalid`,
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

    await prisma.shopItem.createMany({
      data: [
        {
          id: ids.capItem,
          code: `cap_${ids.capItem}`,
          name: 'Blue Cap',
          description: 'Cap',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 50,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'cap', slot: 'head' },
        },
        {
          id: ids.headphonesItem,
          code: `hp_${ids.headphonesItem}`,
          name: 'Studio Headphones',
          description: 'Headphones',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 80,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'headphones', slot: 'head' },
        },
        {
          id: ids.deskPlantItem,
          code: `plant_${ids.deskPlantItem}`,
          name: 'Desk Plant',
          description: 'Plant',
          kind: ShopItemKind.DESK_UPGRADE,
          defaultPrice: 70,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'desk_plant', slot: 'desk_decor' },
        },
        {
          id: ids.backpackItem,
          code: `backpack_${ids.backpackItem}`,
          name: 'Explorer Backpack',
          description: 'Backpack',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 60,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'backpack', slot: 'back' },
        },
        {
          id: ids.themeItem,
          code: `theme_${ids.themeItem}`,
          name: 'Warm Theme',
          description: 'Classroom Theme',
          kind: ShopItemKind.CLASSROOM_ITEM,
          defaultPrice: 120,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'classroom_theme_warm' },
        },
        {
          id: ids.noSlotItem,
          code: `nonslot_${ids.noSlotItem}`,
          name: 'Mystery Badge',
          description: 'Accessory without slot metadata',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 30,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'badge' },
        },
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

  it('enforces 401, 403 for staff and non-adult parents, 404 for strangers/adult-mode parents, and resource isolation', async () => {
    const unauth = await request(app.getHttpServer()).get(
      `/classrooms/${ids.classroom}/me/equipment`,
    );
    expect(unauth.status).toBe(401);
    assertEnvelope(unauth.body, 'UNAUTHENTICATED');

    for (const deniedStaffOrParent of [ids.owner, ids.admin, ids.teacher, ids.parent]) {
      const getRes = await getEquipment(ids.classroom, deniedStaffOrParent);
      expect(getRes.status).toBe(403);
      assertEnvelope(getRes.body, 'FORBIDDEN');

      const putRes = await putEquipment(ids.classroom, deniedStaffOrParent, 'head', {
        shopItemId: ids.capItem,
      });
      expect(putRes.status).toBe(403);
      assertEnvelope(putRes.body, 'FORBIDDEN');
    }

    // GET: student reads own equipment in the allowed classroom; foreign classroom 404.
    await assertResourceAuthorization({
      allowedResourceId: ids.classroom,
      foreignResourceId: ids.foreignClassroom,
      interaction: undefined,
      deniedStatus: 404,
      request: (classroomId) => getEquipment(classroomId, ids.student),
    });

    // PUT: in the allowed classroom an unpurchased item is rejected with ownership 403;
    // in the foreign classroom the same request is masked as 404.
    await assertResourceAuthorization({
      allowedResourceId: ids.classroom,
      foreignResourceId: ids.foreignClassroom,
      interaction: { shopItemId: ids.capItem },
      deniedStatus: 404,
      allowedStatus: 403,
      request: (classroomId, interaction) =>
        putEquipment(classroomId, ids.student, 'head', {
          shopItemId: interaction?.shopItemId ?? ids.capItem,
        }),
      assertAllowed: (response) => assertEnvelope(response.body, 'FORBIDDEN'),
      assertDenied: (response) => assertEnvelope(response.body, 'NOT_FOUND'),
    });

    // Adult mode hides the classroom from the linked parent (404 instead of 403).
    await prisma.classroom.update({
      where: { id: ids.classroom },
      data: { adultMode: true },
    });
    const adultParentGet = await getEquipment(ids.classroom, ids.parent);
    expect(adultParentGet.status).toBe(404);
    assertEnvelope(adultParentGet.body, 'NOT_FOUND');

    const adultParentPut = await putEquipment(ids.classroom, ids.parent, 'head', {
      shopItemId: ids.capItem,
    });
    expect(adultParentPut.status).toBe(404);
    assertEnvelope(adultParentPut.body, 'NOT_FOUND');
  });

  it('rejects invalid bodies with 400 VALIDATION_FAILED, unknown slots with 404, and unequips idempotently on an empty slot', async () => {
    for (const badBody of [
      { shopItemId: ids.capItem, extra: 1 },
      { shopItemId: 'not-a-uuid' },
      { otherField: 'x' },
    ]) {
      const res = await putEquipment(ids.classroom, ids.student, 'head', badBody);
      expect(res.status).toBe(400);
      assertEnvelope(res.body, 'VALIDATION_FAILED');
    }

    const unknownSlot = await putEquipment(ids.classroom, ids.student, 'wings', {
      shopItemId: ids.capItem,
    });
    expect(unknownSlot.status).toBe(404);
    assertEnvelope(unknownSlot.body, 'NOT_FOUND');

    const upperCaseSlot = await putEquipment(ids.classroom, ids.student, 'HEAD', {
      shopItemId: ids.capItem,
    });
    expect(upperCaseSlot.status).toBe(404);
    assertEnvelope(upperCaseSlot.body, 'NOT_FOUND');

    // Unequipping an empty slot is idempotent.
    const emptyUnequip = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: null,
    });
    expect(emptyUnequip.status).toBe(200);
    expect(emptyUnequip.body).toMatchObject({
      classroomId: ids.classroom,
      studentId: ids.student,
      slots: { head: null, face: null, back: null, desk_decor: null },
    });
  });

  it('rejects an unpurchased item with 403 and leaves the state unchanged (AC2)', async () => {
    const before = await getEquipment(ids.classroom, ids.student);
    expect(before.status).toBe(200);
    const beforeBody = before.body;

    // headphonesItem declares slot 'head' but was never purchased by the student.
    const rejected = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.headphonesItem,
    });
    expect(rejected.status).toBe(403);
    assertEnvelope(rejected.body, 'FORBIDDEN');

    const after = await getEquipment(ids.classroom, ids.student);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(beforeBody);

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('saves a purchased item on equip (AC1), reads it back, replaces, and unequips it', async () => {
    const capBuy = await postPurchase(
      ids.classroom,
      ids.student,
      { shopItemId: ids.capItem },
      'equip-flow-cap',
    );
    expect(capBuy.status).toBe(201);

    const equipped = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.capItem,
    });
    expect(equipped.status).toBe(200);
    expect(equipped.body.slots.head).toMatchObject({
      slot: 'head',
      shopItemId: ids.capItem,
      shopItemCode: `cap_${ids.capItem}`,
      shopItemName: 'Blue Cap',
      kind: ShopItemKind.AVATAR_ACCESSORY,
    });

    const readBack = await getEquipment(ids.classroom, ids.student);
    expect(readBack.status).toBe(200);
    expect(readBack.body.slots.head).toMatchObject({ shopItemId: ids.capItem });

    // Equipping the same item again is idempotent (single row).
    const replay = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.capItem,
    });
    expect(replay.status).toBe(200);
    expect(
      await prisma.equippedItem.count({
        where: {
          classroomId: ids.classroom,
          studentId: ids.student,
          slot: EquippedSlot.HEAD,
        },
      }),
    ).toBe(1);

    // Unequip with null.
    const unequipped = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: null,
    });
    expect(unequipped.status).toBe(200);
    expect(unequipped.body.slots.head).toBeNull();
    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('returns 404 for an unknown item and 409 for kind/slot mismatches', async () => {
    const unknownItem = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: randomUUID(),
    });
    expect(unknownItem.status).toBe(404);
    assertEnvelope(unknownItem.body, 'NOT_FOUND');

    // Purchase items first so the ownership check does not mask the conflict code.
    for (const [item, key] of [
      [ids.deskPlantItem, 'equip-conflict-plant'],
      [ids.themeItem, 'equip-conflict-theme'],
      [ids.noSlotItem, 'equip-conflict-noslot'],
    ] as const) {
      const buy = await postPurchase(ids.classroom, ids.student, { shopItemId: item }, key);
      expect(buy.status).toBe(201);
    }

    // DESK_UPGRADE cannot go into an avatar slot.
    const deskIntoHead = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.deskPlantItem,
    });
    expect(deskIntoHead.status).toBe(409);
    assertEnvelope(deskIntoHead.body, 'CONFLICT');

    // CLASSROOM_ITEM is not equipable.
    const themeIntoHead = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.themeItem,
    });
    expect(themeIntoHead.status).toBe(409);
    assertEnvelope(themeIntoHead.body, 'CONFLICT');

    // Item without metadata.slot cannot be equipped.
    const noSlotIntoHead = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.noSlotItem,
    });
    expect(noSlotIntoHead.status).toBe(409);
    assertEnvelope(noSlotIntoHead.body, 'CONFLICT');

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('returns 429 TOO_MANY_REQUESTS when a student exceeds the per-user equip rate limit (GET stays open)', async () => {
    for (let i = 0; i < 20; i += 1) {
      const res = await putEquipment(ids.classroom, ids.student, 'head', {
        shopItemId: randomUUID(),
      });
      expect(res.status).toBe(404);
    }

    const blocked = await putEquipment(ids.classroom, ids.student, 'head', {
      shopItemId: ids.capItem,
    });
    expect(blocked.status).toBe(429);
    assertEnvelope(blocked.body, 'TOO_MANY_REQUESTS');

    // Reads are never rate limited.
    const read = await getEquipment(ids.classroom, ids.student);
    expect(read.status).toBe(200);
  });
});
