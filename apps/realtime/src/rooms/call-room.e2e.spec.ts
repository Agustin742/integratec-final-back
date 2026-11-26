import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import {
  AVATAR_INPUT_MESSAGE,
  CALL_EMOTE_MESSAGE,
  CALL_END_MESSAGE,
  CALL_ENDED_EVENT,
  CALL_MODERATE_MESSAGE,
  CALL_ROOM_NAME,
  CALL_SELF_MESSAGE,
  CALL_SIGNAL_MESSAGE,
  CLOSE_CODE_ACCESS_REVOKED,
  CLASSROOM_ROOM_NAME,
  CLOSE_CODE_CALL_ENDED,
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
import type { ClassroomRoom } from './classroom-room';

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
    inWorld.clear();
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });
  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  /** Users with a classroom connection open: a direct call can only ring a peer that has one. */
  const inWorld = new Set<string>();
  const enterWorld = async (user: StubUser): Promise<void> => {
    if (inWorld.has(user.userId)) return;
    inWorld.add(user.userId);
    colyseus.sdk.auth.token = user.token;
    await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM });
  };
  const peers = [teacher, ada, bob, cara];

  const join = async (user: StubUser, options: unknown = classroomCall): Promise<SdkRoom> => {
    const direct = options as Partial<CallJoinOptions>;
    if (direct.kind === 'direct') {
      const peer = peers.find((candidate) => candidate.userId === direct.peerUserId);
      if (peer !== undefined) await enterWorld(peer);
    }
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
      student.send(CALL_EMOTE_MESSAGE, { emote: 'dance' });
      await waitUntil(() => me().emoteSeq === 3, 'third emote');
      expect(me().emote).toBe('dance');
      student.send(CALL_EMOTE_MESSAGE, { emote: 'raise-hand' });
      await waitUntil(() => me().emoteSeq === 4, 'fourth emote');
      expect(me().emote).toBe('raise-hand');
    });

    it('ignores unknown messages without side effects', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      student.send('call:unknown', { anything: 1 });
      await sleep(80);
      expect(serverRoom(host).state.participants.size).toBe(2);
    });
  });

  describe('moderation', () => {
    const moderate = (room: SdkRoom, message: object) => room.send(CALL_MODERATE_MESSAGE, message);

    it('lets a teacher mute everyone but moderators, and mute or unmute one student', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const other = await join(bob);
      const mine = () => participantOf(host, student)!;

      moderate(host, { action: 'mute-all' });
      await waitUntil(() => mine().forcedMuted && participantOf(host, other)!.forcedMuted, 'all');
      expect(participantOf(host, host)!.forcedMuted).toBe(false);

      moderate(host, { action: 'unmute', targetUserId: ada.userId });
      await waitUntil(() => !mine().forcedMuted, 'ada unmuted');
      expect(participantOf(host, other)!.forcedMuted).toBe(true);

      moderate(host, { action: 'mute', targetUserId: ada.userId });
      await waitUntil(() => mine().forcedMuted, 'ada muted');
    });

    it.each(['mute', 'mute-all'] as const)(
      'preserves %s through replacement and leave/rejoin while self unmute is forbidden',
      async (action) => {
        const host = await join(teacher);
        let student = await join(ada);
        moderate(host, { action: 'allow-self-unmute', value: false });
        moderate(host, action === 'mute' ? { action, targetUserId: ada.userId } : { action });
        await waitUntil(() => participantOf(host, student)!.forcedMuted, 'forced mute applied');

        student = await join(ada);
        expect(participantOf(host, student)!.forcedMuted).toBe(true);
        student.send(CALL_SELF_MESSAGE, { muted: false, speaking: true });
        await sleep(80);
        expect(participantOf(host, student)).toMatchObject({ forcedMuted: true, speaking: false });

        await student.leave();
        await waitUntil(() => serverRoom(host).state.participants.size === 1, 'student left');
        student = await join(ada);
        expect(participantOf(host, student)!.forcedMuted).toBe(true);
        student.send(CALL_SELF_MESSAGE, { muted: false, speaking: true });
        await sleep(80);
        expect(participantOf(host, student)).toMatchObject({ forcedMuted: true, speaking: false });
      },
    );

    it('applies mute-all to new arrivals and retains explicit unmute until another mute-all', async () => {
      const host = await join(teacher);
      moderate(host, { action: 'allow-self-unmute', value: false });
      moderate(host, { action: 'mute-all' });
      await waitUntil(() => !serverRoom(host).state.allowSelfUnmute, 'moderation processed');
      let student = await join(ada);
      expect(participantOf(host, student)!.forcedMuted).toBe(true);
      expect(participantOf(host, host)!.forcedMuted).toBe(false);
      moderate(host, { action: 'unmute', targetUserId: ada.userId });
      await waitUntil(() => !participantOf(host, student)!.forcedMuted, 'teacher unmuted');
      student = await join(ada);
      expect(participantOf(host, student)!.forcedMuted).toBe(false);
      moderate(host, { action: 'mute-all' });
      await waitUntil(() => participantOf(host, student)!.forcedMuted, 'mute-all reapplied');
      await student.leave();
      await waitUntil(() => serverRoom(host).state.participants.size === 1, 'student absent');
      moderate(host, { action: 'unmute', targetUserId: ada.userId });
      // The next command is an ordered acknowledgement that the absent-user unmute was processed.
      moderate(host, { action: 'focus-mode', value: true });
      await waitUntil(() => serverRoom(host).state.focusMode, 'commands processed');
      student = await join(ada);
      expect(participantOf(host, student)!.forcedMuted).toBe(false);
      const newcomer = await join(bob);
      expect(participantOf(host, newcomer)!.forcedMuted).toBe(true);
    });

    it('retains an allowed self-unmute across replacement and rejoin after mute-all', async () => {
      const host = await join(teacher);
      let student = await join(ada);
      moderate(host, { action: 'mute-all' });
      await waitUntil(() => participantOf(host, student)!.forcedMuted, 'muted');
      student.send(CALL_SELF_MESSAGE, { muted: false });
      await waitUntil(() => !participantOf(host, student)!.forcedMuted, 'self unmuted');
      moderate(host, { action: 'allow-self-unmute', value: false });
      await waitUntil(() => !serverRoom(host).state.allowSelfUnmute, 'permission changed');
      student = await join(ada);
      expect(participantOf(host, student)!.forcedMuted).toBe(false);
      await student.leave();
      await waitUntil(() => serverRoom(host).state.participants.size === 1, 'student left');
      student = await join(ada);
      expect(participantOf(host, student)!.forcedMuted).toBe(false);
    });

    it('silently ignores moderation sent by a student', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const other = await join(bob);

      moderate(student, { action: 'mute-all' });
      moderate(student, { action: 'mute', targetUserId: bob.userId });
      moderate(student, { action: 'focus-mode', value: true });
      moderate(student, { action: 'allow-self-unmute', value: false });
      student.send(CALL_END_MESSAGE, {});
      await sleep(120);

      expect(participantOf(host, other)!.forcedMuted).toBe(false);
      expect(serverRoom(host).state).toMatchObject({ focusMode: false, allowSelfUnmute: true });
      expect(serverRoom(host).state.participants.size).toBe(3);
    });

    it('holds a forced mute until self unmute is allowed, then a self unmute clears it', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const mine = () => participantOf(host, student)!;
      moderate(host, { action: 'allow-self-unmute', value: false });
      moderate(host, { action: 'mute-all' });
      await waitUntil(() => mine().forcedMuted && !serverRoom(host).state.allowSelfUnmute, 'set');
      student.send(CALL_SELF_MESSAGE, { muted: true });
      await waitUntil(() => mine().selfMuted, 'self muted');

      student.send(CALL_SELF_MESSAGE, { muted: false });
      await sleep(80);
      expect(mine()).toMatchObject({ selfMuted: true, forcedMuted: true });

      moderate(host, { action: 'allow-self-unmute', value: true });
      await waitUntil(() => serverRoom(host).state.allowSelfUnmute, 'allowed');
      student.send(CALL_SELF_MESSAGE, { muted: false });
      await waitUntil(() => !mine().selfMuted && !mine().forcedMuted, 'self unmuted');
    });

    it('rejects moderation in a direct call', async () => {
      const first = await join(teacher, directTo(ada));
      const second = await join(ada, directTo(teacher));

      moderate(first, { action: 'mute', targetUserId: ada.userId });
      moderate(first, { action: 'focus-mode', value: true });
      await sleep(120);

      expect(participantOf(first, second)!.forcedMuted).toBe(false);
      expect(serverRoom(first).state.focusMode).toBe(false);
    });
  });

  describe('ending a call', () => {
    const track = (room: SdkRoom) => {
      const seen: { code?: number; reason?: unknown } = {};
      room.onMessage(CALL_ENDED_EVENT, (payload) => (seen.reason = payload));
      room.onLeave((code) => (seen.code = code));
      return seen;
    };

    it('lets a teacher end the class call for everyone with code 4102', async () => {
      const host = await join(teacher);
      const student = await join(ada);
      const hostSeen = track(host);
      const studentSeen = track(student);

      host.send(CALL_END_MESSAGE, {});

      await waitUntil(() => studentSeen.code !== undefined && hostSeen.code !== undefined, 'ended');
      expect(studentSeen).toEqual({
        code: CLOSE_CODE_CALL_ENDED,
        reason: { reason: 'moderator_ended' },
      });
      expect(hostSeen.code).toBe(CLOSE_CODE_CALL_ENDED);
      // The room is gone, so a student cannot rejoin it.
      expect(await refusal(ada)).toMatchObject({ code: 403 });
    });

    it('ends a direct call for the other peer when one leaves', async () => {
      const first = await join(ada, directTo(bob));
      const second = await join(bob, directTo(ada));
      const seen = track(second);

      await first.leave();

      await waitUntil(() => seen.code !== undefined, 'peer notified');
      expect(seen).toEqual({ code: CLOSE_CODE_CALL_ENDED, reason: { reason: 'peer_left' } });
    });

    it('does not end a direct call when a peer reconnects over the old connection', async () => {
      const first = await join(ada, directTo(bob));
      const second = await join(bob, directTo(ada));
      const seen = track(second);

      await join(ada, directTo(bob));
      await sleep(150);

      expect(seen.code).toBeUndefined();
      expect(serverRoom(second).state.participants.size).toBe(2);
      expect(first.roomId).toBe(second.roomId);
    });
  });

  describe('classroom room integration', () => {
    const joinClassroom = async (user: StubUser): Promise<SdkRoom> => {
      colyseus.sdk.auth.token = user.token;
      return colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM });
    };
    const classroomOf = (room: SdkRoom): ClassroomRoom =>
      colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;

    it('flags the classroom while its call exists and resets focus when the call ends', async () => {
      const student = await joinClassroom(ada);
      const world = classroomOf(student);
      expect(world.state).toMatchObject({ classCallActive: false, focusMode: false });

      const host = await join(teacher);
      await waitUntil(() => world.state.classCallActive, 'call flagged');
      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: true });
      await waitUntil(() => world.state.focusMode, 'focus mirrored');
      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: false });
      await waitUntil(() => !world.state.focusMode, 'focus cleared');
      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: true });
      await waitUntil(() => world.state.focusMode, 'focus again');

      host.send(CALL_END_MESSAGE, {});

      await waitUntil(() => !world.state.classCallActive, 'call unflagged');
      expect(world.state.focusMode).toBe(false);
    });

    it('blocks student movement in focus mode but not the teacher, and resumes afterwards', async () => {
      const studentWorld = await joinClassroom(ada);
      const teacherWorld = await joinClassroom(teacher);
      const world = classroomOf(studentWorld);
      const adaAvatar = () => world.state.avatars.get(ada.userId)!;
      const teacherAvatar = () => world.state.avatars.get(teacher.userId)!;
      const host = await join(teacher);
      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: true });
      await waitUntil(() => world.state.focusMode, 'focus on');
      const adaStart = { x: adaAvatar().x, z: adaAvatar().z };
      const teacherStartZ = teacherAvatar().z;

      studentWorld.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
      teacherWorld.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });

      await waitUntil(() => teacherStartZ - teacherAvatar().z > 0.3, 'teacher moves');
      expect({ x: adaAvatar().x, z: adaAvatar().z }).toEqual(adaStart);
      teacherWorld.send(AVATAR_INPUT_MESSAGE, { x: 0, z: 0 });

      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: false });
      await waitUntil(() => !world.state.focusMode, 'focus off');
      studentWorld.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
      await waitUntil(() => adaStart.z - adaAvatar().z > 0.3, 'student moves again');
    });

    it('stops a student who was already walking when focus mode starts', async () => {
      const studentWorld = await joinClassroom(ada);
      const world = classroomOf(studentWorld);
      const host = await join(teacher);
      studentWorld.send(AVATAR_INPUT_MESSAGE, { x: 0, z: -1 });
      const startZ = world.state.avatars.get(ada.userId)!.z;
      await waitUntil(() => startZ - world.state.avatars.get(ada.userId)!.z > 0.2, 'walking');

      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: true });
      await waitUntil(() => world.state.focusMode, 'focus on');
      await sleep(100);
      const frozenZ = world.state.avatars.get(ada.userId)!.z;
      await sleep(200);

      expect(world.state.avatars.get(ada.userId)!.z).toBe(frozenZ);
    });

    it('clears focus mode when the last moderator leaves but keeps the call alive', async () => {
      const studentWorld = await joinClassroom(ada);
      const world = classroomOf(studentWorld);
      const host = await join(teacher);
      const student = await join(ada);
      host.send(CALL_MODERATE_MESSAGE, { action: 'focus-mode', value: true });
      await waitUntil(() => world.state.focusMode, 'focus on');

      await host.leave();

      await waitUntil(() => !world.state.focusMode, 'focus released');
      expect(world.state.classCallActive).toBe(true);
      expect(serverRoom(student).state.focusMode).toBe(false);
      expect(serverRoom(student).state.participants.size).toBe(1);
    });
  });
});
