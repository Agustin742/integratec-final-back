import { AVATAR_SPEED_UNITS_PER_SECOND, CLASSROOM_LAYOUT, type LayoutBox } from '@aula/contracts';
import { describe, expect, it } from 'vitest';
import { isWalkable, stepAvatar } from './step-avatar';

const DT = 1 / 20;
const STEP = AVATAR_SPEED_UNITS_PER_SECOND * DT;
const { bounds, obstacles, avatarRadius, spawnPoints } = CLASSROOM_LAYOUT;
// A free corridor: the aisle between the second and third desk rows runs along x at z = 1.5.
const AISLE = { x: 0, z: 1.5 };

const insideObstacle = ({ x, z }: { x: number; z: number }) =>
  obstacles.some(
    (o: LayoutBox) =>
      x > o.minX - avatarRadius &&
      x < o.maxX + avatarRadius &&
      z > o.minZ - avatarRadius &&
      z < o.maxZ + avatarRadius,
  );

const run = (start: { x: number; z: number }, input: { x: number; z: number }, ticks: number) => {
  let position = { ...start, rotation: 0 };
  const path = [];
  for (let i = 0; i < ticks; i++) {
    position = stepAvatar(CLASSROOM_LAYOUT, position, input, DT);
    path.push(position);
  }
  return { position, path };
};

describe('stepAvatar', () => {
  it('moves at the fixed speed along the requested direction', () => {
    const next = stepAvatar(CLASSROOM_LAYOUT, { ...AISLE, rotation: 0 }, { x: 1, z: 0 }, DT);
    expect(next.x).toBeCloseTo(AISLE.x + STEP, 6);
    expect(next.z).toBeCloseTo(AISLE.z, 6);
  });

  it('does not let a smaller input magnitude change the speed', () => {
    const slow = stepAvatar(CLASSROOM_LAYOUT, { ...AISLE, rotation: 0 }, { x: 0.2, z: 0 }, DT);
    expect(slow.x).toBeCloseTo(AISLE.x + STEP, 6);
  });

  it('keeps the speed on a diagonal', () => {
    const next = stepAvatar(CLASSROOM_LAYOUT, { ...AISLE, rotation: 0 }, { x: 1, z: 1 }, DT);
    expect(Math.hypot(next.x - AISLE.x, next.z - AISLE.z)).toBeCloseTo(STEP, 6);
  });

  it('stands still for a zero input and keeps facing the same way', () => {
    const start = { ...AISLE, rotation: 1.2 };
    expect(stepAvatar(CLASSROOM_LAYOUT, start, { x: 0, z: 0 }, DT)).toEqual(start);
  });

  it('faces the direction of the input', () => {
    expect(
      stepAvatar(CLASSROOM_LAYOUT, { ...AISLE, rotation: 0 }, { x: 1, z: 0 }, DT).rotation,
    ).toBeCloseTo(Math.PI / 2, 6);
    expect(
      stepAvatar(CLASSROOM_LAYOUT, { ...AISLE, rotation: 0 }, { x: 0, z: -1 }, DT).rotation,
    ).toBeCloseTo(Math.PI, 6);
  });

  it('stops at the walls', () => {
    const east = run({ x: 7, z: 5.5 }, { x: 1, z: 0 }, 40).position;
    expect(east.x).toBeCloseTo(bounds.maxX - avatarRadius, 6);

    const south = run({ x: 7, z: 5 }, { x: 0, z: 1 }, 40).position;
    expect(south.z).toBeCloseTo(bounds.maxZ - avatarRadius, 6);

    const west = run({ x: -7, z: 5.5 }, { x: -1, z: 0 }, 40).position;
    expect(west.x).toBeCloseTo(bounds.minX + avatarRadius, 6);

    const north = run({ x: 7, z: -5 }, { x: 0, z: -1 }, 40).position;
    expect(north.z).toBeCloseTo(bounds.minZ + avatarRadius, 6);
  });

  it('never enters an obstacle when walking into a desk', () => {
    // Desk centered at (-1.5, 0.4): approach it from the aisle below, heading north.
    const { path } = run({ x: -1.5, z: 1.5 }, { x: 0, z: -1 }, 200);
    expect(path.some(insideObstacle)).toBe(false);
    const last = path[path.length - 1];
    expect(last.z).toBeGreaterThan(-1.8); // never reached the far side of the desk
  });

  it('slides along an obstacle instead of sticking to it', () => {
    // Heading north-east into the desk at (1.5, 0.4): blocked on z, free to keep moving on x.
    const start = { x: 1.5, z: 1.25 };
    const { position } = run(start, { x: 1, z: -1 }, 20);
    expect(position.x).toBeGreaterThan(start.x + 0.5);
    expect(insideObstacle(position)).toBe(false);
  });

  it('cannot tunnel through a thin obstacle with a huge step', () => {
    const next = stepAvatar(CLASSROOM_LAYOUT, { x: -1.5, z: 1.5, rotation: 0 }, { x: 0, z: -1 }, 5);
    expect(insideObstacle(next)).toBe(false);
    expect(next.z).toBeGreaterThan(-1.8);
  });

  it('keeps every spawn point walkable', () => {
    for (const point of spawnPoints)
      expect(isWalkable(CLASSROOM_LAYOUT, point.x, point.z)).toBe(true);
  });

  it('classifies points outside the bounds and inside obstacles as not walkable', () => {
    expect(isWalkable(CLASSROOM_LAYOUT, 9, 0)).toBe(false);
    expect(isWalkable(CLASSROOM_LAYOUT, bounds.maxX - avatarRadius / 2, 0)).toBe(false);
    expect(isWalkable(CLASSROOM_LAYOUT, 0, -4.4)).toBe(false);
  });

  it('stays walkable after any random walk', () => {
    let seed = 12345;
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 2 - 1;
    let position = { ...spawnPoints[3], rotation: 0 };
    for (let i = 0; i < 2000; i++) {
      position = stepAvatar(CLASSROOM_LAYOUT, position, { x: random(), z: random() }, DT);
      expect(isWalkable(CLASSROOM_LAYOUT, position.x, position.z)).toBe(true);
    }
  });
});
