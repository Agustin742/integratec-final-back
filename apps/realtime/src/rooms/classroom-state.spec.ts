import { describe, expect, it } from 'vitest';
import { MapSchema } from '@colyseus/schema';
import { Avatar, ClassroomState } from './classroom-state';

describe('ClassroomState', () => {
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
});
