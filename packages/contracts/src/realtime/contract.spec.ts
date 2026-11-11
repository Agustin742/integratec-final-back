import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  AVATAR_INPUT_MESSAGE,
  AVATAR_STATUSES,
  CLASSROOM_LAYOUT,
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_ACCESS_REVOKED,
  CLOSE_REASON_TOO_MANY_CONNECTIONS,
  CLOSE_REASON_VERIFICATION_UNAVAILABLE,
  INPUT_RATE_LIMIT_PER_SECOND,
  MAX_CONNECTIONS_PER_USER,
  PATCH_RATE_HZ,
  SIMULATION_TICK_RATE_HZ,
  avatarInputSchema,
  type AvatarInput,
  type ClassroomJoinOptions,
  type LayoutBox,
} from '../index';

describe('realtime contract', () => {
  it('pins the room name the frontend joins', () => {
    expect(CLASSROOM_ROOM_NAME).toBe('classroom');
  });

  it('carries only the classroom id in join options (the token travels as client.auth)', () => {
    expectTypeOf<ClassroomJoinOptions>().toEqualTypeOf<{ classroomId: string }>();
  });

  it('pins the decided rates and limits', () => {
    expect(SIMULATION_TICK_RATE_HZ).toBe(20);
    expect(PATCH_RATE_HZ).toBe(20);
    expect(INPUT_RATE_LIMIT_PER_SECOND).toBe(30);
    expect(MAX_CONNECTIONS_PER_USER).toBe(3);
  });

  describe('close codes', () => {
    it('uses 4001 for revoked access and 4002 for too many connections', () => {
      expect(CLOSE_CODE_ACCESS_REVOKED).toBe(4001);
      expect(CLOSE_CODE_TOO_MANY_CONNECTIONS).toBe(4002);
    });

    it('uses 4100 when access could not be verified, outside every code Colyseus uses', () => {
      expect(CLOSE_CODE_VERIFICATION_UNAVAILABLE).toBe(4100);
      // Colyseus: 4000 consented, 4001 shutdown, 4002 error, 4003 failed to reconnect, 4010 may retry.
      expect([4000, 4001, 4002, 4003, 4010]).not.toContain(CLOSE_CODE_VERIFICATION_UNAVAILABLE);
    });

    it('gives each code a reason so clients can tell them from the Colyseus codes', () => {
      expect(CLOSE_REASON_ACCESS_REVOKED).toBe('access_revoked');
      expect(CLOSE_REASON_TOO_MANY_CONNECTIONS).toBe('too_many_connections');
      expect(CLOSE_REASON_VERIFICATION_UNAVAILABLE).toBe('verification_unavailable');
    });
  });

  describe('avatar:input', () => {
    it('names the message', () => {
      expect(AVATAR_INPUT_MESSAGE).toBe('avatar:input');
    });

    it('describes a direction with both components', () => {
      expectTypeOf<AvatarInput>().toEqualTypeOf<{ x: number; z: number }>();
    });

    it.each([
      { x: 0, z: 0 },
      { x: 1, z: -1 },
      { x: -0.25, z: 0.5 },
    ])('accepts %j', (payload) => {
      expect(avatarInputSchema.safeParse(payload).success).toBe(true);
    });

    it.each([
      ['a component above 1', { x: 1.01, z: 0 }],
      ['a component below -1', { x: 0, z: -1.01 }],
      ['a missing component', { x: 0 }],
      ['a string component', { x: '0', z: 0 }],
      ['NaN', { x: Number.NaN, z: 0 }],
      ['Infinity', { x: 0, z: Number.POSITIVE_INFINITY }],
      ['an unexpected field', { x: 0, z: 0, speed: 99 }],
      ['null', null],
      ['an array', [0, 0]],
    ])('rejects %s', (_label, payload) => {
      expect(avatarInputSchema.safeParse(payload).success).toBe(false);
    });
  });

  it('lists the avatar statuses', () => {
    expect(AVATAR_STATUSES).toEqual(['online', 'reconnecting']);
  });

  describe('classroom layout', () => {
    const { bounds, obstacles, spawnPoints, avatarRadius } = CLASSROOM_LAYOUT;
    const overlaps = (a: LayoutBox, b: LayoutBox) =>
      a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
    const inside = (outer: LayoutBox, inner: LayoutBox) =>
      inner.minX >= outer.minX &&
      inner.maxX <= outer.maxX &&
      inner.minZ >= outer.minZ &&
      inner.maxZ <= outer.maxZ;

    it('has well-formed boxes', () => {
      for (const box of [bounds, ...obstacles]) {
        expect(box.minX).toBeLessThan(box.maxX);
        expect(box.minZ).toBeLessThan(box.maxZ);
      }
    });

    it('keeps every obstacle inside the bounds and apart from the others', () => {
      obstacles.forEach((obstacle, index) => {
        expect(inside(bounds, obstacle)).toBe(true);
        obstacles
          .slice(index + 1)
          .forEach((other) => expect(overlaps(obstacle, other)).toBe(false));
      });
    });

    it('has a teacher desk and twelve student desks', () => {
      expect(obstacles).toHaveLength(13);
    });

    it('has spawn points a full avatar radius away from walls and obstacles', () => {
      expect(spawnPoints.length).toBeGreaterThanOrEqual(MAX_CONNECTIONS_PER_USER);
      for (const { x, z } of spawnPoints) {
        expect(x - avatarRadius).toBeGreaterThanOrEqual(bounds.minX);
        expect(x + avatarRadius).toBeLessThanOrEqual(bounds.maxX);
        expect(z - avatarRadius).toBeGreaterThanOrEqual(bounds.minZ);
        expect(z + avatarRadius).toBeLessThanOrEqual(bounds.maxZ);
        const body: LayoutBox = {
          minX: x - avatarRadius,
          maxX: x + avatarRadius,
          minZ: z - avatarRadius,
          maxZ: z + avatarRadius,
        };
        for (const obstacle of obstacles) expect(overlaps(body, obstacle)).toBe(false);
      }
    });
  });
});
