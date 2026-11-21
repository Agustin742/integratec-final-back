import { describe, it, expect } from 'vitest';
import {
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  chatRealtimeBroadcastSchema,
  APPEARANCE_SLOT_NAMES,
  memberAppearanceSchema,
  type MemberAppearance,
  type HealthStatus,
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

  it('validates classroom-scoped chat notifications and rejects cross-room or unknown fields', () => {
    const classroomId = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
    const message = {
      id: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
      classroomId,
      authorId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
      body: 'Hello',
      mentionedUserIds: [],
      createdAt: '2026-11-19T12:00:00.000Z',
    };
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_EVENT,
        payload: message,
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_HIDDEN_EVENT,
        payload: {
          messageId: message.id,
          hiddenAt: '2026-11-19T12:01:00.000Z',
        },
      }).success,
    ).toBe(true);
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_EVENT,
        payload: { ...message, classroomId: '11111111-1111-4111-8111-111111111111' },
      }).success,
    ).toBe(false);
    expect(
      chatRealtimeBroadcastSchema.safeParse({
        classroomId,
        event: CHAT_MESSAGE_HIDDEN_EVENT,
        payload: { messageId: message.id, hiddenAt: '2026-11-19T12:01:00.000Z', body: 'secret' },
      }).success,
    ).toBe(false);
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
