import type { ClassroomLayout } from '@aula/contracts';

interface Point {
  x: number;
  z: number;
}

/**
 * First spawn point no avatar stands on, so newcomers do not appear inside each other. When every
 * point is taken the first one is reused: avatars do not collide with each other.
 */
export function pickSpawnPoint(layout: ClassroomLayout, occupied: readonly Point[]): Point {
  const clearance = layout.avatarRadius * 2;
  const free = layout.spawnPoints.find((point) =>
    occupied.every((other) => Math.hypot(other.x - point.x, other.z - point.z) >= clearance),
  );
  return { ...(free ?? layout.spawnPoints[0]) };
}
