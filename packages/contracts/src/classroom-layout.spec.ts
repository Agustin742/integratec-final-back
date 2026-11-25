import { describe, expect, it } from 'vitest';
import {
  buildClassroomLayout,
  CLASSROOM_DESK_ROW_SPACING,
  deriveNpcHomes,
  MAX_CLASSROOM_DESKS,
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
const LEGACY_LAYOUT: Omit<ClassroomLayout, 'props'> = {
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
    expect({ ...layout, props: undefined }).toEqual({ ...LEGACY_LAYOUT, props: undefined });
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
    expect(buildClassroomLayout(count)).toEqual(buildClassroomLayout(12));
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

describe('MAX_CLASSROOM_DESKS (#79)', () => {
  it('is a whole number above the minimum room', () => {
    expect(Number.isInteger(MAX_CLASSROOM_DESKS)).toBe(true);
    expect(MAX_CLASSROOM_DESKS).toBeGreaterThan(MIN_CLASSROOM_DESKS);
  });

  it('still yields a layout whose spawn points are inside the bounds', () => {
    const layout = buildClassroomLayout(MAX_CLASSROOM_DESKS);
    expect(layout.obstacles).toHaveLength(MAX_CLASSROOM_DESKS + 1);
    for (const spawn of layout.spawnPoints) {
      expect(spawn.z).toBeLessThan(layout.bounds.maxZ);
    }
  });
});

describe('prop obstacles', () => {
  const find = (layout: ClassroomLayout, id: string) => layout.props.find((p) => p.id === id);

  it('declares the shop kiosk, pet bed and bot station without touching the desk obstacles', () => {
    const layout = buildClassroomLayout(12);
    expect(layout.props.map((p) => p.id)).toEqual([
      'shopKiosk',
      'petBed',
      'botStation',
      'reportCardStand',
      'chatComputer',
      'flagArgentina',
      'flagIntegrar',
      'christmasTree',
      'plantsAndPots',
    ]);
    expect(layout.obstacles).toEqual(LEGACY_LAYOUT.obstacles);
  });

  it('derives the footprints from the front docs and the room bounds', () => {
    const layout = buildClassroomLayout(12);
    const { minX, minZ } = layout.bounds;
    const kiosk = find(layout, 'shopKiosk') as LayoutBox;
    const bed = find(layout, 'petBed') as LayoutBox;
    const station = find(layout, 'botStation') as LayoutBox;
    const expectBox = (actual: LayoutBox, expected: LayoutBox) => {
      expect(actual.minX).toBeCloseTo(expected.minX, 9);
      expect(actual.maxX).toBeCloseTo(expected.maxX, 9);
      expect(actual.minZ).toBeCloseTo(expected.minZ, 9);
      expect(actual.maxZ).toBeCloseTo(expected.maxZ, 9);
    };
    // 1.96 x 0.71 m at (4.8, minZ + 0.44)
    expectBox(kiosk, box(4.8, minZ + 0.44, 0.98, 0.355));
    // 1.04 x 0.80 m at (6.85, minZ + 0.62)
    expectBox(bed, box(6.85, minZ + 0.62, 0.52, 0.4));
    // 1.532 x 1.278 m rotated 90 degrees: 1.278 along x, 1.532 along z, at (minX + 1.05, 1.05)
    expectBox(station, box(minX + 1.05, 1.05, 0.639, 0.766));
    // 0.78 x 0.48 m at (2.95, minZ + 0.32)
    expectBox(find(layout, 'reportCardStand') as LayoutBox, box(2.95, minZ + 0.32, 0.39, 0.24));
    // 0.54 x 0.88 m at (minX + 0.38, -3.0)
    expectBox(find(layout, 'chatComputer') as LayoutBox, box(minX + 0.38, -3.0, 0.27, 0.44));
    // Flags (0.42 x 0.42 m) at the teacher desk front corners: x -1.98..-1.56 and 1.56..1.98.
    expectBox(find(layout, 'flagArgentina') as LayoutBox, box(-1.77, -4.0, 0.21, 0.21));
    expectBox(find(layout, 'flagIntegrar') as LayoutBox, box(1.77, -4.0, 0.21, 0.21));
    // Christmas tree 1.12 x 1.08 m, plants and pots 0.69 x 0.6 m
    expectBox(find(layout, 'christmasTree') as LayoutBox, box(-4, -4.98, 0.56, 0.54));
    expectBox(find(layout, 'plantsAndPots') as LayoutBox, box(minX + 0.655, 2.52, 0.345, 0.3));
  });

  it('stays clear of the walls, the desks and each other', () => {
    for (const desks of [12, 13, 40]) {
      const layout = buildClassroomLayout(desks);
      for (const prop of layout.props) {
        expect(inside(layout.bounds, prop)).toBe(true);
        for (const obstacle of layout.obstacles) expect(overlaps(prop, obstacle)).toBe(false);
      }
      layout.props.forEach((a, i) =>
        layout.props.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)),
      );
    }
  });

  it('keeps the props at the same place when the room grows towards the back', () => {
    expect(buildClassroomLayout(40).props).toEqual(buildClassroomLayout(12).props);
  });
});

describe('deriveNpcHomes', () => {
  it('puts the pet on the bed cushion and the bot in front of its station', () => {
    const layout = buildClassroomLayout(12);
    const homes = deriveNpcHomes(layout);
    const bed = layout.props.find((p) => p.id === 'petBed') as LayoutBox;
    const station = layout.props.find((p) => p.id === 'botStation') as LayoutBox;
    expect(homes.pet.x).toBeGreaterThan(bed.minX);
    expect(homes.pet.x).toBeLessThan(bed.maxX);
    expect(homes.pet.z).toBeGreaterThan(bed.minZ);
    expect(homes.pet.z).toBeLessThan(bed.maxZ);
    expect(homes.tutorBot.x).toBeCloseTo(station.maxX + 0.7, 9);
    expect(homes.tutorBot.z).toBeCloseTo((station.minZ + station.maxZ) / 2, 9);
    expect(homes.tutorBot.rotation).toBeCloseTo(Math.PI / 2, 9);
  });

  it('follows the props of the layout it receives', () => {
    const layout = buildClassroomLayout(12);
    const shifted = {
      ...layout,
      props: layout.props.map((p) =>
        p.id === 'petBed' ? { ...p, minZ: p.minZ + 1, maxZ: p.maxZ + 1 } : p,
      ),
    };
    expect(deriveNpcHomes(shifted).pet.z).toBeCloseTo(deriveNpcHomes(layout).pet.z + 1, 9);
  });
});
