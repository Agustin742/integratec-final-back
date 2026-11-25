import { DEFAULT_TUTOR_BOT_SKIN, TUTOR_BOT_SKINS, toTutorBotSkin } from './index';
import { describe, it, expect } from 'vitest';
import {
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  chatRealtimeBroadcastSchema,
  APPEARANCE_SLOT_NAMES,
  memberAppearanceSchema,
  type MemberAppearance,
  type HealthStatus,
  NPC_EMOTES,
  NPC_IDS,
  NPC_INTERACT_COOLDOWN_MS,
  NPC_INTERACT_MAX_DISTANCE,
  NPC_INTERACT_MESSAGE,
  npcInteractSchema,
  TUTOR_BOT_PHRASES,
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
      topId: 'basic-tshirt',
      hairColor: '#AF6D63',
      clothingColor: '#75B7DA',
    },
    items: {
      head: {
        slot: 'head',
        shopItemId: '20000000-0000-4000-8000-000000000001',
        shopItemCode: 'head_cap',
        shopItemName: 'Blue Classroom Cap',
        kind: 'AVATAR_ACCESSORY',
      },
      face: null,
      back: null,
      desk_decor: null,
      hand: null,
      neck: null,
      ears: null,
    },
  };

  it('names the seven equipment slots', () => {
    expect(APPEARANCE_SLOT_NAMES).toEqual([
      'head',
      'face',
      'back',
      'desk_decor',
      'hand',
      'neck',
      'ears',
    ]);
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

describe('NPC contract (#147)', () => {
  it('pins the NPC ids the frontend renders and gives every NPC an emote list', () => {
    expect(NPC_IDS).toEqual(['pet', 'tutorBot']);
    expect(Object.keys(NPC_EMOTES)).toEqual(NPC_IDS);
    expect(Object.values(NPC_EMOTES).every((emotes) => emotes.length > 0)).toBe(true);
  });

  it('lists the emotes each NPC can play', () => {
    expect(NPC_EMOTES.tutorBot).toEqual(['Wave', 'Think', 'Celebrate', 'Encourage', 'Talk']);
    expect(NPC_EMOTES.pet).toEqual(['Meow', 'AskForPets', 'Sleep', 'Walk']);
  });

  it('validates the interact message and rejects unknown NPCs and extra fields', () => {
    expect(NPC_INTERACT_MESSAGE).toBe('npc:interact');
    expect(npcInteractSchema.safeParse({ npcId: 'pet' }).success).toBe(true);
    expect(npcInteractSchema.safeParse({ npcId: 'tutorBot' }).success).toBe(true);
    expect(npcInteractSchema.safeParse({ npcId: 'dog' }).success).toBe(false);
    expect(npcInteractSchema.safeParse({}).success).toBe(false);
    expect(npcInteractSchema.safeParse({ npcId: 'pet', x: 1 }).success).toBe(false);
  });

  it('bounds the interaction distance and cooldown', () => {
    expect(NPC_INTERACT_MAX_DISTANCE).toBeCloseTo(1.8, 10);
    expect(NPC_INTERACT_COOLDOWN_MS).toBe(4000);
  });

  it('ships short, unique, emoji-free tutor bot phrases', () => {
    expect(TUTOR_BOT_PHRASES.length).toBeGreaterThanOrEqual(18);
    expect(TUTOR_BOT_PHRASES.length).toBeLessThanOrEqual(30);
    expect(new Set(TUTOR_BOT_PHRASES).size).toBe(TUTOR_BOT_PHRASES.length);
    for (const phrase of TUTOR_BOT_PHRASES) {
      expect(phrase.trim()).toBe(phrase);
      expect(phrase.length).toBeGreaterThan(10);
      expect(phrase.length).toBeLessThanOrEqual(90);
      expect(phrase).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe('tutor bot skins (#154)', () => {
  it('pins the skins the front ships, with none first and as the default', () => {
    expect(TUTOR_BOT_SKINS).toEqual([
      'none',
      'boca',
      'seleccion',
      'folklore',
      'guardapolvo',
      'scientist',
      'graduate',
      'gamer',
    ]);
    expect(DEFAULT_TUTOR_BOT_SKIN).toBe('none');
  });

  it('reads a stored value, falling back to the default for an unknown one', () => {
    expect(toTutorBotSkin('boca')).toBe('boca');
    expect(toTutorBotSkin('river')).toBe('none');
  });
});
