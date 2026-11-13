import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_REASON_ACCESS_REVOKED,
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

const CLASSROOM_A = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const CLASSROOM_B = '11111111-1111-4111-8111-111111111111';
const PORT = 2575;

describe('ClassroomRoom live eviction (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 1, [CLASSROOM_A, CLASSROOM_B]);
  // Same account, second login (another device): same user id, its own session.
  const adaPhone: StubUser = {
    ...ada,
    token: 'token-ada-phone',
    sessionId: '20000000-0000-4000-8000-000000000001',
  };
  const bob = makeUser('Bob', 2, [CLASSROOM_A, CLASSROOM_B]);

  beforeAll(async () => {
    api = await startStubApi([ada, adaPhone, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(
      createAppConfig(verifier, {
        internalServiceSecret: STUB_SECRET,
        reconnectionWindowSeconds: 5,
      }),
      PORT,
    );
  });

  afterEach(async () => {
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  interface Joined {
    room: SdkRoom;
    closed: Promise<{ code: number; reason?: string }>;
  }

  const join = async (user: StubUser, classroomId = CLASSROOM_A): Promise<Joined> => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId });
    room.reconnection.enabled = false;
    const closed = new Promise<{ code: number; reason?: string }>((resolve) =>
      room.onLeave((code, reason) => resolve({ code, reason })),
    );
    await waitUntil(() => hasAcknowledgedJoin(room), 'join acknowledged');
    return { room, closed };
  };
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;
  const hasAcknowledgedJoin = (room: SdkRoom): boolean => {
    const client = serverRoom(room).clients.find((c) => c.sessionId === room.sessionId);
    return (client as unknown as { _enqueuedMessages?: unknown })._enqueuedMessages === undefined;
  };
  const evict = (body: object, secret: string | null = STUB_SECRET) =>
    fetch(`http://127.0.0.1:${PORT}/internal/evictions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === null ? {} : { 'x-internal-service-secret': secret }),
      },
      body: JSON.stringify(body),
    });
  const has = (room: SdkRoom, user: StubUser) => serverRoom(room).state.avatars.has(user.userId);

  it('closes every connection of the user in the classroom with 4001 and removes the avatar', async () => {
    const observer = await join(bob);
    const screen1 = await join(ada);
    const screen2 = await join(ada);

    const res = await evict({ userId: ada.userId, classroomId: CLASSROOM_A });

    expect(res.status).toBe(204);
    await expect(screen1.closed).resolves.toEqual({
      code: CLOSE_CODE_ACCESS_REVOKED,
      reason: CLOSE_REASON_ACCESS_REVOKED,
    });
    await expect(screen2.closed).resolves.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
    expect(has(observer.room, ada)).toBe(false);
    expect(has(observer.room, bob)).toBe(true);
    await waitUntil(() => serverRoom(observer.room).clients.length === 1, 'sockets closed');
  });

  it('leaves the same user in another classroom alone when a classroom is named', async () => {
    const inA = await join(ada, CLASSROOM_A);
    const inB = await join(ada, CLASSROOM_B);
    await join(bob, CLASSROOM_B);

    await evict({ userId: ada.userId, classroomId: CLASSROOM_A });

    await expect(inA.closed).resolves.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
    await sleep(100);
    expect(has(inB.room, ada)).toBe(true);
  });

  it('closes the connections of a revoked session in every classroom and spares other sessions', async () => {
    const laptopA = await join(ada, CLASSROOM_A);
    const phoneA = await join(adaPhone, CLASSROOM_A);
    const phoneB = await join(adaPhone, CLASSROOM_B);

    await evict({ userId: ada.userId, sessionId: adaPhone.sessionId });

    await expect(phoneA.closed).resolves.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
    await expect(phoneB.closed).resolves.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
    await sleep(100);
    expect(serverRoom(laptopA.room).clients).toHaveLength(1);
    expect(has(laptopA.room, ada)).toBe(true); // the avatar stays: a connection remains
  });

  it('closes everything the user holds when all sessions were revoked', async () => {
    const laptopA = await join(ada, CLASSROOM_A);
    const phoneB = await join(adaPhone, CLASSROOM_B);

    await evict({ userId: ada.userId });

    await expect(laptopA.closed).resolves.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
    await expect(phoneB.closed).resolves.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
  });

  it('removes a user waiting to reconnect at once and blocks their reconnection', async () => {
    const observer = await join(bob);
    const { room } = await join(ada);
    const token = room.reconnectionToken;
    const client = serverRoom(observer.room).clients.find((c) => c.sessionId === room.sessionId);
    (client as unknown as { ref: { terminate(): void } }).ref.terminate();
    await waitUntil(
      () => serverRoom(observer.room).state.avatars.get(ada.userId)?.status === 'reconnecting',
      'reconnecting',
    );

    await evict({ userId: ada.userId, classroomId: CLASSROOM_A });

    expect(has(observer.room, ada)).toBe(false);
    // The API would still say yes, so only the eviction itself can be what refuses this.
    await expect(colyseus.sdk.reconnect(token)).rejects.toThrow();
    expect(has(observer.room, ada)).toBe(false);
  });

  it('does not stop the user from joining again once their access is back', async () => {
    const first = await join(ada);
    await evict({ userId: ada.userId, classroomId: CLASSROOM_A });
    await first.closed;

    const again = await join(ada);

    expect(has(again.room, ada)).toBe(true);
  });

  it('is idempotent: repeating an eviction, or evicting a stranger, is a harmless 204', async () => {
    const observer = await join(bob);
    const { closed } = await join(ada);

    expect((await evict({ userId: ada.userId })).status).toBe(204);
    await closed;
    expect((await evict({ userId: ada.userId })).status).toBe(204);
    expect((await evict({ userId: '99999999-9999-4999-8999-999999999999' })).status).toBe(204);

    expect(has(observer.room, bob)).toBe(true);
  });

  it('refuses callers without the service secret and evicts nobody', async () => {
    const { room } = await join(ada);

    expect((await evict({ userId: ada.userId }, null)).status).toBe(401);
    expect((await evict({ userId: ada.userId }, 'x'.repeat(STUB_SECRET.length))).status).toBe(401);

    await sleep(100);
    expect(has(room, ada)).toBe(true);
  });
});
