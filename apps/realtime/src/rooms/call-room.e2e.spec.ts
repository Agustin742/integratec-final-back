import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  CALL_EMOTE_MESSAGE,
  CALL_ROOM_NAME,
  CALL_SELF_MESSAGE,
  CALL_SIGNAL_MESSAGE,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_CALL_FULL,
  CLOSE_REASON_CALL_NOT_STARTED,
  CLOSE_CODE_CALL_REPLACED,
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
import type { CallRoom } from './call-room';

const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const FOREIGN = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const PORT = 2579;
const MAX = 3;

describe('CallRoom (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const teacher = { ...makeUser('Tina', 1, [CLASSROOM]), role: 'TEACHER' as const };
  const ada = makeUser('Ada', 2, [CLASSROOM]);
  const bob = makeUser('Bob', 3, [CLASSROOM]);
  const cara = makeUser('Cara', 4, [CLASSROOM]);
  const outsider = makeUser('Out', 5, [FOREIGN]);
  const classroomCall: CallJoinOptions = { kind: 'classroom', classroomId: CLASSROOM };
  const directTo = (peer: StubUser): CallJoinOptions => ({
    kind: 'direct',
    classroomId: CLASSROOM,
    peerUserId: peer.userId,
  });

  beforeAll(async () => {
    api = await startStubApi([teacher, ada, bob, cara, outsider]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier, { callMaxParticipants: MAX }), PORT);
  });
  afterEach(async () => {
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  const join = async (user: StubUser, options: unknown = classroomCall): Promise<SdkRoom> => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CALL_ROOM_NAME, options as object);
    room.reconnection.enabled = false;
    return room;
  };
  const serverRoom = (room: SdkRoom): CallRoom =>
    colyseus.getRoomById(room.roomId) as unknown as CallRoom;
  const participantOf = (room: SdkRoom, who: SdkRoom) =>
    serverRoom(room).state.participants.get(who.sessionId);
  const refusal = (user: StubUser, options?: unknown) =>
    join(user, options).then(
      () => undefined,
      (e: unknown) => e,
    );

  describe('joining', () => {
    it('lets a teacher start the class call and a student join it', async () => {
      const host = await join(teacher);
      const student = await join(ada);

      expect(student.roomId).toBe(host.roomId);
      const { state } = serverRoom(host);
      expect(state).toMatchObject({
        kind: 'classroom',
        classroomId: CLASSROOM,
        hostUserId: teacher.userId,
        allowSelfUnmute: true,
      });
      expect(state.participants.size).toBe(2);
      expect(participantOf(host, student)).toMatchObject({
        userId: ada.userId,
        displayName: 'Ada',
        role: 'STUDENT',
        selfMuted: false,
        forcedMuted: false,
      });
      expect(participantOf(host, student)?.appearance).toMatchObject({
        bodyId: 'female',
        hairColor: '#AF6D63',
      });
      expect(participantOf(host, student)?.appearance.items.get('head')?.shopItemCode).toBe(
        'head_cap',
      );
    });

    it('refuses a student when nobody has started the class call', async () => {
      expect(await refusal(ada)).toMatchObject({
        code: 403,
        message: CLOSE_REASON_CALL_NOT_STARTED,
      });
    });

    it.each([
      ['a forged call key', { ...classroomCall, callKey: 'classroom:x' }],
      ['an unknown kind', { kind: 'broadcast', classroomId: CLASSROOM }],
      ['empty options', {}],
    ])('rejects %s', async (_label, options) => {
      expect(await refusal(teacher, options)).toBeDefined();
    });

    it('rejects a missing token, a foreign classroom and calling yourself', async () => {
      colyseus.sdk.auth.token = undefined as never;
      await expect(colyseus.sdk.joinOrCreate(CALL_ROOM_NAME, classroomCall)).rejects.toThrow();
      expect(await refusal(outsider)).toBeDefined();
      expect(await refusal(ada, directTo(ada))).toBeDefined();
    });

    it('rejects joinById into a call of another key', async () => {
      const host = await join(teacher);
      colyseus.sdk.auth.token = ada.token;
      await expect(colyseus.sdk.joinById(host.roomId, directTo(bob))).rejects.toThrow();
    });

    it('puts the two members of a direct call in one private room', async () => {
      const first = await join(ada, directTo(bob));
      const second = await join(bob, directTo(ada));
      expect(second.roomId).toBe(first.roomId);
      expect(serverRoom(first).state).toMatchObject({ kind: 'direct', hostUserId: ada.userId });

      const third = await join(cara, directTo(ada));
      expect(third.roomId).not.toBe(first.roomId);
      expect(serverRoom(first).state.participants.size).toBe(2);
    });

    it('refuses a join over the participant cap with the call-full code', async () => {
      await join(teacher);
      await join(ada);
      await join(bob);
      expect(await refusal(cara)).toMatchObject({ code: CLOSE_CODE_CALL_FULL });
    });

    it('replaces an older connection of the same user', async () => {
      const host = await join(teacher);
      const first = await join(ada);
      let closeCode: number | undefined;
      first.onLeave((code) => (closeCode = code));

      const second = await join(ada);

      await waitUntil(() => closeCode !== undefined, 'old connection closed');
      expect(closeCode).toBe(CLOSE_CODE_CALL_REPLACED);
      const { participants } = serverRoom(host).state;
      expect(participants.size).toBe(2);
      expect(participants.has(first.sessionId)).toBe(false);
      expect(participants.has(second.sessionId)).toBe(true);
    });

    it('removes a participant who leaves', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      await student.leave();
      await waitUntil(() => serverRoom(host).state.participants.size === 1, 'participant removed');
    });

    it('closes the connections of an evicted user', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      let closeCode: number | undefined;
      student.onLeave((code) => (closeCode = code));

      expect(serverRoom(host).evict({ userId: ada.userId })).toBe(1);

      await waitUntil(() => closeCode !== undefined, 'evicted');
      expect(closeCode).toBe(CLOSE_CODE_ACCESS_REVOKED);
      expect(serverRoom(host).state.participants.size).toBe(1);
    });
  });

  describe('signaling relay', () => {
    const offer = { type: 'offer', sdp: 'v=0' } as const;

    it('relays only to a participant of the same room, stamped with the sender', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const stranger = await join(cara, directTo(bob)); // another room entirely
      const received: unknown[] = [];
      const leaked: unknown[] = [];
      host.onMessage(CALL_SIGNAL_MESSAGE, (m) => received.push(m));
      stranger.onMessage(CALL_SIGNAL_MESSAGE, (m) => leaked.push(m));
      student.onMessage(CALL_SIGNAL_MESSAGE, (m) => leaked.push(m));

      student.send(CALL_SIGNAL_MESSAGE, { to: host.sessionId, payload: offer });
      student.send(CALL_SIGNAL_MESSAGE, { to: stranger.sessionId, payload: offer });
      student.send(CALL_SIGNAL_MESSAGE, { to: 'nobody', payload: offer });
      student.send(CALL_SIGNAL_MESSAGE, { to: student.sessionId, payload: offer });

      await waitUntil(() => received.length === 1, 'relay delivered');
      await sleep(100);
      expect(received).toEqual([{ from: student.sessionId, payload: offer }]);
      expect(leaked).toEqual([]);
    });

    it('relays ICE candidates as browsers serialise them', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const received: unknown[] = [];
      host.onMessage(CALL_SIGNAL_MESSAGE, (m) => received.push(m));
      const payload = {
        type: 'ice',
        candidate: {
          candidate: 'candidate:1',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: 'u',
        },
      };

      student.send(CALL_SIGNAL_MESSAGE, { to: host.sessionId, payload });

      await waitUntil(() => received.length === 1, 'ice delivered');
      expect(received[0]).toEqual({ from: student.sessionId, payload });
    });

    it('absorbs an ICE burst but drops a flood beyond the signaling limit', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      let count = 0;
      host.onMessage(CALL_SIGNAL_MESSAGE, () => (count += 1));
      const payload = { type: 'ice', candidate: { candidate: 'c' } };

      for (let i = 0; i < 400; i += 1) {
        student.send(CALL_SIGNAL_MESSAGE, { to: host.sessionId, payload });
      }

      await sleep(500);
      expect(count).toBeGreaterThan(50);
      expect(count).toBeLessThan(250);
    });
  });

  describe('participant state', () => {
    it('applies self mute and speaking, and ignores speaking while muted', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const me = () => participantOf(host, student);

      student.send(CALL_SELF_MESSAGE, { speaking: true });
      await waitUntil(() => me()?.speaking === true, 'speaking');
      student.send(CALL_SELF_MESSAGE, { muted: true });
      await waitUntil(() => me()?.selfMuted === true, 'muted');
      expect(me()?.speaking).toBe(false);
      student.send(CALL_SELF_MESSAGE, { speaking: true });
      await sleep(80);
      expect(me()?.speaking).toBe(false);
    });

    it('ignores a self unmute while a forced mute forbids it, and honours it once allowed', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const room = serverRoom(host);
      const me = () => participantOf(host, student)!;
      me().forcedMuted = true;
      me().selfMuted = true;
      room.state.allowSelfUnmute = false;

      student.send(CALL_SELF_MESSAGE, { muted: false });
      await sleep(80);
      expect(me().selfMuted).toBe(true);

      room.state.allowSelfUnmute = true;
      student.send(CALL_SELF_MESSAGE, { muted: false });
      await waitUntil(() => !me().selfMuted, 'unmuted');
    });

    it('sets the emote and bumps its sequence even when repeated', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const me = () => participantOf(host, student)!;

      student.send(CALL_EMOTE_MESSAGE, { emote: 'wave' });
      await waitUntil(() => me().emoteSeq === 1, 'first emote');
      student.send(CALL_EMOTE_MESSAGE, { emote: 'wave' });
      await waitUntil(() => me().emoteSeq === 2, 'second emote');
      expect(me().emote).toBe('wave');
    });

    it('ignores unknown messages without side effects', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      student.send('call:unknown', { anything: 1 });
      await sleep(80);
      expect(serverRoom(host).state.participants.size).toBe(2);
    });
  });
});
