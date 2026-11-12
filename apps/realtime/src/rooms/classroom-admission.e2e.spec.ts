import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
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

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const PORT = 2577;
const REVERIFICATION_PATH = '/internal/realtime/access-reverification';

/**
 * The seat reservation Colyseus issues at matchmaking carries the identity verified then, and
 * replays it when the seat is consumed. These specs hold a reservation without consuming it, take
 * access away, and only then consume it.
 */
describe('ClassroomRoom admission (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 1, [CLASSROOM]);
  const bob = makeUser('Bob', 2, [CLASSROOM]);
  const adaSessionId = ada.sessionId;

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier, { internalServiceSecret: STUB_SECRET }), PORT);
  });

  afterEach(async () => {
    ada.classrooms.add(CLASSROOM);
    ada.sessionId = adaSessionId;
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
    room.reconnection.enabled = false;
    await waitUntil(() => hasAcknowledgedJoin(room), 'join acknowledged');
    return room;
  };
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;
  const hasAcknowledgedJoin = (room: SdkRoom): boolean => {
    const client = serverRoom(room).clients.find((c) => c.sessionId === room.sessionId);
    return (client as unknown as { _enqueuedMessages?: unknown })._enqueuedMessages === undefined;
  };

  /** Matchmakes as `user` and returns the seat reservation without consuming it. */
  const reserveSeat = async (user: StubUser) => {
    colyseus.sdk.auth.token = user.token;
    const response = await colyseus.sdk.http.post(
      `/matchmake/joinOrCreate/${CLASSROOM_ROOM_NAME}`,
      {
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: { classroomId: CLASSROOM },
      },
    );
    return response.data;
  };
  const evict = (body: object) =>
    fetch(`http://127.0.0.1:${PORT}/internal/evictions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service-secret': STUB_SECRET },
      body: JSON.stringify(body),
    });
  const reverifications = () => api.calls.filter((call) => call.path === REVERIFICATION_PATH);

  it('admits a user whose access is intact and checks it again at admission', async () => {
    const observer = await join(bob);
    api.calls.length = 0;

    const room = await join(ada);

    expect(serverRoom(observer).state.avatars.get(ada.userId)?.displayName).toBe('Ada');
    expect(reverifications()).toEqual([
      {
        path: REVERIFICATION_PATH,
        body: { userId: ada.userId, sessionId: ada.sessionId, classroomId: CLASSROOM },
      },
    ]);
    expect(room.sessionId).toBeDefined();
  });

  it('refuses a held reservation after the session was revoked and its eviction was delivered', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    ada.sessionId = '30000000-0000-4000-8000-000000000001'; // the session ended

    const res = await evict({ userId: ada.userId, sessionId: adaSessionId });
    expect(res.status).toBe(204); // nothing was attached yet: this is the race

    await expect(colyseus.sdk.consumeSeatReservation(reservation)).rejects.toMatchObject({
      code: CLOSE_CODE_ACCESS_REVOKED,
      message: CLOSE_REASON_ACCESS_REVOKED,
    });
    await sleep(100);
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
    expect(serverRoom(observer).clients).toHaveLength(1);
    expect(observer.connection.isOpen).toBe(true);
  });

  it('refuses a held reservation after the membership was removed and its eviction was delivered', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    ada.classrooms.delete(CLASSROOM);

    const res = await evict({ userId: ada.userId, classroomId: CLASSROOM });
    expect(res.status).toBe(204);

    await expect(colyseus.sdk.consumeSeatReservation(reservation)).rejects.toMatchObject({
      code: CLOSE_CODE_ACCESS_REVOKED,
      message: CLOSE_REASON_ACCESS_REVOKED,
    });
    await sleep(100);
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
    expect(serverRoom(observer).clients).toHaveLength(1);
    expect(observer.connection.isOpen).toBe(true);
  });

  it('refuses a held reservation by the API check alone when no eviction arrived', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    ada.classrooms.delete(CLASSROOM);

    await expect(colyseus.sdk.consumeSeatReservation(reservation)).rejects.toMatchObject({
      code: CLOSE_CODE_ACCESS_REVOKED,
    });
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
  });

  it('refuses with the retryable code when the API cannot answer at admission', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    api.reverificationStatus = 503;

    await expect(colyseus.sdk.consumeSeatReservation(reservation)).rejects.toMatchObject({
      code: CLOSE_CODE_VERIFICATION_UNAVAILABLE,
    });
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
  });
});
