import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  CALL_DECLINE_MESSAGE,
  CALL_DECLINED_EVENT,
  CALL_ENDED_EVENT,
  CALL_INCOMING_EVENT,
  CALL_RING_CANCELED_EVENT,
  CALL_ROOM_NAME,
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_CALL_ENDED,
  type CallJoinOptions,
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

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const OTHER_CLASSROOM = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const PORT = 2580;
const RING_TIMEOUT_MS = 400;

interface Inbox {
  incoming: unknown[];
  declined: unknown[];
  canceled: unknown[];
}

describe('direct call ringing (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 2, [CLASSROOM]);
  const bob = makeUser('Bob', 3, [CLASSROOM, OTHER_CLASSROOM]);
  const cara = makeUser('Cara', 4, [CLASSROOM]);
  const directTo = (peer: StubUser): CallJoinOptions => ({
    kind: 'direct',
    classroomId: CLASSROOM,
    peerUserId: peer.userId,
  });

  beforeAll(async () => {
    api = await startStubApi([ada, bob, cara]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(
      createAppConfig(verifier, { callRingTimeoutMs: RING_TIMEOUT_MS, callMaxParticipants: 4 }),
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

  /** A classroom connection that records every call event the server pushes to it. */
  const joinClassroom = async (
    user: StubUser,
    classroomId = CLASSROOM,
  ): Promise<{ room: SdkRoom; inbox: Inbox }> => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId });
    room.reconnection.enabled = false;
    const inbox: Inbox = { incoming: [], declined: [], canceled: [] };
    room.onMessage(CALL_INCOMING_EVENT, (m) => inbox.incoming.push(m));
    room.onMessage(CALL_DECLINED_EVENT, (m) => inbox.declined.push(m));
    room.onMessage(CALL_RING_CANCELED_EVENT, (m) => inbox.canceled.push(m));
    return { room, inbox };
  };

  /** A call connection that records how the call ended. */
  const joinCall = async (user: StubUser, options: CallJoinOptions) => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CALL_ROOM_NAME, options);
    room.reconnection.enabled = false;
    const seen: { code?: number; ended?: unknown } = {};
    room.onMessage(CALL_ENDED_EVENT, (m) => (seen.ended = m));
    room.onLeave((code) => (seen.code = code));
    return { room, seen };
  };

  describe('ringing', () => {
    it('rings every classroom connection of the peer, and nobody else', async () => {
      const bobA = await joinClassroom(bob);
      const bobB = await joinClassroom(bob);
      const bobElsewhere = await joinClassroom(bob, OTHER_CLASSROOM);
      const caraWorld = await joinClassroom(cara);
      const adaWorld = await joinClassroom(ada);

      await joinCall(ada, directTo(bob));

      const expected = {
        classroomId: CLASSROOM,
        callerUserId: ada.userId,
        callerDisplayName: 'Ada',
      };
      await waitUntil(
        () => bobA.inbox.incoming.length > 0 && bobB.inbox.incoming.length > 0,
        'ring',
      );
      expect(bobA.inbox.incoming).toEqual([expected]);
      expect(bobB.inbox.incoming).toEqual([expected]);
      await sleep(100);
      expect(bobElsewhere.inbox.incoming).toEqual([]);
      expect(caraWorld.inbox.incoming).toEqual([]);
      expect(adaWorld.inbox.incoming).toEqual([]);
    });

    it('tells the caller the peer is unavailable when the peer has no classroom connection', async () => {
      const { seen } = await joinCall(ada, directTo(bob));

      await waitUntil(() => seen.code !== undefined, 'unavailable');
      expect(seen).toEqual({ code: CLOSE_CODE_CALL_ENDED, ended: { reason: 'unavailable' } });
    });

    it('does not ring the peer again when the caller reconnects over the old connection', async () => {
      const bobWorld = await joinClassroom(bob);
      await joinCall(ada, directTo(bob));
      await waitUntil(() => bobWorld.inbox.incoming.length === 1, 'first ring');

      await joinCall(ada, directTo(bob));
      await sleep(100);

      expect(bobWorld.inbox.incoming).toHaveLength(1);
    });
  });

  describe('answering', () => {
    it('stops the ringing on every callee connection and keeps the call past the timeout', async () => {
      const bobA = await joinClassroom(bob);
      const bobB = await joinClassroom(bob);
      const caller = await joinCall(ada, directTo(bob));
      await waitUntil(() => bobA.inbox.incoming.length > 0, 'ring');

      const callee = await joinCall(bob, directTo(ada));

      const canceled = [{ callerUserId: ada.userId, reason: 'answered' }];
      await waitUntil(
        () => bobA.inbox.canceled.length > 0 && bobB.inbox.canceled.length > 0,
        'cancel',
      );
      expect(bobA.inbox.canceled).toEqual(canceled);
      expect(bobB.inbox.canceled).toEqual(canceled);
      await sleep(RING_TIMEOUT_MS + 300);
      expect(caller.seen.code).toBeUndefined();
      expect(callee.seen.code).toBeUndefined();
    });
  });

  describe('ring timeout', () => {
    it('ends the call for the caller and stops the ringing when the peer does not answer', async () => {
      const bobWorld = await joinClassroom(bob);
      const { seen } = await joinCall(ada, directTo(bob));
      await waitUntil(() => bobWorld.inbox.incoming.length > 0, 'ring');

      await waitUntil(() => seen.code !== undefined, 'timeout', RING_TIMEOUT_MS + 2000);

      expect(seen).toEqual({ code: CLOSE_CODE_CALL_ENDED, ended: { reason: 'timeout' } });
      await waitUntil(() => bobWorld.inbox.canceled.length > 0, 'cancel');
      expect(bobWorld.inbox.canceled).toEqual([{ callerUserId: ada.userId, reason: 'timeout' }]);
    });
  });

  describe('declining', () => {
    it('tells the caller, ends the call and stops the other callee connections ringing', async () => {
      const bobA = await joinClassroom(bob);
      const bobB = await joinClassroom(bob);
      const adaWorld = await joinClassroom(ada);
      const caller = await joinCall(ada, directTo(bob));
      await waitUntil(() => bobA.inbox.incoming.length > 0, 'ring');

      bobA.room.send(CALL_DECLINE_MESSAGE, { callerUserId: ada.userId });

      await waitUntil(() => caller.seen.code !== undefined, 'call ended');
      expect(caller.seen).toEqual({ code: CLOSE_CODE_CALL_ENDED, ended: { reason: 'declined' } });
      await waitUntil(() => adaWorld.inbox.declined.length > 0, 'declined');
      expect(adaWorld.inbox.declined).toEqual([{ byUserId: bob.userId }]);
      await waitUntil(() => bobB.inbox.canceled.length > 0, 'other connection stops ringing');
      expect(bobB.inbox.canceled).toEqual([{ callerUserId: ada.userId, reason: 'declined' }]);
    });

    it('ignores a decline from a non-callee, for another caller, or without a ringing call', async () => {
      const bobWorld = await joinClassroom(bob);
      const caraWorld = await joinClassroom(cara);
      const adaWorld = await joinClassroom(ada);
      const caller = await joinCall(ada, directTo(bob));
      await waitUntil(() => bobWorld.inbox.incoming.length > 0, 'ring');

      caraWorld.room.send(CALL_DECLINE_MESSAGE, { callerUserId: ada.userId }); // not the callee
      bobWorld.room.send(CALL_DECLINE_MESSAGE, { callerUserId: cara.userId }); // wrong caller
      adaWorld.room.send(CALL_DECLINE_MESSAGE, { callerUserId: bob.userId }); // the caller itself
      await sleep(150);

      expect(caller.seen.code).toBeUndefined();
      expect(adaWorld.inbox.declined).toEqual([]);
      expect(bobWorld.inbox.canceled).toEqual([]);
    });

    it('ignores a decline once the call was answered', async () => {
      const bobWorld = await joinClassroom(bob);
      const caller = await joinCall(ada, directTo(bob));
      await waitUntil(() => bobWorld.inbox.incoming.length > 0, 'ring');
      const callee = await joinCall(bob, directTo(ada));

      bobWorld.room.send(CALL_DECLINE_MESSAGE, { callerUserId: ada.userId });
      await sleep(150);

      expect(caller.seen.code).toBeUndefined();
      expect(callee.seen.code).toBeUndefined();
    });
  });

  describe('caller hangs up', () => {
    it('stops the ringing when the caller leaves before the peer answers', async () => {
      const bobWorld = await joinClassroom(bob);
      const caller = await joinCall(ada, directTo(bob));
      await waitUntil(() => bobWorld.inbox.incoming.length > 0, 'ring');

      await caller.room.leave();

      await waitUntil(() => bobWorld.inbox.canceled.length > 0, 'cancel');
      expect(bobWorld.inbox.canceled).toEqual([
        { callerUserId: ada.userId, reason: 'caller_left' },
      ]);
    });
  });
});
