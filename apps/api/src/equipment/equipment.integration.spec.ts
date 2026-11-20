import { randomUUID } from 'node:crypto';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ClassroomRole,
  EquippedSlot,
  MembershipState,
  RegistrationPath,
  ShopItemKind,
} from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { ApiConfigModule } from '../config/config.module';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { PointsLedgerService } from '../points/points-ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT } from '../platform/realtime/realtime-events';
import { ShopModule } from '../shop/shop.module';
import { ShopService } from '../shop/shop.service';
import { EquipmentRateLimiter } from './equipment-rate-limiter.service';
import { EquipmentModule } from './equipment.module';
import { EquipmentService } from './equipment.service';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

function makeIds() {
  return {
    teacher: randomUUID(),
    student: randomUUID(),
    otherStudent: randomUUID(),
    classroom: randomUUID(),
    otherClassroom: randomUUID(),
    capItem: randomUUID(), // AVATAR_ACCESSORY, slot: head
    headphonesItem: randomUUID(), // AVATAR_ACCESSORY, slot: head
    glassesItem: randomUUID(), // AVATAR_ACCESSORY, slot: face
    backpackItem: randomUUID(), // AVATAR_ACCESSORY, slot: back (never purchased)
    deskPlantItem: randomUUID(), // DESK_UPGRADE, slot: desk_decor
    themeItem: randomUUID(), // CLASSROOM_ITEM (not equipable)
    petItem: randomUUID(), // PET_ACCESSORY with slot: head (not equipable)
    noSlotItem: randomUUID(), // AVATAR_ACCESSORY without metadata.slot
  };
}

describe('EquipmentService (real PostgreSQL)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let ledger: PointsLedgerService;
  let shop: ShopService;
  let equipment: EquipmentService;
  let rateLimiter: EquipmentRateLimiter;
  let ids: ReturnType<typeof makeIds>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot({ ...authTestConfig(), databaseUrl }),
        ShopModule,
        EquipmentModule,
      ],
    }).compile();
    await module.init();
    prisma = module.get(PrismaService);
    ledger = module.get(PointsLedgerService);
    shop = module.get(ShopService);
    equipment = module.get(EquipmentService);
    rateLimiter = module.get(EquipmentRateLimiter);
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
          email: `equip-int-${id}@example.invalid`,
          passwordHash: 'unused-synthetic-hash',
          displayName: 'Synthetic Equipment User',
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
        })),
      });
      await tx.classroom.createMany({
        data: [
          {
            id: ids.classroom,
            independentTeacherId: ids.teacher,
            name: 'Equipment Classroom',
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
          {
            classroomId: ids.otherClassroom,
            userId: ids.student,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
        ],
      });
      await tx.shopItem.createMany({
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
            id: ids.glassesItem,
            code: `glasses_${ids.glassesItem}`,
            name: 'Round Glasses',
            description: 'Glasses',
            kind: ShopItemKind.AVATAR_ACCESSORY,
            defaultPrice: 45,
            isActive: true,
            isImplemented: true,
            metadata: { assetId: 'glasses', slot: 'face' },
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
            id: ids.petItem,
            code: `pet_${ids.petItem}`,
            name: 'Pet Collar',
            description: 'Pet accessory',
            kind: ShopItemKind.PET_ACCESSORY,
            defaultPrice: 40,
            isActive: true,
            isImplemented: true,
            metadata: { assetId: 'pet_collar', slot: 'head' },
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

  async function purchaseItem(studentId: string, shopItemId: string): Promise<void> {
    await shop.purchase(studentId, ids.classroom, { shopItemId }, randomUUID());
  }

  it('returns an all-null slot state before any equipment exists', async () => {
    const state = await equipment.getEquipment(ids.student, ids.classroom);

    expect(state).toMatchObject({
      classroomId: ids.classroom,
      studentId: ids.student,
      slots: { head: null, face: null, back: null, desk_decor: null },
    });
    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('saves a purchased avatar accessory into its declared slot (AC1) and a desk upgrade into desk_decor', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);
    await purchaseItem(ids.student, ids.deskPlantItem);

    const headState = await equipment.setSlot(ids.student, ids.classroom, 'head', {
      shopItemId: ids.capItem,
    });
    expect(headState.slots.head).toMatchObject({
      slot: 'head',
      shopItemId: ids.capItem,
      shopItemCode: `cap_${ids.capItem}`,
      shopItemName: 'Blue Cap',
      kind: ShopItemKind.AVATAR_ACCESSORY,
    });
    expect(headState.slots.face).toBeNull();

    const deskState = await equipment.setSlot(ids.student, ids.classroom, 'desk_decor', {
      shopItemId: ids.deskPlantItem,
    });
    expect(deskState.slots.desk_decor).toMatchObject({
      slot: 'desk_decor',
      shopItemId: ids.deskPlantItem,
      kind: ShopItemKind.DESK_UPGRADE,
    });
    expect(headState.slots.head).not.toBeNull();

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(2);
  });

  it('is idempotent when equipping the same purchased item twice', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);

    await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem });
    const second = await equipment.setSlot(ids.student, ids.classroom, 'head', {
      shopItemId: ids.capItem,
    });

    expect(second.slots.head).toMatchObject({ shopItemId: ids.capItem });
    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(1);
  });

  it('replaces the slot content when a different purchased item is equipped in the same slot', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);
    await purchaseItem(ids.student, ids.headphonesItem);

    await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem });
    const replaced = await equipment.setSlot(ids.student, ids.classroom, 'head', {
      shopItemId: ids.headphonesItem,
    });

    expect(replaced.slots.head).toMatchObject({ shopItemId: ids.headphonesItem });
    expect(
      await prisma.equippedItem.count({
        where: {
          classroomId: ids.classroom,
          studentId: ids.student,
          slot: EquippedSlot.HEAD,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.equippedItem.findFirst({
        where: { classroomId: ids.classroom, studentId: ids.student, shopItemId: ids.capItem },
      }),
    ).toBeNull();
  });

  it('unequips with a null shopItemId and stays idempotent on repeated unequips', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);
    await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem });

    const unequipped = await equipment.setSlot(ids.student, ids.classroom, 'head', {
      shopItemId: null,
    });
    expect(unequipped.slots.head).toBeNull();

    const again = await equipment.setSlot(ids.student, ids.classroom, 'head', {
      shopItemId: null,
    });
    expect(again.slots.head).toBeNull();
    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('rejects an unpurchased item with 403 and persists nothing (AC2)', async () => {
    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'back', { shopItemId: ids.backpackItem }),
    ).rejects.toThrow(ForbiddenException);

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('keeps a purchased item equipable after it is deactivated (the purchase is the entitlement)', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);
    await prisma.shopItem.update({
      where: { id: ids.capItem },
      data: { isActive: false },
    });

    const state = await equipment.setSlot(ids.student, ids.classroom, 'head', {
      shopItemId: ids.capItem,
    });
    expect(state.slots.head).toMatchObject({ shopItemId: ids.capItem });
    expect(
      await prisma.equippedItem.count({
        where: {
          classroomId: ids.classroom,
          studentId: ids.student,
          slot: EquippedSlot.HEAD,
        },
      }),
    ).toBe(1);
  });

  it('rejects an unpurchased deactivated item with 403 and persists nothing', async () => {
    await prisma.shopItem.update({
      where: { id: ids.backpackItem },
      data: { isActive: false },
    });

    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'back', { shopItemId: ids.backpackItem }),
    ).rejects.toThrow(ForbiddenException);

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('does not accept a purchase made in another classroom (data must not cross classrooms)', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);

    // The student is a member of otherClassroom, but the purchase belongs to ids.classroom.
    await expect(
      equipment.setSlot(ids.student, ids.otherClassroom, 'head', { shopItemId: ids.capItem }),
    ).rejects.toThrow(ForbiddenException);

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.otherClassroom },
      }),
    ).toBe(0);
  });

  it('returns 404 for an unknown shop item id', async () => {
    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: randomUUID() }),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns 409 when the item kind does not match the slot or is not equipable', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.deskPlantItem);
    await purchaseItem(ids.student, ids.themeItem);
    await purchaseItem(ids.student, ids.petItem);

    // DESK_UPGRADE cannot go into an avatar slot.
    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.deskPlantItem }),
    ).rejects.toThrow(ConflictException);

    // AVATAR_ACCESSORY cannot go into the desk slot.
    await fundStudent(ids.student, 100);
    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'desk_decor', { shopItemId: ids.glassesItem }),
    ).rejects.toThrow(ConflictException);

    // CLASSROOM_ITEM and PET_ACCESSORY are not equipable at all.
    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.themeItem }),
    ).rejects.toThrow(ConflictException);
    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.petItem }),
    ).rejects.toThrow(ConflictException);

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('returns 409 when the item metadata does not declare the requested slot', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.noSlotItem);

    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.noSlotItem }),
    ).rejects.toThrow(ConflictException);

    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student },
      }),
    ).toBe(0);
  });

  it('returns 404 for an unknown slot name', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);

    await expect(
      equipment.setSlot(ids.student, ids.classroom, 'wings', { shopItemId: ids.capItem }),
    ).rejects.toThrow(NotFoundException);
  });

  it('isolates equipment per student and per classroom', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);
    await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem });

    // Another student cannot equip the same item they did not purchase.
    await expect(
      equipment.setSlot(ids.otherStudent, ids.classroom, 'head', { shopItemId: ids.capItem }),
    ).rejects.toThrow(ForbiddenException);

    const otherState = await equipment.getEquipment(ids.otherStudent, ids.classroom);
    expect(otherState.slots.head).toBeNull();

    // The same student's equipment in another classroom stays empty.
    const crossClassroom = await equipment.getEquipment(ids.student, ids.otherClassroom);
    expect(crossClassroom.slots.head).toBeNull();

    expect(await prisma.equippedItem.count({ where: { shopItemId: ids.capItem } })).toBe(1);
  });

  it('handles concurrent equips on the same and different slots without 25P02 transaction errors', async () => {
    await fundStudent(ids.student, 500);
    await purchaseItem(ids.student, ids.capItem);
    await purchaseItem(ids.student, ids.headphonesItem);
    await purchaseItem(ids.student, ids.deskPlantItem);

    // Concurrent first-time equips on the same slot (both racing INSERT) plus another slot.
    const initialRace = await Promise.all([
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem }),
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.headphonesItem }),
      equipment.setSlot(ids.student, ids.classroom, 'desk_decor', {
        shopItemId: ids.deskPlantItem,
      }),
    ]);
    expect(initialRace).toHaveLength(3);

    // Concurrent updates when the slot row already exists.
    const updateRace = await Promise.all([
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem }),
      equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.headphonesItem }),
    ]);
    expect(updateRace).toHaveLength(2);

    const finalState = await equipment.getEquipment(ids.student, ids.classroom);
    expect([ids.capItem, ids.headphonesItem]).toContain(finalState.slots.head?.shopItemId);
    expect(finalState.slots.desk_decor?.shopItemId).toBe(ids.deskPlantItem);
    expect(
      await prisma.equippedItem.count({
        where: { classroomId: ids.classroom, studentId: ids.student, slot: EquippedSlot.HEAD },
      }),
    ).toBe(1);
  });

  describe('realtime appearance events (#114)', () => {
    interface AppearanceEventPayload {
      classroomId: string;
      userId: string;
      appearanceRevision: number;
      appearance: {
        baseAvatar: Record<string, string>;
        items: Record<string, unknown>;
      };
    }

    const appearanceEvents = () =>
      prisma.outboxEvent.findMany({
        where: {
          type: REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT,
          payload: { path: ['userId'], equals: ids.student },
        },
        orderBy: { occurredAt: 'asc' },
      });
    const appearancePayloads = async (): Promise<AppearanceEventPayload[]> =>
      (await appearanceEvents()).map((row) => row.payload as unknown as AppearanceEventPayload);

    it('records one event with the post-equip snapshot for that classroom only', async () => {
      await fundStudent(ids.student, 500);
      await purchaseItem(ids.student, ids.capItem);

      await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem });

      const payloads = await appearancePayloads();
      expect(payloads).toHaveLength(1);
      // Only the equipped classroom: the student is also a member of otherClassroom, but the
      // change is classroom-scoped.
      expect(payloads[0]).toEqual({
        classroomId: ids.classroom,
        userId: ids.student,
        appearanceRevision: 1,
        appearance: {
          baseAvatar: expect.any(Object),
          items: {
            head: {
              slot: 'head',
              shopItemId: ids.capItem,
              shopItemCode: `cap_${ids.capItem}`,
              shopItemName: 'Blue Cap',
              kind: ShopItemKind.AVATAR_ACCESSORY,
            },
            face: null,
            back: null,
            desk_decor: null,
          },
        },
      });
    });

    it('assigns increasing revisions to concurrent equipment changes', async () => {
      await fundStudent(ids.student, 500);
      await purchaseItem(ids.student, ids.capItem);
      await purchaseItem(ids.student, ids.headphonesItem);

      await Promise.all([
        equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem }),
        equipment.setSlot(ids.student, ids.classroom, 'head', {
          shopItemId: ids.headphonesItem,
        }),
      ]);

      const payloads = await appearancePayloads();
      expect(payloads).toHaveLength(2);
      expect(payloads.map((payload) => payload.appearanceRevision).sort((a, b) => a - b)).toEqual([
        1, 2,
      ]);
    });

    it('records one event on unequip carrying the cleared slot', async () => {
      await fundStudent(ids.student, 500);
      await purchaseItem(ids.student, ids.capItem);
      await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: ids.capItem });
      const before = (await appearanceEvents()).length;

      await equipment.setSlot(ids.student, ids.classroom, 'head', { shopItemId: null });

      const payloads = await appearancePayloads();
      expect(payloads).toHaveLength(before + 1);
      const last = payloads[payloads.length - 1];
      expect(last.classroomId).toBe(ids.classroom);
      expect(last.appearance.items).toEqual({
        head: null,
        face: null,
        back: null,
        desk_decor: null,
      });
    });

    it('records nothing when the transaction fails', async () => {
      const before = (await appearanceEvents()).length;

      // Unpurchased item in its correct slot: the equip transaction rolls back with 403, so no
      // event may exist.
      await expect(
        equipment.setSlot(ids.student, ids.classroom, 'back', { shopItemId: ids.backpackItem }),
      ).rejects.toThrow(ForbiddenException);

      expect((await appearanceEvents()).length).toBe(before);
    });
  });
});
