import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { compatibilityErrors } from './avatar-access.port';
import { AvatarDto, BASE_OPTIONS, DEFAULT_AVATAR } from './avatar.dto';

const base: AvatarDto = {
  bodyId: 'male',
  hairId: 'afro',
  topId: 'hoodie',
  hairColor: '#6C4D48',
  clothingColor: '#5B4F96',
};

const errorsFor = (value: Partial<AvatarDto>) => {
  const dto = plainToInstance(AvatarDto, { ...base, ...value });
  return [...validateSync(dto), ...compatibilityErrors(dto)];
};

const LEGACY = {
  male: { hairId: ['afro', 'dreads'], topId: ['hoodie', 'tank'] },
  female: { hairId: ['afro', 'original'], topId: ['hoodie', 'tank', 'tshirt'] },
};
const NEW_HAIR = {
  male: ['short-messy', 'buzz', 'curls'],
  female: ['ponytail', 'bob', 'bun'],
};

describe('avatar option contract', () => {
  it.each(['male', 'female'])('accepts the new top sweater-shirt-tie for %s', (bodyId) => {
    expect(errorsFor({ bodyId, topId: 'sweater-shirt-tie' })).toEqual([]);
  });

  it.each(Object.entries(NEW_HAIR).flatMap(([bodyId, ids]) => ids.map((id) => [bodyId, id])))(
    'accepts the new hair for %s: %s',
    (bodyId, hairId) => {
      expect(errorsFor({ bodyId, hairId, topId: 'tshirt' })).toEqual([]);
    },
  );

  it.each(
    Object.entries(NEW_HAIR).flatMap(([bodyId, ids]) =>
      ids.map((id) => [bodyId === 'male' ? 'female' : 'male', id]),
    ),
  )('rejects hair of the other body for %s: %s', (bodyId, hairId) => {
    expect(errorsFor({ bodyId, hairId, topId: 'tshirt' }).length).toBeGreaterThan(0);
  });

  it('keeps every previously accepted id valid for its body', () => {
    for (const [bodyId, { hairId, topId }] of Object.entries(LEGACY)) {
      expect(BASE_OPTIONS[bodyId].hairId).toEqual(expect.arrayContaining(hairId));
      expect(BASE_OPTIONS[bodyId].topId).toEqual(expect.arrayContaining(topId));
      for (const h of hairId)
        for (const t of topId) {
          expect(errorsFor({ bodyId, hairId: h, topId: t })).toEqual([]);
        }
    }
  });

  it.each([
    { hairId: 'mohawk' },
    { topId: 'cape' },
    { topId: 'Sweater-Shirt-Tie' },
    { hairId: 'ponytail', bodyId: 'male' },
  ])('rejects unknown or mismatched ids %o', (value) => {
    expect(errorsFor(value).length).toBeGreaterThan(0);
  });

  it('defaults new users to the sweater-shirt-tie top with a valid compatible avatar', () => {
    expect(DEFAULT_AVATAR.topId).toBe('sweater-shirt-tie');
    expect(DEFAULT_AVATAR.hairId).toBe('short-messy');
    expect(errorsFor({ ...DEFAULT_AVATAR })).toEqual([]);
  });
});
