import { CLASSROOM_LAYOUT } from '@aula/contracts';
import { describe, expect, it } from 'vitest';
import { pickSpawnPoint } from './spawn';

describe('pickSpawnPoint', () => {
  const { spawnPoints } = CLASSROOM_LAYOUT;

  it('uses the first spawn point of an empty classroom', () => {
    expect(pickSpawnPoint(CLASSROOM_LAYOUT, [])).toEqual(spawnPoints[0]);
  });

  it('skips spawn points already taken by an avatar', () => {
    expect(pickSpawnPoint(CLASSROOM_LAYOUT, [spawnPoints[0]])).toEqual(spawnPoints[1]);
    expect(pickSpawnPoint(CLASSROOM_LAYOUT, [spawnPoints[0], spawnPoints[1]])).toEqual(
      spawnPoints[2],
    );
  });

  it('treats an avatar standing close to a spawn point as occupying it', () => {
    const near = { x: spawnPoints[0].x + 0.1, z: spawnPoints[0].z };
    expect(pickSpawnPoint(CLASSROOM_LAYOUT, [near])).toEqual(spawnPoints[1]);
  });

  it('falls back to the first spawn point when every one is taken', () => {
    expect(pickSpawnPoint(CLASSROOM_LAYOUT, [...spawnPoints])).toEqual(spawnPoints[0]);
  });
});
