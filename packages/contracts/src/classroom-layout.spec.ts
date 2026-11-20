import { describe, expect, it } from 'vitest';
import {
  buildClassroomLayout,
  CLASSROOM_DESK_ROW_SPACING,
  MIN_CLASSROOM_DESKS,
  type ClassroomLayout,
  type LayoutBox,
} from './index';

const box = (cx: number, cz: number, hw: number, hd: number): LayoutBox => ({
  minX: cx - hw,
  maxX: cx + hw,
  minZ: cz - hd,
  maxZ: cz + hd,
});

/** The fixed layout that shipped before per-classroom layouts (#79), inlined on purpose. */
const LEGACY_LAYOUT: ClassroomLayout = {
  bounds: { minX: -8, maxX: 8, minZ: -6, maxZ: 6 },
  avatarRadius: 0.3,
  obstacles: [
    box(0, -4.4, 1.5, 0.4),
    ...[-1.8, 0.4, 2.6].flatMap((row) =>
      [-4.5, -1.5, 1.5, 4.5].map((column) => box(column, row, 0.8, 0.4)),
    ),
  ],
  spawnPoints: [-6, -4, -2, 0, 2, 4, 6].map((x) => ({ x, z: 5 })),
};

const overlaps = (a: LayoutBox, b: LayoutBox) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

const inside = (outer: LayoutBox, inner: LayoutBox) =>
  inner.minX >= outer.minX &&
  inner.maxX <= outer.maxX &&
  inner.minZ >= outer.minZ &&
  inner.maxZ <= outer.maxZ;

describe('buildClassroomLayout', () => {
  it('exposes the minimum desk count and the row spacing', () => {
    expect(MIN_CLASSROOM_DESKS).toBe(12);
    expect(CLASSROOM_DESK_ROW_SPACING).toBeCloseTo(2.2, 10);
  });

  it('reproduces the previous fixed geometry with 12 desks', () => {
    const layout = buildClassroomLayout(12);
    expect(layout.bounds).toEqual(LEGACY_LAYOUT.bounds);
    expect(layout.avatarRadius).toBe(LEGACY_LAYOUT.avatarRadius);
    expect(layout.spawnPoints).toEqual(LEGACY_LAYOUT.spawnPoints);
    expect(layout.obstacles).toEqual(LEGACY_LAYOUT.obstacles);
    expect(layout).toEqual(LEGACY_LAYOUT);
  });

  it('adds a fourth row with the 13th desk and grows the room towards the back', () => {
    const layout = buildClassroomLayout(13);
    expect(layout.obstacles).toHaveLength(14);
    expect(layout.obstacles.slice(0, 13)).toEqual(LEGACY_LAYOUT.obstacles);
    const thirteenth = layout.obstacles[13];
    const expected = box(-4.5, 4.8, 0.8, 0.4);
    expect(thirteenth.minX).toBeCloseTo(expected.minX, 9);
    expect(thirteenth.maxX).toBeCloseTo(expected.maxX, 9);
    expect(thirteenth.minZ).toBeCloseTo(expected.minZ, 9);
    expect(thirteenth.maxZ).toBeCloseTo(expected.maxZ, 9);
    expect(layout.bounds.maxZ).toBeCloseTo(8.2, 9);
    expect(layout.bounds.minX).toBe(-8);
    expect(layout.bounds.maxX).toBe(8);
    expect(layout.bounds.minZ).toBe(-6);
    for (const spawn of layout.spawnPoints) expect(spawn.z).toBeCloseTo(7.2, 9);
  });

  it('fills a partial last row from the left in deskIndex order', () => {
    const layout = buildClassroomLayout(14);
    const lastRow = layout.obstacles.slice(13);
    expect(lastRow).toHaveLength(2);
    expect((lastRow[0].minX + lastRow[0].maxX) / 2).toBeCloseTo(-4.5, 9);
    expect((lastRow[1].minX + lastRow[1].maxX) / 2).toBeCloseTo(-1.5, 9);
  });

  it('keeps the teacher desk first and in place', () => {
    expect(buildClassroomLayout(40).obstacles[0]).toEqual(box(0, -4.4, 1.5, 0.4));
  });

  it.each([
    [16, 4],
    [17, 5],
    [40, 10],
  ])('uses ceil(count / 4) rows for %i desks', (count, rows) => {
    const layout = buildClassroomLayout(count);
    expect(layout.obstacles).toHaveLength(count + 1);
    expect(layout.bounds.maxZ).toBeCloseTo(6 + 2.2 * (rows - 3), 9);
  });

  it.each([
    ['below the minimum', 5],
    ['zero', 0],
    ['negative', -7],
    ['fractional below the minimum', 11.9],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('treats %s as 12 desks', (_label, count) => {
    expect(buildClassroomLayout(count)).toEqual(LEGACY_LAYOUT);
  });

  it('floors a fractional count above the minimum', () => {
    expect(buildClassroomLayout(13.9)).toEqual(buildClassroomLayout(13));
  });

  describe.each([12, 13, 16, 17, 40])('with %i desks', (count) => {
    const { bounds, obstacles, spawnPoints, avatarRadius } = buildClassroomLayout(count);

    it('keeps every obstacle inside the bounds and apart from the others', () => {
      obstacles.forEach((obstacle, index) => {
        expect(inside(bounds, obstacle)).toBe(true);
        obstacles
          .slice(index + 1)
          .forEach((other) => expect(overlaps(obstacle, other)).toBe(false));
      });
    });

    it('has walkable spawn points behind the last row', () => {
      expect(spawnPoints.length).toBeGreaterThanOrEqual(7);
      const lastDeskMaxZ = Math.max(...obstacles.map((obstacle) => obstacle.maxZ));
      for (const { x, z } of spawnPoints) {
        expect(z).toBeCloseTo(bounds.maxZ - 1, 9);
        expect(x - avatarRadius).toBeGreaterThanOrEqual(bounds.minX);
        expect(x + avatarRadius).toBeLessThanOrEqual(bounds.maxX);
        expect(z - avatarRadius).toBeGreaterThanOrEqual(bounds.minZ);
        expect(z + avatarRadius).toBeLessThanOrEqual(bounds.maxZ);
        expect(z - avatarRadius).toBeGreaterThan(lastDeskMaxZ);
        const body = box(x, z, avatarRadius, avatarRadius);
        for (const obstacle of obstacles) expect(overlaps(body, obstacle)).toBe(false);
      }
    });
  });
});
