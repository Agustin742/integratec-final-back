import { describe, it, expect } from 'vitest';
import {
  HealthStatus,
  APPEARANCE_SLOT_NAMES,
  memberAppearanceSchema,
  type MemberAppearance,
} from './index';

describe('@aula/contracts smoke test', () => {
  it('should define HealthStatus shape correctly', () => {
    const health: HealthStatus = {
      status: 'ok',
      service: 'contracts',
      timestamp: new Date().toISOString(),
    };
    expect(health.status).toBe('ok');
    expect(health.service).toBe('contracts');
  });
});

describe('memberAppearanceSchema (#114)', () => {
  const appearance: MemberAppearance = {
    baseAvatar: {
      bodyId: 'female',
      hairId: 'afro',
      topId: 'tshirt',
      hairColor: '#AF6D63',
      clothingColor: '#75B7DA',
    },
    items: {
      head: {
        slot: 'head',
        shopItemId: '20000000-0000-4000-8000-000000000001',
        shopItemCode: 'cap_blue',
        shopItemName: 'Blue Classroom Cap',
        kind: 'AVATAR_ACCESSORY',
      },
      face: null,
      back: null,
      desk_decor: null,
    },
  };

  it('names the four equipment slots', () => {
    expect(APPEARANCE_SLOT_NAMES).toEqual(['head', 'face', 'back', 'desk_decor']);
  });

  it('accepts a valid member appearance', () => {
    expect(memberAppearanceSchema.parse(appearance)).toEqual(appearance);
  });

  it('rejects unknown base avatar fields', () => {
    expect(
      memberAppearanceSchema.safeParse({
        ...appearance,
        baseAvatar: { ...appearance.baseAvatar, email: 'a@b.c' },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown top-level fields and unknown slot names', () => {
    expect(memberAppearanceSchema.safeParse({ ...appearance, email: 'a@b.c' }).success).toBe(false);
    expect(
      memberAppearanceSchema.safeParse({
        ...appearance,
        items: { ...appearance.items, hair: appearance.items.head },
      }).success,
    ).toBe(false);
    expect(
      memberAppearanceSchema.safeParse({
        ...appearance,
        items: {
          ...appearance.items,
          head: { ...appearance.items.head, slot: 'hair' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires every slot key, allowing null', () => {
    const { head, ...partial } = appearance.items;
    expect(head).toBeTruthy();
    expect(memberAppearanceSchema.safeParse({ ...appearance, items: partial }).success).toBe(false);
  });
});
