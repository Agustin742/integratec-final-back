import { ShopItemKind } from '@prisma/client';
import { APPEARANCE_SLOT_NAMES } from '@aula/contracts';
import { describe, expect, it, vi } from 'vitest';
import { equippedItemsFor } from '../users/member-appearance';
import { EQUIPPED_SLOT_NAMES, SLOT_ENUM_BY_NAME, SLOT_NAME_BY_ENUM } from './equipment.dto';
import { EquipmentService } from './equipment.service';

vi.mock('../users/member-appearance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../users/member-appearance')>()),
  advanceAppearanceRevision: vi.fn(),
  memberAppearanceFor: vi.fn(async () => ({ appearanceRevision: 1, appearance: {} })),
}));

const ACCESSORY_SLOTS = ['hand', 'neck', 'ears'] as const;
const EMPTY_SLOTS = {
  head: null,
  face: null,
  back: null,
  desk_decor: null,
  hand: null,
  neck: null,
  ears: null,
};

/** In-memory stand-in: no equipped rows, one purchased shop item. */
function makeService(item: { kind: ShopItemKind; slot: string }) {
  const tx = {
    shopItem: {
      findUnique: vi.fn(async () => ({ kind: item.kind, metadata: { slot: item.slot } })),
    },
    studentPurchase: { findUnique: vi.fn(async () => ({ id: 'purchase' })) },
    $executeRaw: vi.fn(async () => 1),
  };
  const prisma = {
    equippedItem: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<void>) => run(tx)),
  };
  const service = new EquipmentService(
    prisma as never,
    { verifyClassroomAccess: vi.fn() } as never,
    { consume: vi.fn() } as never,
    { recordClassroomAppearanceChanged: vi.fn() } as never,
  );
  const equip = (slot: string) =>
    service.setSlot('student', 'classroom', slot, { shopItemId: 'item' });
  return { service, equip, tx };
}

describe('equipment accessory slots (#154)', () => {
  it('exposes the same slot names as the shared contract, with a reversible enum mapping', () => {
    expect([...EQUIPPED_SLOT_NAMES]).toEqual([...APPEARANCE_SLOT_NAMES]);
    for (const name of EQUIPPED_SLOT_NAMES) {
      expect(SLOT_NAME_BY_ENUM[SLOT_ENUM_BY_NAME[name]]).toBe(name);
    }
  });

  it.each(ACCESSORY_SLOTS)('equips an avatar accessory into %s', async (slot) => {
    const { equip, tx } = makeService({ kind: ShopItemKind.AVATAR_ACCESSORY, slot });
    await expect(equip(slot)).resolves.toMatchObject({ classroomId: 'classroom' });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it.each(ACCESSORY_SLOTS)('rejects a desk upgrade declaring %s', async (slot) => {
    const { equip, tx } = makeService({ kind: ShopItemKind.DESK_UPGRADE, slot });
    await expect(equip(slot)).rejects.toThrow('does not fit the declared equipment slot');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('still rejects an avatar accessory in desk_decor', async () => {
    const { equip } = makeService({ kind: ShopItemKind.AVATAR_ACCESSORY, slot: 'desk_decor' });
    await expect(equip('desk_decor')).rejects.toThrow('does not fit the declared equipment slot');
  });

  it('reports every slot as empty when nothing is equipped', async () => {
    const { service } = makeService({ kind: ShopItemKind.AVATAR_ACCESSORY, slot: 'hand' });
    const state = await service.getEquipment('student', 'classroom');
    expect(state.slots).toStrictEqual(EMPTY_SLOTS);
  });

  it('lists every slot in the member appearance items', async () => {
    const client = { equippedItem: { findMany: vi.fn(async () => []) } };
    await expect(equippedItemsFor(client as never, 'student', 'classroom')).resolves.toStrictEqual(
      EMPTY_SLOTS,
    );
  });
});
