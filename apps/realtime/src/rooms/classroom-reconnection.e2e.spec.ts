import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { CLASSROOM_ROOM_NAME } from '@aula/contracts';
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
const WINDOW_SECONDS = 1;

describe('ClassroomRoom reconnection (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 1, [CLASSROOM]);
  const bob = makeUser('Bob', 2, [CLASSROOM]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(
      createAppConfig(verifier, { reconnectionWindowSeconds: WINDOW_SECONDS }),
      2573,
    );
  });

  afterEach(async () => {
    ada.classrooms.add(CLASSROOM);
    api.calls.length = 0;
    api.reverificationStatus = undefined;
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  const join = async (user: StubUser): Promise<SdkRoom> => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM });
    // The test drives reconnection itself, so the SDK must not retry on its own.
    room.reconnection.enabled = false;
    // The server only allows reconnection once the client acknowledged the join.
    await waitUntil(() => hasAcknowledgedJoin(room), 'join acknowledged');
    return room;
  };
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;
  const hasAcknowledgedJoin = (room: SdkRoom): boolean => {
    const client = serverRoom(room).clients.find((c) => c.sessionId === room.sessionId);
    return (client as unknown as { _enqueuedMessages?: unknown })._enqueuedMessages === undefined;
  };
  const avatarOf = (room: SdkRoom, user: StubUser) =>
    serverRoom(room).state.avatars.get(user.userId);

  /** Abruptly kills the socket of one connection, like a network drop (no consented leave). */
  const drop = (room: SdkRoom): void => {
    const client = serverRoom(room).clients.find((c) => c.sessionId === room.sessionId);
    (client as unknown as { ref: { terminate(): void } }).ref.terminate();
  };

  it('keeps the avatar as reconnecting after the last connection drops', async () => {
    const observer = await join(bob);
    const room = await join(ada);

    drop(room);

    await waitUntil(() => avatarOf(observer, ada)?.status === 'reconnecting', 'reconnecting');
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(true);
  });

  it('restores the avatar online when the client reconnects in time', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    const token = room.reconnectionToken;
    drop(room);
    await waitUntil(() => avatarOf(observer, ada)?.status === 'reconnecting', 'reconnecting');

    const back = await colyseus.sdk.reconnect(token);

    await waitUntil(() => avatarOf(observer, ada)?.status === 'online', 'online again');
    expect(back.sessionId).toBe(room.sessionId);
    expect(serverRoom(observer).state.avatars.size).toBe(2);
  });

  it('re-verifies access with the API when the client comes back', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    const token = room.reconnectionToken;
    drop(room);
    await waitUntil(() => avatarOf(observer, ada)?.status === 'reconnecting', 'reconnecting');
    api.calls.length = 0;

    await colyseus.sdk.reconnect(token);

    const reverifications = api.calls.filter(
      (call) => call.path === '/internal/realtime/access-reverification',
    );
    expect(reverifications).toEqual([
      {
        path: '/internal/realtime/access-reverification',
        body: { userId: ada.userId, sessionId: ada.sessionId, classroomId: CLASSROOM },
      },
    ]);
  });

  it('removes the avatar when the window expires', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    drop(room);
    await waitUntil(() => avatarOf(observer, ada)?.status === 'reconnecting', 'reconnecting');

    await waitUntil(
      () => !serverRoom(observer).state.avatars.has(ada.userId),
      'avatar removed after the window',
      WINDOW_SECONDS * 1000 + 1500,
    );
  });

  it('refuses a reconnection after the window and keeps the avatar gone', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    const token = room.reconnectionToken;
    drop(room);
    await waitUntil(
      () => !serverRoom(observer).state.avatars.has(ada.userId),
      'window expired',
      WINDOW_SECONDS * 1000 + 1500,
    );

    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
  });

  it('refuses the reconnection and removes the avatar when access was lost meanwhile', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    const token = room.reconnectionToken;
    drop(room);
    await waitUntil(() => avatarOf(observer, ada)?.status === 'reconnecting', 'reconnecting');
    ada.classrooms.delete(CLASSROOM);

    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();

    await waitUntil(
      () => !serverRoom(observer).state.avatars.has(ada.userId),
      'avatar removed after the denied reconnection',
    );
  });

  it('fails closed when the API cannot answer the re-verification', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    const token = room.reconnectionToken;
    drop(room);
    await waitUntil(() => avatarOf(observer, ada)?.status === 'reconnecting', 'reconnecting');
    api.reverificationStatus = 503;

    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();

    await waitUntil(
      () => !serverRoom(observer).state.avatars.has(ada.userId),
      'avatar removed after the failed re-verification',
    );
  });

  it('skips the window for a consented leave', async () => {
    const observer = await join(bob);
    const room = await join(ada);

    await room.leave();

    await waitUntil(
      () => !serverRoom(observer).state.avatars.has(ada.userId),
      'removed at once',
      500,
    );
  });

  it('keeps the avatar online while another connection of the user stays live', async () => {
    const observer = await join(bob);
    const screen1 = await join(ada);
    await join(ada);

    drop(screen1);
    await sleep(200);

    expect(avatarOf(observer, ada)?.status).toBe('online');
    await sleep(WINDOW_SECONDS * 1000 + 500);
    expect(avatarOf(observer, ada)?.status).toBe('online');
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(true);
  });

  it('counts a held connection toward the cap so a reconnection cannot exceed it', async () => {
    const observer = await join(bob);
    const screens = [await join(ada), await join(ada), await join(ada)];
    drop(screens[0]);
    await waitUntil(() => serverRoom(observer).clients.length === 3, 'one screen held');

    await expect(join(ada)).rejects.toThrow();
  });
});
