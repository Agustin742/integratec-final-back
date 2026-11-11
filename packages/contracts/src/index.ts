import { z } from 'zod';

export interface HealthStatus {
  status: 'ok' | 'error';
  service: string;
  timestamp: string;
}

export type UserRole = 'TEACHER' | 'STUDENT' | 'PARENT' | 'SCHOOL_ADMIN';

export const RegistrationPath = {
  INDEPENDENT_TEACHER: 'INDEPENDENT_TEACHER',
  SCHOOL: 'SCHOOL',
} as const;

export type RegistrationPath = (typeof RegistrationPath)[keyof typeof RegistrationPath];

export const REGISTRATION_PATHS = [
  RegistrationPath.INDEPENDENT_TEACHER,
  RegistrationPath.SCHOOL,
] as const;

/**
 * Realtime (Colyseus) contract shared with the frontend (decision D8).
 * The room state client types are generated into `./realtime/generated` by `pnpm realtime:codegen`.
 * This stays in `index.ts` (no relative import): Node loads the package entry as TypeScript source.
 */

/** Name the room is registered under; clients join it with `client.joinOrCreate`. */
export const CLASSROOM_ROOM_NAME = 'classroom';

/**
 * Options a client passes when joining a classroom room.
 * The access token is NOT an option: the client sets `client.auth.token`, which the SDK sends as
 * the `Authorization: Bearer` header of the matchmake request.
 */
export interface ClassroomJoinOptions {
  classroomId: string;
}

/** Server simulation and state patch rates, in Hz. The frontend interpolates between patches. */
export const SIMULATION_TICK_RATE_HZ = 20;
export const PATCH_RATE_HZ = 20;

/** Fixed avatar speed in layout units per second; the client cannot change it. */
export const AVATAR_SPEED_UNITS_PER_SECOND = 3;

/** Per-connection message limit; messages over it are dropped silently. */
export const INPUT_RATE_LIMIT_PER_SECOND = 30;

/** Simultaneous connections (screens) one user may hold in a classroom room. */
export const MAX_CONNECTIONS_PER_USER = 3;

/**
 * Close codes the room uses (decision D14). Colyseus also uses 4001 (server shutdown) and 4002
 * (protocol error), so clients must read the close reason as well as the code.
 */
export const CLOSE_CODE_ACCESS_REVOKED = 4001;
export const CLOSE_CODE_TOO_MANY_CONNECTIONS = 4002;
export const CLOSE_REASON_ACCESS_REVOKED = 'access_revoked';
export const CLOSE_REASON_TOO_MANY_CONNECTIONS = 'too_many_connections';

/** Client to server: the direction the avatar should walk. `{ x: 0, z: 0 }` stops it. */
export const AVATAR_INPUT_MESSAGE = 'avatar:input';

/** Each component is in [-1, 1]; the server normalizes the direction and applies a fixed speed. */
export const avatarInputSchema = z.strictObject({
  x: z.number().min(-1).max(1),
  z: z.number().min(-1).max(1),
});

export type AvatarInput = z.infer<typeof avatarInputSchema>;

export const AVATAR_STATUSES = ['online', 'reconnecting'] as const;
export type AvatarStatus = (typeof AVATAR_STATUSES)[number];

/** Axis-aligned box on the floor plane (x, z), in layout units. */
export interface LayoutBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ClassroomLayout {
  /** Walls: the avatar centre stays at least `avatarRadius` inside this box. */
  bounds: LayoutBox;
  /** Collision radius of an avatar. Obstacles are inflated by it. */
  avatarRadius: number;
  /** Desks and other solid boxes an avatar cannot enter. */
  obstacles: readonly LayoutBox[];
  /** Where new avatars appear; every point is walkable. */
  spawnPoints: readonly { x: number; z: number }[];
}

const desk = (
  centerX: number,
  centerZ: number,
  halfWidth: number,
  halfDepth: number,
): LayoutBox => ({
  minX: centerX - halfWidth,
  maxX: centerX + halfWidth,
  minZ: centerZ - halfDepth,
  maxZ: centerZ + halfDepth,
});

/**
 * TEMPORARY: one fixed layout shared by every classroom until per-classroom layouts land (issue
 * #79). Walkable surface used by the server (collisions) and the frontend scene: a 16 by 12
 * classroom, the teacher desk at the front (negative z) and twelve student desks in three rows of
 * four. The entrance is at the back. Desks added by auto-expansion (#22) have no place here yet.
 */
export const CLASSROOM_LAYOUT: ClassroomLayout = {
  bounds: { minX: -8, maxX: 8, minZ: -6, maxZ: 6 },
  avatarRadius: 0.3,
  obstacles: [
    desk(0, -4.4, 1.5, 0.4),
    ...[-1.8, 0.4, 2.6].flatMap((row) =>
      [-4.5, -1.5, 1.5, 4.5].map((column) => desk(column, row, 0.8, 0.4)),
    ),
  ],
  spawnPoints: [-6, -4, -2, 0, 2, 4, 6].map((x) => ({ x, z: 5 })),
};
