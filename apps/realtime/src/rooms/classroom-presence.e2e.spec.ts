import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  CLASSROOM_LAYOUT,
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_REASON_TOO_MANY_CONNECTIONS,
  MAX_CONNECTIONS_PER_USER,
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
import { waitUntil } from '../testing/wait-until';
import type { ClassroomRoom } from './classroom-room';

const CLASSROOM_A = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const CLASSROOM_B = '11111111-1111-4111-8111-111111111111';

describe('ClassroomRoom presence (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 1, [CLASSROOM_A]);
  const bob = makeUser('Bob', 2, [CLASSROOM_A]);
  const carol = makeUser('Carol', 3, [CLASSROOM_B]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob, carol]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier), 2571);
  });

  afterEach(async () => {
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  const join = (user: StubUser, classroomId = CLASSROOM_A): Promise<SdkRoom> => {
    colyseus.sdk.auth.token = user.token;
    return colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId });
  };
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;
  const avatarOf = (room: SdkRoom, user: StubUser) =>
    (room.state as { avatars?: Map<string, Record<string, unknown>> }).avatars?.get(user.userId);

  it('gives a joining member their avatar inside the walkable area', async () => {
    const room = await join(ada);
    await waitUntil(() => avatarOf(room, ada) !== undefined, 'own avatar in client state');

    const avatar = avatarOf(room, ada) as { x: number; z: number } & Record<string, unknown>;
    expect(avatar).toMatchObject({
      userId: ada.userId,
      displayName: 'Ada',
      role: 'STUDENT',
      status: 'online',
    });
    const { spawnPoints, bounds } = CLASSROOM_LAYOUT;
    expect(spawnPoints).toContainEqual({ x: avatar.x, z: avatar.z });
    expect(avatar.x).toBeGreaterThan(bounds.minX);
    expect(avatar.x).toBeLessThan(bounds.maxX);
  });

  it('shows the members already connected to a newcomer, and the newcomer to them', async () => {
    const first = await join(ada);
    const second = await join(bob);

    await waitUntil(() => avatarOf(second, ada) !== undefined, 'ada visible to bob');
    await waitUntil(() => avatarOf(first, bob) !== undefined, 'bob visible to ada');
    expect(avatarOf(second, bob)).toBeDefined();
  });

  it('keeps distinct spawn points for different users', async () => {
    const first = await join(ada);
    const second = await join(bob);
    await waitUntil(() => avatarOf(second, ada) !== undefined, 'ada visible to bob');
    await waitUntil(() => avatarOf(second, bob) !== undefined, 'bob visible to bob');

    const a = avatarOf(second, ada) as { x: number; z: number };
    const b = avatarOf(second, bob) as { x: number; z: number };
    expect({ x: a.x, z: a.z }).not.toEqual({ x: b.x, z: b.z });
    expect(first).toBeDefined();
  });

  it('keeps one avatar for the several connections of a user', async () => {
    const screen1 = await join(ada);
    const screen2 = await join(ada);

    expect(screen2.roomId).toBe(screen1.roomId);
    const room = serverRoom(screen1);
    expect(room.clients).toHaveLength(2);
    expect(room.state.avatars.size).toBe(1);
  });

  it('removes the avatar only when the last connection of the user leaves', async () => {
    const observer = await join(bob);
    const screen1 = await join(ada);
    const screen2 = await join(ada);
    const room = serverRoom(observer);
    await waitUntil(() => avatarOf(observer, ada) !== undefined, 'ada visible');

    await screen1.leave();
    await waitUntil(() => room.clients.length === 2, 'first screen gone');
    expect(room.state.avatars.has(ada.userId)).toBe(true);

    await screen2.leave();
    await waitUntil(() => !room.state.avatars.has(ada.userId), 'avatar removed');
    await waitUntil(() => avatarOf(observer, ada) === undefined, 'removal synced to observers');
    expect(room.state.avatars.has(bob.userId)).toBe(true);
  });

  it(`closes connection number ${MAX_CONNECTIONS_PER_USER + 1} and keeps the others`, async () => {
    const observer = await join(bob);
    const screens = [await join(ada), await join(ada), await join(ada)];
    const room = serverRoom(observer);

    const refusal = await join(ada).catch((e: unknown) => e);
    expect(refusal).toMatchObject({
      code: CLOSE_CODE_TOO_MANY_CONNECTIONS,
      message: CLOSE_REASON_TOO_MANY_CONNECTIONS,
    });

    expect(room.clients).toHaveLength(MAX_CONNECTIONS_PER_USER + 1); // three screens plus the observer
    expect(room.state.avatars.size).toBe(2);
    expect(screens).toHaveLength(MAX_CONNECTIONS_PER_USER);
  });

  it('frees a seat when a connection leaves', async () => {
    const screens = [await join(ada), await join(ada), await join(ada)];
    await screens[0].leave();
    await waitUntil(() => serverRoom(screens[1]).clients.length === 2, 'seat freed');

    await expect(join(ada)).resolves.toBeDefined();
  });

  it('isolates presence per classroom', async () => {
    const inA = await join(ada, CLASSROOM_A);
    const inB = await join(carol, CLASSROOM_B);

    expect(inA.roomId).not.toBe(inB.roomId);
    expect(serverRoom(inA).state.avatars.has(carol.userId)).toBe(false);
    expect(serverRoom(inB).state.avatars.has(ada.userId)).toBe(false);
    expect(serverRoom(inA).state.avatars.size).toBe(1);
    expect(serverRoom(inB).state.avatars.size).toBe(1);
  });
});
