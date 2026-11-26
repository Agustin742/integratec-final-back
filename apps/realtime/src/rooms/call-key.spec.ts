import { describe, expect, it } from 'vitest';
import { callCapacity, deriveCallKey, isCallModerator } from './call-key';

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const OTHER_CLASSROOM = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const ADA = '00000000-0000-4000-8000-000000000001';
const BOB = '00000000-0000-4000-8000-00000000000b';

describe('deriveCallKey', () => {
  it('keys a classroom call by the classroom alone, whoever joins', () => {
    const options = { kind: 'classroom', classroomId: CLASSROOM } as const;
    expect(deriveCallKey(options, ADA)).toBe(deriveCallKey(options, BOB));
    expect(deriveCallKey(options, ADA)).not.toBe(
      deriveCallKey({ kind: 'classroom', classroomId: OTHER_CLASSROOM }, ADA),
    );
  });

  it('keys a direct call by the classroom and the unordered pair', () => {
    const caller = { kind: 'direct', classroomId: CLASSROOM, peerUserId: BOB } as const;
    const callee = { kind: 'direct', classroomId: CLASSROOM, peerUserId: ADA } as const;
    expect(deriveCallKey(caller, ADA)).toBe(deriveCallKey(callee, BOB));
  });

  it('gives a third user a different direct key, so they can never reach the pair', () => {
    const third = '00000000-0000-4000-8000-0000000000cc';
    const pair = deriveCallKey({ kind: 'direct', classroomId: CLASSROOM, peerUserId: BOB }, ADA);
    expect(
      deriveCallKey({ kind: 'direct', classroomId: CLASSROOM, peerUserId: BOB }, third),
    ).not.toBe(pair);
    expect(
      deriveCallKey({ kind: 'direct', classroomId: CLASSROOM, peerUserId: ADA }, third),
    ).not.toBe(pair);
  });

  it('never collides across kinds or classrooms', () => {
    const keys = [
      deriveCallKey({ kind: 'classroom', classroomId: CLASSROOM }, ADA),
      deriveCallKey({ kind: 'direct', classroomId: CLASSROOM, peerUserId: BOB }, ADA),
      deriveCallKey({ kind: 'direct', classroomId: OTHER_CLASSROOM, peerUserId: BOB }, ADA),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it('is case-insensitive on user ids', () => {
    const lower = deriveCallKey({ kind: 'direct', classroomId: CLASSROOM, peerUserId: BOB }, ADA);
    const upper = deriveCallKey(
      { kind: 'direct', classroomId: CLASSROOM, peerUserId: BOB.toUpperCase() },
      ADA.toUpperCase(),
    );
    expect(upper).toBe(lower);
  });
});

describe('isCallModerator', () => {
  it.each(['OWNER', 'ADMIN', 'TEACHER'] as const)('allows %s', (role) => {
    expect(isCallModerator(role)).toBe(true);
  });
  it('denies a student', () => {
    expect(isCallModerator('STUDENT')).toBe(false);
  });
});

describe('callCapacity', () => {
  it('caps a classroom call at the configured maximum and a direct call at two', () => {
    expect(callCapacity('classroom', 12)).toBe(12);
    expect(callCapacity('direct', 12)).toBe(2);
  });
});
