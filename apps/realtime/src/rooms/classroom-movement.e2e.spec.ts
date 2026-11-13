import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  AVATAR_INPUT_MESSAGE,
  AVATAR_SPEED_UNITS_PER_SECOND,
  CLASSROOM_LAYOUT,
  CLASSROOM_ROOM_NAME,
  INPUT_RATE_LIMIT_PER_SECOND,
} from '@aula/contracts';
import { createAppConfig } from '../app.config';
import { ApiJoinVerifier } from '../join/api-join-verifier';
import {
  STUB_SECRET,
  makeUser,
  startStubApi,
  type StubApi,
  type StubUser,
} from '../testing/stub-api';
import { sleep, waitUntil } from '../testing/wait-until';
import type { ClassroomRoom } from './classroom-room';

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';

describe('ClassroomRoom movement (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  let nowMs = 0;
  const ada = makeUser('Ada', 1, [CLASSROOM]);
  const bob = makeUser('Bob', 2, [CLASSROOM]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier, { now: () => nowMs }), 2572);
  });

  beforeEach(() => {
    nowMs = 1_000_000;
  });

  afterEach(async () => {
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  const join = (user: StubUser): Promise<SdkRoom> => {
    colyseus.sdk.auth.token = user.token;
    return colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM });
  };
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;
  const avatarOf = (room: SdkRoom, user: StubUser) => {
    const avatar = serverRoom(room).state.avatars.get(user.userId);
    if (!avatar) throw new Error('avatar missing');
    return avatar;
  };

  it('moves the avatar from direction intents at the fixed speed', async () => {
    const room = await join(ada);
    const avatar = avatarOf(room, ada);
    const startZ = avatar.z;

    room.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
    await waitUntil(() => startZ - avatar.z > 0.45, 'avatar moved north');

    const elapsedSeconds = (startZ - avatar.z) / AVATAR_SPEED_UNITS_PER_SECOND;
    expect(elapsedSeconds).toBeGreaterThan(0.1);
    expect(avatar.x).toBeCloseTo(CLASSROOM_LAYOUT.spawnPoints[0].x, 5);
    expect(avatar.rotation).toBeCloseTo(Math.PI, 5);
  });

  it('stops on a zero input', async () => {
    const room = await join(ada);
    const avatar = avatarOf(room, ada);
    room.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
    await waitUntil(() => avatar.z < CLASSROOM_LAYOUT.spawnPoints[0].z - 0.3, 'moving');

    room.send(AVATAR_INPUT_MESSAGE, { x: 0, z: 0 });
    await sleep(150);
    const stoppedAt = avatar.z;
    await sleep(200);

    expect(avatar.z).toBe(stoppedAt);
  });

  it('keeps the avatar inside the classroom walls', async () => {
    const room = await join(ada);
    const avatar = avatarOf(room, ada);

    room.send(AVATAR_INPUT_MESSAGE, { x: 0, z: 1 });
    await sleep(500);

    expect(avatar.z).toBeLessThanOrEqual(
      CLASSROOM_LAYOUT.bounds.maxZ - CLASSROOM_LAYOUT.avatarRadius + 1e-6,
    );
  });

  it('lets the last input of any connection of the user win', async () => {
    const screen1 = await join(ada);
    const screen2 = await join(ada);
    const avatar = avatarOf(screen1, ada);
    const startX = avatar.x;

    screen1.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });
    await waitUntil(() => avatar.x > startX + 0.3, 'moving east');
    screen2.send(AVATAR_INPUT_MESSAGE, { x: -1, z: 0 });
    const eastmost = avatar.x;

    await waitUntil(() => avatar.x < eastmost - 0.3, 'turned west');
  });

  it('drops messages over the per-connection limit without side effects', async () => {
    const screen1 = await join(ada);
    const avatar = avatarOf(screen1, ada);
    const startX = avatar.x;

    // The clock is frozen, so the bucket does not refill: only the first 30 messages count.
    for (let i = 0; i < INPUT_RATE_LIMIT_PER_SECOND; i++) {
      screen1.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
    }
    for (let i = 0; i < 10; i++) screen1.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });

    await waitUntil(() => avatar.z < CLASSROOM_LAYOUT.spawnPoints[0].z - 0.3, 'moving north');
    expect(avatar.x).toBe(startX);
    expect(serverRoom(screen1).clients).toHaveLength(1); // not even disconnected
  });

  it('keeps the limit per connection', async () => {
    const screen1 = await join(ada);
    const screen2 = await join(ada);
    const avatar = avatarOf(screen1, ada);
    const startX = avatar.x;
    for (let i = 0; i < INPUT_RATE_LIMIT_PER_SECOND + 5; i++) {
      screen1.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
    }
    await sleep(50);

    screen2.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });

    await waitUntil(() => avatar.x > startX + 0.3, 'second screen still accepted');
  });

  it.each([
    ['a component over 1', { x: 5, z: 0 }],
    ['a string component', { x: '1', z: 0 }],
    ['an extra field', { x: 1, z: 0, speed: 100 }],
    ['no payload', undefined],
  ])('rejects %s and leaves the avatar alone', async (_label, payload) => {
    const good = await join(ada);
    const bad = await join(ada);
    const avatar = avatarOf(good, ada);
    const before = { x: avatar.x, z: avatar.z };

    bad.send(AVATAR_INPUT_MESSAGE, payload);

    await waitUntil(() => serverRoom(good).clients.length === 1, 'offending connection closed');
    await sleep(150);
    expect({ x: avatar.x, z: avatar.z }).toEqual(before);
  });

  it('rejects an unknown message type without side effects', async () => {
    const good = await join(ada);
    const bad = await join(ada);
    const avatar = avatarOf(good, ada);
    const before = { x: avatar.x, z: avatar.z };

    bad.send('avatar:teleport', { x: 0, z: 0 });

    await waitUntil(() => serverRoom(good).clients.length === 1, 'offending connection closed');
    expect({ x: avatar.x, z: avatar.z }).toEqual(before);
  });

  it('makes no call to the API and has no database dependency while moving', async () => {
    const room = await join(ada);
    await join(bob);
    const callsAfterJoin = api.calls.length;

    room.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });
    await sleep(400);

    expect(api.calls).toHaveLength(callsAfterJoin);
    const manifest = readFileSync(resolve(__dirname, '../../package.json'), 'utf8');
    expect(manifest).not.toMatch(/prisma|"pg"|postgres/i);
  });
});
