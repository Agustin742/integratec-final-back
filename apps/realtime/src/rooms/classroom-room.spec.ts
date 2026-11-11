import { describe, it, expect, vi } from 'vitest';
import { ServerError } from '@colyseus/core';
import { createClassroomRoom } from './classroom-room';
import type { JoinVerifier } from '../join/join-verifier';

const CLASSROOM_ID = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  classroomId: CLASSROOM_ID,
  role: 'TEACHER' as const,
  displayName: 'Ada Lovelace',
};
const AUTH = {
  userId: IDENTITY.userId,
  authSessionId: IDENTITY.sessionId,
  classroomId: CLASSROOM_ID,
  role: IDENTITY.role,
  displayName: IDENTITY.displayName,
};

describe('createClassroomRoom', () => {
  it('exposes a static onAuth that Colyseus can call detached from the class', async () => {
    const verifier: JoinVerifier = { verify: vi.fn().mockResolvedValue(IDENTITY) };
    const RoomClass = createClassroomRoom(verifier);
    const { onAuth } = RoomClass; // MatchMaker invokes it without `this`
    const context = { token: 'token-1' } as never;

    await expect(onAuth('token-1', { classroomId: CLASSROOM_ID }, context)).resolves.toEqual(AUTH);
    expect(verifier.verify).toHaveBeenCalledExactlyOnceWith('token-1', CLASSROOM_ID);
  });

  const makeJoinedRoom = () => {
    const room = new (createClassroomRoom({ verify: vi.fn() }))();
    room.onCreate({ classroomId: CLASSROOM_ID });
    return room;
  };

  it('rejects a join whose verified classroom differs from the room classroom', () => {
    const room = makeJoinedRoom();
    const client = {
      sessionId: 's1',
      auth: { ...AUTH, classroomId: '11111111-1111-4111-8111-111111111111' },
    };

    expect(() => room.onJoin(client as never)).toThrow(ServerError);
    expect(room.state.avatars.size).toBe(0);
  });

  it('admits a join whose verified classroom equals the room classroom', () => {
    const room = makeJoinedRoom();

    expect(() => room.onJoin({ sessionId: 's1', auth: AUTH } as never)).not.toThrow();
    expect(room.state.avatars.get(IDENTITY.userId)).toMatchObject({
      displayName: 'Ada Lovelace',
      role: 'TEACHER',
      status: 'online',
    });
  });

  it('rejects a join with no verified identity', () => {
    const room = makeJoinedRoom();

    expect(() => room.onJoin({ sessionId: 's1' } as never)).toThrow(ServerError);
    expect(room.state.avatars.size).toBe(0);
  });

  describe('onCreate', () => {
    const makeRoom = () => new (createClassroomRoom({ verify: vi.fn() }))();

    it.each([
      ['missing options', undefined],
      ['missing classroomId', {}],
      ['non-UUID classroomId', { classroomId: 'not-a-uuid' }],
      ['non-string classroomId', { classroomId: 42 }],
    ])('rejects %s', (_label, options) => {
      expect(() => makeRoom().onCreate(options)).toThrow(ServerError);
    });

    it('binds the room to a valid classroomId and mirrors it in the state', () => {
      const room = makeRoom();
      room.onCreate({ classroomId: CLASSROOM_ID });

      expect(room.classroomId).toBe(CLASSROOM_ID);
      expect(room.state.classroomId).toBe(CLASSROOM_ID);
    });
  });
});
