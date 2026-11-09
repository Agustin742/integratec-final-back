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
};

describe('createClassroomRoom', () => {
  it('exposes a static onAuth that Colyseus can call detached from the class', async () => {
    const verifier: JoinVerifier = { verify: vi.fn().mockResolvedValue(IDENTITY) };
    const RoomClass = createClassroomRoom(verifier);
    const { onAuth } = RoomClass; // MatchMaker invokes it without `this`
    const context = { token: 'token-1' } as never;

    await expect(onAuth('token-1', { classroomId: CLASSROOM_ID }, context)).resolves.toEqual(
      IDENTITY,
    );
    expect(verifier.verify).toHaveBeenCalledExactlyOnceWith('token-1', CLASSROOM_ID);
  });

  it('rejects a join whose verified classroom differs from the room classroom', () => {
    const RoomClass = createClassroomRoom({ verify: vi.fn() });
    const room = new RoomClass();
    room.classroomId = CLASSROOM_ID;
    const client = { auth: { ...IDENTITY, classroomId: '11111111-1111-4111-8111-111111111111' } };

    expect(() => room.onJoin(client as never)).toThrow(ServerError);
  });

  it('admits a join whose verified classroom equals the room classroom', () => {
    const RoomClass = createClassroomRoom({ verify: vi.fn() });
    const room = new RoomClass();
    room.classroomId = CLASSROOM_ID;

    expect(() => room.onJoin({ auth: IDENTITY } as never)).not.toThrow();
  });

  it('rejects a join with no verified identity', () => {
    const RoomClass = createClassroomRoom({ verify: vi.fn() });
    const room = new RoomClass();
    room.classroomId = CLASSROOM_ID;

    expect(() => room.onJoin({} as never)).toThrow(ServerError);
  });
});
