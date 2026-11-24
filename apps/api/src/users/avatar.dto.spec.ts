import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { AvatarDto, BASE_OPTIONS, DEFAULT_AVATAR } from './avatar.dto';
import {
  AVATAR_BODY_IDS,
  FREE_HAIR_IDS,
  FREE_TOP_IDS,
  HAIR_IDS,
  PAID_HAIR_IDS,
  PAID_TOP_IDS,
  TOP_IDS,
  isFreeAvatarStyle,
} from './avatar-catalog';
import { compatibilityErrors } from './avatar-access.port';

const hairs = [
  'afro',
  'afro-with-headband',
  'bob',
  'box-braids',
  'braid',
  'bun',
  'buzz-cut',
  'classic-short',
  'dreads',
  'fringe',
  'half-up',
  'long-curls',
  'long-straight',
  'long-wavy',
  'messy',
  'middle-part',
  'ponytail',
  'short-curls',
  'side-part',
  'soft-mohawk',
  'two-braids',
  'two-pigtails',
  'wavy',
];
const tops = [
  'basic-tshirt',
  'denim-jacket',
  'flannel-shirt',
  'holiday-sweater',
  'hoodie',
  'national-team-jersey',
  'school-polo',
  'school-smock',
  'school-sweatshirt',
  'shirt-and-tie',
  'sweater',
  'tank-top',
  'track-jacket',
  'vest',
  'winter-coat',
];
const freeHairs = [
  'buzz-cut',
  'classic-short',
  'short-curls',
  'bob',
  'middle-part',
  'long-straight',
  'ponytail',
  'bun',
  'afro',
];
const freeTops = ['school-smock', 'school-sweatshirt', 'basic-tshirt', 'tank-top'];

const validate = (value: object) => validateSync(plainToInstance(AvatarDto, value));

describe('avatar catalog', () => {
  it('lists the modular hair and top ids', () => {
    expect([...HAIR_IDS].sort()).toEqual(hairs);
    expect([...TOP_IDS].sort()).toEqual(tops);
    expect(AVATAR_BODY_IDS).toEqual(['male', 'female']);
  });

  it('classifies free and paid styles', () => {
    expect([...FREE_HAIR_IDS].sort()).toEqual([...freeHairs].sort());
    expect([...FREE_TOP_IDS].sort()).toEqual([...freeTops].sort());
    expect(PAID_HAIR_IDS).toHaveLength(14);
    expect(PAID_TOP_IDS).toHaveLength(11);
    expect(isFreeAvatarStyle('hair', 'classic-short')).toBe(true);
    expect(isFreeAvatarStyle('hair', 'dreads')).toBe(false);
    expect(isFreeAvatarStyle('top', 'school-sweatshirt')).toBe(true);
    expect(isFreeAvatarStyle('top', 'hoodie')).toBe(false);
  });

  it('allows every hair and top for both bodies', () => {
    for (const bodyId of AVATAR_BODY_IDS) {
      expect(BASE_OPTIONS[bodyId].hairId).toEqual(HAIR_IDS);
      expect(BASE_OPTIONS[bodyId].topId).toEqual(TOP_IDS);
    }
  });

  it('defaults to free options', () => {
    expect(DEFAULT_AVATAR).toMatchObject({ hairId: 'classic-short', topId: 'school-sweatshirt' });
    expect(isFreeAvatarStyle('hair', DEFAULT_AVATAR.hairId)).toBe(true);
    expect(isFreeAvatarStyle('top', DEFAULT_AVATAR.topId)).toBe(true);
    expect(compatibilityErrors(DEFAULT_AVATAR)).toEqual([]);
  });

  it('validates new ids and rejects legacy ids', () => {
    expect(validate({ ...DEFAULT_AVATAR, hairId: 'dreads', topId: 'winter-coat' })).toEqual([]);
    for (const legacy of ['original', 'tshirt', 'tank']) {
      expect(validate({ ...DEFAULT_AVATAR, hairId: legacy })).not.toEqual([]);
      expect(validate({ ...DEFAULT_AVATAR, topId: legacy })).not.toEqual([]);
    }
  });
});
