import { ShopItemKind } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  FREE_HAIR_IDS,
  FREE_TOP_IDS,
  PAID_HAIR_IDS,
  PAID_TOP_IDS,
} from '../src/users/avatar-catalog';
import { SHOP_CATALOG } from './seed-shop-catalog';

const EXPECTED_ACCESSORIES: ReadonlyArray<[string, string, number]> = [
  ['head_headband', '#F5B5AB', 80],
  ['head_cap', '#75B7DA', 100],
  ['head_backwards_cap', '#E66861', 110],
  ['head_beanie', '#7EBA8B', 110],
  ['head_headphones', '#B5A7D6', 150],
  ['head_graduation_cap', '#5B4F96', 180],
  ['head_top_hat', '#353849', 200],
  ['head_crown', '#F7D86B', 240],
  ['head_astronaut_helmet', '#FFF9EB', 250],
  ['face_face_paint', '#E66861', 80],
  ['face_round_glasses', '#AF7B52', 90],
  ['face_square_glasses', '#5B4F96', 90],
  ['face_face_mask', '#A9E7F4', 100],
  ['face_sunglasses', '#353849', 120],
  ['face_masquerade_mask', '#C77DAA', 150],
  ['back_backpack', '#62CFC7', 120],
  ['back_rolling_backpack', '#5B4F96', 150],
  ['back_racket', '#65B96A', 160],
  ['back_guitar', '#AF7B52', 200],
  ['back_superhero_cape', '#E66861', 220],
  ['back_wings', '#FFF9EB', 250],
];

const styles = SHOP_CATALOG.filter((item) => item.kind === ShopItemKind.AVATAR_STYLE);
const accessories = SHOP_CATALOG.filter((item) => item.kind === ShopItemKind.AVATAR_ACCESSORY);
const styleIds = (type: 'hair' | 'top'): string[] =>
  styles
    .map((item) => item.metadata as { styleType: string; styleId: string })
    .filter((meta) => meta.styleType === type)
    .map((meta) => meta.styleId);

describe('seed shop catalog', () => {
  it('has 21 accessories and 25 styles, all implemented and active', () => {
    expect(SHOP_CATALOG).toHaveLength(46);
    expect(accessories).toHaveLength(21);
    expect(styles).toHaveLength(25);
    expect(SHOP_CATALOG.every((item) => item.isActive && item.isImplemented)).toBe(true);
  });

  it('uses unique codes and prices within 80..250', () => {
    expect(new Set(SHOP_CATALOG.map((item) => item.code)).size).toBe(46);
    for (const item of SHOP_CATALOG) {
      expect(item.defaultPrice).toBeGreaterThanOrEqual(80);
      expect(item.defaultPrice).toBeLessThanOrEqual(250);
      expect(item.name.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('mirrors the front accessory colors, prices and code convention', () => {
    expect(
      accessories.map((item) => [
        item.code,
        (item.metadata as { color: string }).color,
        item.defaultPrice,
      ]),
    ).toEqual(EXPECTED_ACCESSORIES);
    for (const item of accessories) {
      const { assetId, slot } = item.metadata as { assetId: string; slot: string };
      expect(item.code).toBe(`${slot}_${assetId.replaceAll('-', '_')}`);
    }
  });

  it('sells exactly one item per paid style and none for free styles', () => {
    expect([...styleIds('hair')].sort()).toEqual([...PAID_HAIR_IDS].sort());
    expect([...styleIds('top')].sort()).toEqual([...PAID_TOP_IDS].sort());
    const all = [...styleIds('hair'), ...styleIds('top')];
    for (const free of [...FREE_HAIR_IDS, ...FREE_TOP_IDS]) {
      expect(all).not.toContain(free);
    }
  });

  it('prices every paid style as specified', () => {
    const priceOf = (code: string): number | undefined =>
      SHOP_CATALOG.find((item) => item.code === code)?.defaultPrice;
    expect(priceOf('top_denim_jacket')).toBe(140);
    expect(priceOf('top_school_polo')).toBe(80);
    expect(priceOf('top_national_team_jersey')).toBe(200);
    expect(priceOf('hair_side_part')).toBe(80);
    expect(priceOf('hair_afro_with_headband')).toBe(200);
    expect(priceOf('hair_box_braids')).toBe(180);
  });
});
