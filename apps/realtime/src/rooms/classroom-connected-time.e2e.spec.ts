import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { AVATAR_INPUT_MESSAGE, CLASSROOM_ROOM_NAME } from '@aula/contracts';
import { createAppConfig } from '../app.config';
import { ApiJoinVerifier } from '../join/api-join-verifier';
import {
  STUB_SECRET,
  makeUser,
  startStubApi,
  type StubApi,
  type StubUser,
} from '../testing/stub-api';
import { ApiConnectedTimeReporter } from '../time/api-connected-time-reporter';
import { sleep, waitUntil } from '../testing/wait-until';
import type { ClassroomRoom } from './classroom-room';

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const REPORT_PATH = '/internal/realtime/connected-time';
const T0 = Date.parse('2026-11-10T15:00:00.000Z');

describe('ClassroomRoom connected time (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  let nowMs = T0;
  const ada = makeUser('Ada', 1, [CLASSROOM]);
  const bob = makeUser('Bob', 2, [CLASSROOM]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    const reporter = new ApiConnectedTimeReporter({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(
      createAppConfig(verifier, { now: () => nowMs, reporter, reconnectionWindowSeconds: 1 }),
      2574,
    );
  });

  beforeEach(() => {
    nowMs = T0;
  });

  afterEach(async () => {
    api.connectedTimeStatus = 204;
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
    api.calls.length = 0;
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
  const reports = () => api.calls.filter((call) => call.path === REPORT_PATH).map((c) => c.body);
  const advance = (seconds: number) => {
    nowMs += seconds * 1000;
  };
  const drop = (room: SdkRoom): void => {
    const client = serverRoom(room).clients.find((c) => c.sessionId === room.sessionId);
    (client as unknown as { ref: { terminate(): void } }).ref.terminate();
  };

  it('reports one aggregate when the user finally leaves', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    advance(90);

    await room.leave();

    await waitUntil(() => reports().length === 1, 'report');
    expect(reports()[0]).toEqual({
      userId: ada.userId,
      classroomId: CLASSROOM,
      connectedSeconds: 90,
      endedAt: new Date(T0 + 90_000).toISOString(),
    });
    expect(observer).toBeDefined();
  });

  it('counts the union of several connections once and reports after the last one', async () => {
    const observer = await join(bob);
    const screen1 = await join(ada);
    advance(30);
    const screen2 = await join(ada);
    advance(30);
    await screen1.leave();
    await sleep(100);
    expect(reports()).toHaveLength(0); // still connected through the second screen

    advance(40);
    await screen2.leave();

    await waitUntil(() => reports().length === 1, 'report');
    expect(reports()[0]).toMatchObject({ userId: ada.userId, connectedSeconds: 100 });
    expect(observer).toBeDefined();
  });

  it('does not count the time spent reconnecting', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    const token = room.reconnectionToken;
    advance(40);
    drop(room);
    await waitUntil(
      () => serverRoom(observer).state.avatars.get(ada.userId)?.status === 'reconnecting',
      'reconnecting',
    );
    advance(15); // the gap
    const back = await colyseus.sdk.reconnect(token);
    await waitUntil(
      () => serverRoom(observer).state.avatars.get(ada.userId)?.status === 'online',
      'online',
    );
    advance(15);

    await back.leave();

    await waitUntil(() => reports().length === 1, 'report');
    expect(reports()[0]).toMatchObject({ connectedSeconds: 55 });
  });

  it('reports when the reconnection window expires without the gap', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    advance(40);
    drop(room);

    await waitUntil(() => reports().length === 1, 'report after the window', 3000);
    expect(reports()[0]).toMatchObject({ userId: ada.userId, connectedSeconds: 40 });
    expect(serverRoom(observer).state.avatars.has(ada.userId)).toBe(false);
  });

  it('does not report sub-second visits', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    advance(0.2);

    await room.leave();
    await sleep(150);

    expect(reports()).toHaveLength(0);
    expect(observer).toBeDefined();
  });

  it('never reports per tick: nothing is sent while users move', async () => {
    const observer = await join(bob);
    const room = await join(ada);
    room.send(AVATAR_INPUT_MESSAGE, { x: 1, z: 0 });
    await sleep(400);

    expect(reports()).toHaveLength(0);
    expect(observer).toBeDefined();
  });

  it('reports everyone still present when the room is disposed', async () => {
    await join(ada);
    await join(bob);
    advance(25);

    await colyseus.cleanup();

    await waitUntil(() => reports().length === 2, 'reports on dispose');
    const byUser = Object.fromEntries(reports().map((r) => [String(r.userId), r.connectedSeconds]));
    expect(byUser).toEqual({ [ada.userId]: 25, [bob.userId]: 25 });
  });

  it('survives a failing API and logs no personal data', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    api.connectedTimeStatus = 500;
    const observer = await join(bob);
    const room = await join(ada);
    advance(30);

    await room.leave();

    await waitUntil(() => reports().length === 1, 'attempted report');
    await waitUntil(() => warn.mock.calls.length > 0, 'failure logged');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(ada.userId);
    expect(logged).not.toContain(CLASSROOM);
    expect(serverRoom(observer).clients).toHaveLength(1); // the room keeps working
    warn.mockRestore();
  });
});
