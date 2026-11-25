import { describe, expect, it } from 'vitest';
import { MapSchema } from '@colyseus/schema';
import { Avatar, ClassroomState, EquippedItemView, Npc } from './classroom-state';

describe('ClassroomState', () => {
  it('starts with the minimum desk count so every room has a layout before its first join (#79)', () => {
    expect(new ClassroomState().deskCount).toBe(12);
  });

  it('starts with an empty avatar map', () => {
    const state = new ClassroomState();
    expect(state.avatars).toBeInstanceOf(MapSchema);
    expect(state.avatars.size).toBe(0);
  });

  it('keys avatars by user id and carries the contract fields', () => {
    const state = new ClassroomState();
    const avatar = new Avatar();
    avatar.userId = 'user-1';
    avatar.displayName = 'Ada';
    avatar.role = 'STUDENT';
    avatar.x = 1.5;
    avatar.z = -2;
    avatar.rotation = 0.5;
    avatar.status = 'online';
    state.avatars.set(avatar.userId, avatar);

    expect(state.avatars.get('user-1')).toMatchObject({
      userId: 'user-1',
      displayName: 'Ada',
      role: 'STUDENT',
      x: 1.5,
      z: -2,
      rotation: 0.5,
      status: 'online',
    });
  });

  it('defaults a new avatar to online at the origin facing forward', () => {
    expect(new Avatar()).toMatchObject({ x: 0, z: 0, rotation: 0, status: 'online' });
  });

  it('carries the member appearance: base avatar plus equipped items per slot (#114)', () => {
    const state = new ClassroomState();
    const avatar = new Avatar();
    avatar.userId = 'user-1';
    avatar.appearance.bodyId = 'female';
    avatar.appearance.hairId = 'afro';
    avatar.appearance.topId = 'basic-tshirt';
    avatar.appearance.hairColor = '#AF6D63';
    avatar.appearance.clothingColor = '#75B7DA';
    const head = new EquippedItemView();
    head.slot = 'head';
    head.shopItemId = '20000000-0000-4000-8000-000000000001';
    head.shopItemCode = 'head_cap';
    head.shopItemName = 'Blue Classroom Cap';
    head.kind = 'AVATAR_ACCESSORY';
    avatar.appearance.items.set('head', head);
    state.avatars.set(avatar.userId, avatar);

    const stored = state.avatars.get('user-1');
    expect(stored?.appearance).toMatchObject({
      bodyId: 'female',
      hairId: 'afro',
      topId: 'basic-tshirt',
      hairColor: '#AF6D63',
      clothingColor: '#75B7DA',
    });
    expect(stored?.appearance.items.size).toBe(1);
    expect(stored?.appearance.items.get('head')).toMatchObject({
      slot: 'head',
      shopItemId: '20000000-0000-4000-8000-000000000001',
      shopItemCode: 'head_cap',
      shopItemName: 'Blue Classroom Cap',
      kind: 'AVATAR_ACCESSORY',
    });
  });

  it('defaults a new avatar appearance to empty base fields and no items (#114)', () => {
    const appearance = new Avatar().appearance;
    expect(appearance).toMatchObject({
      bodyId: '',
      hairId: '',
      topId: '',
      hairColor: '',
      clothingColor: '',
    });
    expect(appearance.items.size).toBe(0);
  });

  it('starts with an empty npc map keyed by npc id (#147)', () => {
    const state = new ClassroomState();
    expect(state.npcs).toBeInstanceOf(MapSchema);
    expect(state.npcs.size).toBe(0);
  });

  it('defaults a new npc to the quiet state a client renders before the first patch (#147)', () => {
    const npc = new Npc();
    expect(npc.state).toBe('idle');
    expect(npc.reaction).toBe('');
    expect(npc.phraseId).toBe(-1);
    expect(npc.reactingSessionId).toBe('');
    expect(npc.reactionSeq).toBe(0);
  });

  it('stores npcs by id with their synced fields (#147)', () => {
    const state = new ClassroomState();
    const npc = new Npc();
    npc.id = 'pet';
    npc.x = 1.5;
    npc.z = -2;
    npc.state = 'reacting';
    npc.reaction = 'phrase';
    npc.phraseId = 3;
    npc.reactionSeq = 7;
    npc.reactingSessionId = 'session-1';
    state.npcs.set(npc.id, npc);

    expect(state.npcs.get('pet')).toMatchObject({
      id: 'pet',
      x: 1.5,
      z: -2,
      state: 'reacting',
      reaction: 'phrase',
      phraseId: 3,
      reactionSeq: 7,
      reactingSessionId: 'session-1',
    });
  });
});
