import { describe, it, expect, expectTypeOf } from 'vitest';
import { CLASSROOM_ROOM_NAME, type ClassroomJoinOptions } from '../index';

describe('realtime contract', () => {
  it('pins the room name the frontend joins', () => {
    expect(CLASSROOM_ROOM_NAME).toBe('classroom');
  });

  it('carries only the classroom id in join options (the token travels as client.auth)', () => {
    expectTypeOf<ClassroomJoinOptions>().toEqualTypeOf<{ classroomId: string }>();
  });
});
