import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { ClientState } from '@colyseus/core';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_ACCESS_REVOKED,
} from '@aula/contracts';
import { createAppConfig } from '../app.config';
import { ApiJoinVerifier } from '../join/api-join-verifier';
import { ApiConnectedTimeReporter } from '../time/api-connected-time-reporter';
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
const REPORT_PATH = '/internal/realtime/connected-time';

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
  let nowMs = Date.parse('2026-11-10T15:00:00.000Z');

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    const reporter = new ApiConnectedTimeReporter({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(
      createAppConfig(verifier, {
        internalServiceSecret: STUB_SECRET,
        now: () => nowMs,
        reporter,
      }),
      PORT,
    );
  });

  afterEach(async () => {
    ada.classrooms.add(CLASSROOM);
    ada.sessionId = adaSessionId;
    api.calls.length = 0;
    api.reverificationStatus = undefined;
    api.reverificationGate = undefined;
    vi.restoreAllMocks();
    nowMs = Date.parse('2026-11-10T15:00:00.000Z');
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
  /** Makes the API hold its reverification answer until `release()` is called. */
  const holdReverification = () => {
    let release!: () => void;
    api.reverificationGate = new Promise<void>((resolve) => (release = resolve));
    return () => release();
  };
  const hasReverificationFor = (user: StubUser) =>
    reverifications().some((call) => call.body.userId === user.userId);
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

  // The two specs below deliver the eviction while no admission is pending, so it finds nothing to
  // evict (204). The refusal comes from the join-time re-verification, which sees the revoked
  // access. The eviction cannot be what refuses the join here: see the in-flight specs further down.
  it('refuses a held reservation through the join re-verification after a session eviction found nothing to evict', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    ada.sessionId = '30000000-0000-4000-8000-000000000001'; // the session ended

    const res = await evict({ userId: ada.userId, sessionId: adaSessionId });
    expect(res.status).toBe(204); // nothing attached or pending yet: the eviction has no effect

    await expect(colyseus.sdk.consumeSeatReservation(reservation)).rejects.toMatchObject({
      code: CLOSE_CODE_ACCESS_REVOKED,
      message: CLOSE_REASON_ACCESS_REVOKED,
    });
    await sleep(100);
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
    expect(serverRoom(observer).clients).toHaveLength(1);
    expect(observer.connection.isOpen).toBe(true);
  });

  it('refuses a held reservation through the join re-verification after a membership eviction found nothing to evict', async () => {
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

  it('refuses an admission whose check is in flight when its session is evicted, though the API then answers 200', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    const release = holdReverification();
    const consumed = colyseus.sdk.consumeSeatReservation(reservation);
    const outcome = consumed.then(
      () => 'joined',
      (error: { code: number }) => error.code,
    );
    await waitUntil(() => hasReverificationFor(ada), 'reverification request received');

    const res = await evict({ userId: ada.userId, sessionId: adaSessionId });
    expect(res.status).toBe(204);
    release(); // the API still says access is granted: only the eviction can refuse the join

    expect(await outcome).toBe(CLOSE_CODE_ACCESS_REVOKED);
    await sleep(100);
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
    expect(serverRoom(observer).clients).toHaveLength(1);
    expect(observer.connection.isOpen).toBe(true);
  });

  it('refuses an admission whose check is in flight when its membership is evicted, though the API then answers 200', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    const release = holdReverification();
    const outcome = colyseus.sdk.consumeSeatReservation(reservation).then(
      () => 'joined',
      (error: { code: number }) => error.code,
    );
    await waitUntil(() => hasReverificationFor(ada), 'reverification request received');

    const res = await evict({ userId: ada.userId, classroomId: CLASSROOM });
    expect(res.status).toBe(204);
    release();

    expect(await outcome).toBe(CLOSE_CODE_ACCESS_REVOKED);
    await sleep(100);
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
    expect(observer.connection.isOpen).toBe(true);
  });

  it('does not evict an in-flight admission of another session of the same user', async () => {
    const observer = await join(bob);
    const reservation = await reserveSeat(ada);
    const release = holdReverification();
    const consumed = colyseus.sdk.consumeSeatReservation(reservation);
    await waitUntil(() => hasReverificationFor(ada), 'reverification request received');

    const res = await evict({
      userId: ada.userId,
      sessionId: '30000000-0000-4000-8000-0000000000aa',
    });
    expect(res.status).toBe(204);
    release();

    const room = await consumed;
    await waitUntil(() => serverRoom(observer).state.avatars.has(ada.userId), 'avatar appears');
    expect(room.sessionId).toBeDefined();
  });

  it('leaves no avatar and no connected time when the socket closes while the admission check is in flight', async () => {
    const observer = await join(bob);
    api.calls.length = 0;
    const reservation = await reserveSeat(ada);
    // The SDK keeps the room it connects private until the join completes: capture it to close it.
    let connecting: SdkRoom | undefined;
    const sdk = colyseus.sdk as unknown as { createRoom: (...args: unknown[]) => SdkRoom };
    const createRoom = sdk.createRoom.bind(sdk);
    vi.spyOn(sdk, 'createRoom').mockImplementation((...args: unknown[]) => {
      connecting = createRoom(...args);
      return connecting;
    });
    const release = holdReverification();
    void colyseus.sdk.consumeSeatReservation(reservation).catch(() => undefined);
    await waitUntil(() => hasReverificationFor(ada), 'reverification request received');

    connecting?.connection.close();
    // Colyseus only marks the client as leaving here: onLeave is not called while onJoin is pending.
    const pendingClient = () =>
      serverRoom(observer).clients.find((c) => c.sessionId === reservation.sessionId);
    await waitUntil(() => pendingClient()?.state === ClientState.LEAVING, 'socket close noticed');
    nowMs += 60_000; // had the user been admitted, this minute would be reported
    release(); // the API still says access is granted

    await sleep(200);
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
    expect(serverRoom(observer).clients).toHaveLength(1);
    expect(observer.connection.isOpen).toBe(true);
    expect(api.calls.filter((call) => call.path === REPORT_PATH)).toEqual([]);
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
