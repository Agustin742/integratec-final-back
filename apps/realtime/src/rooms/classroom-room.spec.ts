import { describe, it, expect, vi } from 'vitest';
import { ClientState, CloseCode, ServerError } from '@colyseus/core';
import {
  buildClassroomLayout,
  deriveNpcHomes,
  NPC_IDS,
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_ACCESS_REVOKED,
  CLOSE_REASON_VERIFICATION_UNAVAILABLE,
  NPC_INTERACT_COOLDOWN_MS,
  NPC_INTERACT_MAX_DISTANCE,
  TUTOR_BOT_PHRASES,
} from '@aula/contracts';
import { createClassroomRoom, type ClassroomRoom } from './classroom-room';
import {
  JoinDeniedError,
  JoinVerificationUnavailableError,
  type JoinVerifier,
} from '../join/join-verifier';
import { Avatar } from './classroom-state';
import { isWalkable } from '../movement/step-avatar';
import { makeStubAppearance } from '../testing/stub-api';

const CLASSROOM_ID = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const APPEARANCE = makeStubAppearance();
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  classroomId: CLASSROOM_ID,
  role: 'TEACHER' as const,
  displayName: 'Ada Lovelace',
  appearanceRevision: 1,
  appearance: APPEARANCE,
  deskCount: 12,
  tutorBotSkin: 'none' as const,
  tutorBotSkinRevision: 0,
};
const AUTH = {
  userId: IDENTITY.userId,
  authSessionId: IDENTITY.sessionId,
  classroomId: CLASSROOM_ID,
  role: IDENTITY.role,
  displayName: IDENTITY.displayName,
  appearanceRevision: IDENTITY.appearanceRevision,
  appearance: APPEARANCE,
  deskCount: IDENTITY.deskCount,
  tutorBotSkin: IDENTITY.tutorBotSkin,
  tutorBotSkinRevision: IDENTITY.tutorBotSkinRevision,
};

describe('createClassroomRoom', () => {
  it('exposes a static onAuth that Colyseus can call detached from the class', async () => {
    const verifier: JoinVerifier = {
      verify: vi.fn().mockResolvedValue(IDENTITY),
      reverify: vi.fn().mockResolvedValue(IDENTITY),
    };
    const RoomClass = createClassroomRoom(verifier);
    const { onAuth } = RoomClass; // MatchMaker invokes it without `this`
    const context = { token: 'token-1' } as never;

    await expect(onAuth('token-1', { classroomId: CLASSROOM_ID }, context)).resolves.toEqual(AUTH);
    expect(verifier.verify).toHaveBeenCalledExactlyOnceWith('token-1', CLASSROOM_ID);
  });

  /** A room that has run `onCreate`, with the real-time loop replaced so no timer leaks. */
  const makeCreatedRoom = () => {
    const room = new (createClassroomRoom({
      verify: vi.fn(),
      reverify: vi.fn().mockResolvedValue(IDENTITY),
    }))();
    const setFixedTimestep = vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
    room.onCreate({ classroomId: CLASSROOM_ID });
    return { room, setFixedTimestep };
  };
  const makeJoinedRoom = () => makeCreatedRoom().room;

  it('rejects a join whose verified classroom differs from the room classroom', async () => {
    const room = makeJoinedRoom();
    const client = {
      sessionId: 's1',
      auth: { ...AUTH, classroomId: '11111111-1111-4111-8111-111111111111' },
    };

    await expect(room.onJoin(client as never)).rejects.toThrow(ServerError);
    expect(room.state.avatars.size).toBe(0);
  });

  it('admits a join whose verified classroom equals the room classroom', async () => {
    const room = makeJoinedRoom();

    await expect(room.onJoin({ sessionId: 's1', auth: AUTH } as never)).resolves.toBeUndefined();
    expect(room.state.avatars.get(IDENTITY.userId)).toMatchObject({
      displayName: 'Ada Lovelace',
      role: 'TEACHER',
      status: 'online',
    });
  });

  it('adds the verified appearance to the avatar at the first connection (#114)', async () => {
    const room = makeJoinedRoom();

    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);

    const avatar = room.state.avatars.get(IDENTITY.userId);
    expect(avatar?.appearance).toMatchObject(APPEARANCE.baseAvatar);
    expect(avatar?.appearance.items.size).toBe(1);
    expect(avatar?.appearance.items.get('head')).toMatchObject(APPEARANCE.items.head);
    expect(avatar?.appearance.items.has('face')).toBe(false);
  });

  it('ignores a delayed older appearance snapshot after a newer update (#114)', async () => {
    const room = makeJoinedRoom();
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    expect(room.state.avatars.get(IDENTITY.userId)?.appearance.hairColor).toBe('#AF6D63');

    const newest = makeStubAppearance('#C77DAA');
    expect(room.applyAppearance(IDENTITY.userId, 3, newest)).toBe(true);
    expect(room.applyAppearance(IDENTITY.userId, 2, APPEARANCE)).toBe(true);

    const avatar = room.state.avatars.get(IDENTITY.userId);
    expect(avatar?.appearance.hairColor).toBe('#C77DAA');
    expect(avatar?.appearance.items.size).toBe(1);
    expect(avatar?.appearance.items.get('head')).toMatchObject(newest.items.head);
  });

  it('reports that there was no avatar to update, changing nothing (#114)', async () => {
    const room = makeJoinedRoom();

    expect(room.applyAppearance(IDENTITY.userId, 2, APPEARANCE)).toBe(false);
    expect(room.state.avatars.size).toBe(0);
  });

  it('rejects a join with no verified identity', async () => {
    const room = makeJoinedRoom();

    await expect(room.onJoin({ sessionId: 's1' } as never)).rejects.toThrow(ServerError);
    expect(room.state.avatars.size).toBe(0);
  });

  describe('onDispose', () => {
    const makeTimedRoom = (nowMs: { value: number }) => {
      const reporter = { report: vi.fn().mockResolvedValue(undefined) };
      const room = new (createClassroomRoom(
        { verify: vi.fn(), reverify: vi.fn().mockResolvedValue(IDENTITY) },
        { now: () => nowMs.value, reporter },
      ))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      return { room, reporter };
    };

    it('reports the connected time of whoever is still present', async () => {
      const clock = { value: 1_000_000 };
      const { room, reporter } = makeTimedRoom(clock);
      await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
      clock.value += 42_000;

      await room.onDispose();

      expect(reporter.report).toHaveBeenCalledExactlyOnceWith({
        userId: AUTH.userId,
        classroomId: CLASSROOM_ID,
        connectedSeconds: 42,
        endedAt: new Date(clock.value).toISOString(),
      });
    });

    it('reports nobody twice: a user who already left is not reported again', async () => {
      const clock = { value: 1_000_000 };
      const { room, reporter } = makeTimedRoom(clock);
      const client = { sessionId: 's1', auth: AUTH } as never;
      await room.onJoin(client);
      clock.value += 10_000;
      room.onLeave(client);

      await room.onDispose();

      expect(reporter.report).toHaveBeenCalledTimes(1);
    });

    it('never reports more seconds than the API accepts in one report', async () => {
      const clock = { value: 1_000_000 };
      const { room, reporter } = makeTimedRoom(clock);
      await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
      clock.value += 8 * 24 * 3600 * 1000;

      await room.onDispose();

      expect(reporter.report).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ connectedSeconds: 7 * 24 * 3600 }),
      );
    });

    it('waits for a report that is still being delivered', async () => {
      const clock = { value: 1_000_000 };
      let finish: () => void = () => undefined;
      const reporter = {
        report: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
      };
      const room = new (createClassroomRoom(
        { verify: vi.fn(), reverify: vi.fn().mockResolvedValue(IDENTITY) },
        { now: () => clock.value, reporter },
      ))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
      clock.value += 5_000;

      let disposed = false;
      const disposing = room.onDispose().then(() => (disposed = true));
      await Promise.resolve();
      expect(disposed).toBe(false);

      finish();
      await disposing;
      expect(disposed).toBe(true);
    });
  });

  const makeCreatedRoomWithoutCreate = () =>
    new (createClassroomRoom({ verify: vi.fn(), reverify: vi.fn().mockResolvedValue(IDENTITY) }))();

  describe('a second connection while another is held', () => {
    it('shows the avatar as online with the current identity instead of staying reconnecting', async () => {
      const reverify = vi
        .fn()
        .mockResolvedValueOnce(IDENTITY)
        .mockResolvedValue({ ...IDENTITY, role: 'STUDENT', displayName: 'Ada L.' });
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const first = { sessionId: 's1', auth: { ...AUTH } };
      await room.onJoin(first as never);
      room.onDrop(first as never); // for example a page refresh
      expect(room.state.avatars.get(IDENTITY.userId)?.status).toBe('reconnecting');

      await room.onJoin({ sessionId: 's2', auth: { ...AUTH } } as never);

      expect(room.state.avatars.get(IDENTITY.userId)).toMatchObject({
        status: 'online',
        role: 'STUDENT',
        displayName: 'Ada L.',
      });
      expect(room.state.avatars.size).toBe(1);
    });

    it("refreshes the appearance from the later connection's answer (#114)", async () => {
      const reverify = vi
        .fn()
        .mockResolvedValueOnce(IDENTITY)
        .mockResolvedValue({
          ...IDENTITY,
          appearanceRevision: 2,
          appearance: makeStubAppearance('#C77DAA'),
        });
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const first = { sessionId: 's1', auth: { ...AUTH } };
      await room.onJoin(first as never);
      room.onDrop(first as never);
      expect(room.state.avatars.get(IDENTITY.userId)?.appearance.hairColor).toBe('#AF6D63');

      await room.onJoin({ sessionId: 's2', auth: { ...AUTH } } as never);

      const avatar = room.state.avatars.get(IDENTITY.userId);
      expect(avatar?.appearance.hairColor).toBe('#C77DAA');
      expect(avatar?.appearance.items.size).toBe(1);
      expect(avatar?.appearance.items.get('head')).toMatchObject(APPEARANCE.items.head);
    });

    it('keeps a newer event received while the join snapshot is being verified', async () => {
      let resolveReverify!: (identity: typeof IDENTITY) => void;
      const reverify = vi.fn(
        () =>
          new Promise<typeof IDENTITY>((resolve) => {
            resolveReverify = resolve;
          }),
      );
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const joining = room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);

      const latest = makeStubAppearance('#C77DAA');
      expect(room.applyAppearance(IDENTITY.userId, 2, latest)).toBe(true);
      resolveReverify(IDENTITY);
      await joining;

      const avatar = room.state.avatars.get(IDENTITY.userId);
      expect(avatar?.appearanceRevision).toBe(2);
      expect(avatar?.appearance.hairColor).toBe('#C77DAA');
    });
  });

  describe('session-specific eviction of held reconnections', () => {
    it('rejects the held reconnection of the evicted session only and keeps the other session', async () => {
      const room = new (createClassroomRoom({
        verify: vi.fn(),
        reverify: vi.fn().mockResolvedValue(IDENTITY),
      }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      const holds = new Map<string, { reject: ReturnType<typeof vi.fn>; catch: () => void }>();
      vi.spyOn(room, 'allowReconnection').mockImplementation(((client: { sessionId: string }) => {
        const hold = { reject: vi.fn(), catch: () => undefined };
        holds.set(client.sessionId, hold);
        return hold;
      }) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const other = { sessionId: 's1', auth: { ...AUTH, authSessionId: 'session-a' } };
      const revoked = { sessionId: 's2', auth: { ...AUTH, authSessionId: 'session-b' } };
      await room.onJoin(other as never);
      await room.onJoin(revoked as never);
      room.onDrop(other as never);
      room.onDrop(revoked as never);

      const evicted = room.evict({ userId: IDENTITY.userId, sessionId: 'session-b' });

      expect(evicted).toBe(1);
      expect(holds.get('s2')?.reject).toHaveBeenCalledWith(false);
      expect(holds.get('s1')?.reject).not.toHaveBeenCalled();
      expect(room.state.avatars.has(IDENTITY.userId)).toBe(true);
    });
  });

  describe('onCreate', () => {
    const makeRoom = () => makeCreatedRoomWithoutCreate();

    it.each([
      ['missing options', undefined],
      ['missing classroomId', {}],
      ['non-UUID classroomId', { classroomId: 'not-a-uuid' }],
      ['non-string classroomId', { classroomId: 42 }],
    ])('rejects %s', (_label, options) => {
      expect(() => makeRoom().onCreate(options)).toThrow(ServerError);
    });

    it('binds the room to a valid classroomId and mirrors it in the state', () => {
      const { room } = makeCreatedRoom();

      expect(room.classroomId).toBe(CLASSROOM_ID);
      expect(room.state.classroomId).toBe(CLASSROOM_ID);
    });

    it('seeds the pet and the tutor bot idle at their homes (#147)', () => {
      const { room } = makeCreatedRoom();
      const homes = deriveNpcHomes(buildClassroomLayout(12));

      expect([...room.state.npcs.keys()].sort()).toEqual([...NPC_IDS].sort());
      for (const id of NPC_IDS) {
        expect(room.state.npcs.get(id)).toMatchObject({
          id,
          x: homes[id].x,
          z: homes[id].z,
          rotation: homes[id].rotation,
          state: 'idle',
          emote: '',
          reaction: '',
          phraseId: -1,
          reactionSeq: 0,
          reactingSessionId: '',
        });
      }
    });

    it('broadcasts only the two server-owned chat notification events', () => {
      const { room } = makeCreatedRoom();
      const broadcast = vi.spyOn(room, 'broadcast');
      const message = {
        id: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
        classroomId: CLASSROOM_ID,
        authorId: IDENTITY.userId,
        body: 'Persisted message',
        mentionedUserIds: [],
        createdAt: '2026-11-19T12:00:00.000Z',
      };
      const hidden = {
        messageId: message.id,
        hiddenAt: '2026-11-19T12:01:00.000Z',
      };

      room.broadcastChatMessage(message);
      room.broadcastChatMessageHidden(hidden);

      expect(broadcast).toHaveBeenNthCalledWith(1, CHAT_MESSAGE_EVENT, message);
      expect(broadcast).toHaveBeenNthCalledWith(2, CHAT_MESSAGE_HIDDEN_EVENT, hidden);
    });

    it('runs a fixed 20 Hz simulation and patches state at 20 Hz', () => {
      const { room, setFixedTimestep } = makeCreatedRoom();

      expect(setFixedTimestep).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 20);
      expect(room.patchRate).toBe(50);
    });
  });

  describe('reconnection', () => {
    interface FakeClient {
      sessionId: string;
      auth: typeof AUTH;
      leave: ReturnType<typeof vi.fn>;
    }

    const makeReconnectingRoom = async (reverify: JoinVerifier['reverify']) => {
      // The first check is the join itself and passes; `reverify` answers the reconnection.
      const joinThenReconnect = vi
        .fn()
        .mockResolvedValueOnce(IDENTITY)
        .mockImplementation(reverify);
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify: joinThenReconnect }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      // The unit test has no real transport: a resolved promise stands in for the pending hold.
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const client: FakeClient = { sessionId: 's1', auth: { ...AUTH }, leave: vi.fn() };
      await room.onJoin(client as never);
      room.onDrop(client as never);
      return { room, client };
    };
    const sendInput = (room: ClassroomRoom, client: FakeClient, x: number, z: number): void =>
      (
        room as unknown as { onAvatarInput(c: FakeClient, i: { x: number; z: number }): void }
      ).onAvatarInput(client, { x, z });
    const positionAfterStep = (room: ClassroomRoom): number => {
      room.tick(0.5);
      return room.state.avatars.get(IDENTITY.userId)?.x ?? Number.NaN;
    };

    it('ignores input from a connection until its access is confirmed', async () => {
      let confirm: (identity: typeof IDENTITY) => void = () => undefined;
      const { room, client } = await makeReconnectingRoom(
        () => new Promise((resolve) => (confirm = resolve)),
      );
      const spawnX = room.state.avatars.get(IDENTITY.userId)?.x;

      const reconnecting = room.onReconnect(client as never);
      sendInput(room, client, 1, 0);
      expect(positionAfterStep(room)).toBe(spawnX);

      confirm(IDENTITY);
      await reconnecting;
      sendInput(room, client, 1, 0);
      expect(positionAfterStep(room)).toBeGreaterThan(spawnX ?? 0);
    });

    it('does not overwrite a newer appearance received during reconnection verification', async () => {
      let confirm: (identity: typeof IDENTITY) => void = () => undefined;
      const { room, client } = await makeReconnectingRoom(
        () => new Promise((resolve) => (confirm = resolve)),
      );
      const latest = makeStubAppearance('#C77DAA');

      const reconnecting = room.onReconnect(client as never);
      expect(room.applyAppearance(IDENTITY.userId, 2, latest)).toBe(true);
      confirm(IDENTITY);
      await reconnecting;

      const avatar = room.state.avatars.get(IDENTITY.userId);
      expect(avatar?.appearanceRevision).toBe(2);
      expect(avatar?.appearance.hairColor).toBe('#C77DAA');
    });

    it('releases the connection and its avatar when access is denied, without relying on the transport', async () => {
      const { room, client } = await makeReconnectingRoom(() =>
        Promise.reject(new JoinDeniedError()),
      );

      await room.onReconnect(client as never);
      sendInput(room, client, 1, 0);
      room.tick(0.5);

      expect(room.state.avatars.has(IDENTITY.userId)).toBe(false);
    });

    it('releases the connection when verification is unavailable too', async () => {
      const { room, client } = await makeReconnectingRoom(() =>
        Promise.reject(new JoinVerificationUnavailableError()),
      );

      await room.onReconnect(client as never);

      expect(room.state.avatars.has(IDENTITY.userId)).toBe(false);
    });

    describe('a connection released while access is being re-verified', () => {
      const makeTimedReconnectingRoom = async () => {
        const clock = { value: 1_000_000 };
        const reporter = { report: vi.fn().mockResolvedValue(undefined) };
        let settle: { resolve(i: typeof IDENTITY): void; reject(e: Error): void } = {
          resolve: () => undefined,
          reject: () => undefined,
        };
        let joined = false;
        const reverify = () => {
          if (!joined) {
            joined = true; // the join itself
            return Promise.resolve(IDENTITY);
          }
          return new Promise<typeof IDENTITY>((resolve, reject) => (settle = { resolve, reject }));
        };
        const room = new (createClassroomRoom(
          { verify: vi.fn(), reverify },
          { now: () => clock.value, reporter },
        ))();
        vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
        vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
        room.onCreate({ classroomId: CLASSROOM_ID });
        const client: FakeClient = { sessionId: 's1', auth: { ...AUTH }, leave: vi.fn() };
        await room.onJoin(client as never);
        clock.value += 30_000;
        room.onDrop(client as never);
        return { room, client, reporter, settle: () => settle };
      };

      it('reports the connected time once and does not close the socket again when it already left', async () => {
        const { room, client, reporter, settle } = await makeTimedReconnectingRoom();
        const reconnecting = room.onReconnect(client as never);

        room.onLeave(client as never); // the socket closed while the API was answering
        settle().reject(new JoinDeniedError());
        await reconnecting;
        await room.onDispose();

        expect(reporter.report).toHaveBeenCalledTimes(1);
        expect(client.leave).not.toHaveBeenCalled();
        expect(room.state.avatars.has(IDENTITY.userId)).toBe(false);
      });

      it('lets an eviction close the socket and does not close it a second time', async () => {
        const { room, client, reporter, settle } = await makeTimedReconnectingRoom();
        vi.spyOn(room.clients, 'getById').mockReturnValue(client as never);
        const reconnecting = room.onReconnect(client as never);

        room.evict({ userId: IDENTITY.userId });
        settle().resolve(IDENTITY);
        await reconnecting;
        await room.onDispose();

        expect(client.leave).toHaveBeenCalledExactlyOnceWith(
          CLOSE_CODE_ACCESS_REVOKED,
          CLOSE_REASON_ACCESS_REVOKED,
        );
        expect(reporter.report).toHaveBeenCalledTimes(1);
      });
    });

    it('closes a denied reconnection as revoked access', async () => {
      const { room, client } = await makeReconnectingRoom(() =>
        Promise.reject(new JoinDeniedError()),
      );

      await room.onReconnect(client as never);

      expect(client.leave).toHaveBeenCalledExactlyOnceWith(
        CLOSE_CODE_ACCESS_REVOKED,
        CLOSE_REASON_ACCESS_REVOKED,
      );
    });

    it('closes an unverifiable reconnection with the retryable code, not as revoked access', async () => {
      const { room, client } = await makeReconnectingRoom(() =>
        Promise.reject(new JoinVerificationUnavailableError()),
      );

      await room.onReconnect(client as never);

      expect(client.leave).toHaveBeenCalledExactlyOnceWith(
        CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      );
    });

    it('treats an unexpected verifier failure as unavailable and fails closed', async () => {
      const { room, client } = await makeReconnectingRoom(() => Promise.reject(new Error('boom')));

      await room.onReconnect(client as never);

      expect(client.leave).toHaveBeenCalledExactlyOnceWith(
        CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      );
    });
  });
  describe('per-room layout from the desk count (#79)', () => {
    const LAYOUT_12 = buildClassroomLayout(12);
    const LAYOUT_13 = buildClassroomLayout(13);
    // Walkable in the 12-desk room, inside desk 13 of the 13-desk room.
    const BLOCKED_BY_DESK_13 = { x: -4.5, z: 5 };

    const makeRoomWith = (identity: typeof IDENTITY) => {
      const room = new (createClassroomRoom({
        verify: vi.fn(),
        reverify: vi.fn().mockResolvedValue(identity),
      }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      return room;
    };
    const addAvatarAt = (room: ClassroomRoom, userId: string, x: number, z: number) => {
      const avatar = new Avatar();
      avatar.userId = userId;
      avatar.x = x;
      avatar.z = z;
      room.state.avatars.set(userId, avatar);
      return avatar;
    };

    it('syncs the desk count of the verified classroom', async () => {
      const room12 = makeRoomWith(IDENTITY);
      const room13 = makeRoomWith({ ...IDENTITY, deskCount: 13 });

      await room12.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);
      await room13.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);

      expect(room12.state.deskCount).toBe(12);
      expect(room13.state.deskCount).toBe(13);
    });

    it('spawns a newcomer of a 13-desk room on a walkable point of that layout', async () => {
      const room = makeRoomWith({ ...IDENTITY, deskCount: 13 });

      await room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);

      const avatar = room.state.avatars.get(IDENTITY.userId);
      expect(isWalkable(LAYOUT_13, avatar?.x ?? Number.NaN, avatar?.z ?? Number.NaN)).toBe(true);
      expect(avatar?.z).toBeGreaterThan(LAYOUT_12.bounds.maxZ);
    });

    it('relocates avatars left inside the new desk to free walkable spawn points', () => {
      const room = makeJoinedRoom();
      expect(isWalkable(LAYOUT_12, BLOCKED_BY_DESK_13.x, BLOCKED_BY_DESK_13.z)).toBe(true);
      expect(isWalkable(LAYOUT_13, BLOCKED_BY_DESK_13.x, BLOCKED_BY_DESK_13.z)).toBe(false);
      const stuckA = addAvatarAt(room, 'a', BLOCKED_BY_DESK_13.x, BLOCKED_BY_DESK_13.z);
      const stuckB = addAvatarAt(room, 'b', BLOCKED_BY_DESK_13.x, BLOCKED_BY_DESK_13.z);
      const fine = addAvatarAt(room, 'c', 0, 0);

      room.applyDeskCount(13);

      expect(room.state.deskCount).toBe(13);
      for (const moved of [stuckA, stuckB]) {
        expect(isWalkable(LAYOUT_13, moved.x, moved.z)).toBe(true);
      }
      expect(Math.hypot(stuckA.x - stuckB.x, stuckA.z - stuckB.z)).toBeGreaterThanOrEqual(
        LAYOUT_13.avatarRadius * 2,
      );
      expect({ x: fine.x, z: fine.z }).toEqual({ x: 0, z: 0 });
    });

    it('moves idle npcs resting at their old home to the new home (#147)', () => {
      const room = makeJoinedRoom();
      const next = deriveNpcHomes(LAYOUT_13);

      room.applyDeskCount(13);

      for (const id of NPC_IDS) {
        expect(room.state.npcs.get(id)).toMatchObject({
          x: next[id].x,
          z: next[id].z,
        });
      }
    });

    it('leaves an npc that is away from its home where it is (#147)', () => {
      const room = makeJoinedRoom();
      const pet = room.state.npcs.get('pet');
      if (!pet) throw new Error('pet missing');
      pet.state = 'walking';
      pet.x = 2;
      pet.z = 1;

      room.applyDeskCount(13);

      expect({ x: pet.x, z: pet.z }).toEqual({ x: 2, z: 1 });
    });

    it('does not move an avatar that stays on a walkable point', () => {
      const room = makeJoinedRoom();
      const avatar = addAvatarAt(room, 'a', 3, 1);

      room.applyDeskCount(13);

      expect({ x: avatar.x, z: avatar.z }).toEqual({ x: 3, z: 1 });
    });

    it('is a no-op when the effective desk count is unchanged', () => {
      const room = makeJoinedRoom();
      room.applyDeskCount(13);
      const stuck = addAvatarAt(room, 'a', BLOCKED_BY_DESK_13.x, BLOCKED_BY_DESK_13.z);

      room.applyDeskCount(13);

      expect(room.state.deskCount).toBe(13);
      // Nothing changed, so nothing relocates the avatar standing in the new desk.
      expect({ x: stuck.x, z: stuck.z }).toEqual(BLOCKED_BY_DESK_13);
    });

    it('leaves avatars alone when the raw input differs but the layout does not', () => {
      const room = makeJoinedRoom();
      const stuck = addAvatarAt(room, 'a', BLOCKED_BY_DESK_13.x, BLOCKED_BY_DESK_13.z);

      room.applyDeskCount(5); // clamps to 12: same layout
      room.applyDeskCount(Number.NaN);

      expect(room.state.deskCount).toBe(12);
      expect({ x: stuck.x, z: stuck.z }).toEqual(BLOCKED_BY_DESK_13);
    });

    it('never shrinks the layout: a smaller count can only be stale (desks are never deleted)', () => {
      const room = makeJoinedRoom();
      room.applyDeskCount(17);
      const avatar = addAvatarAt(room, 'a', 3, 1);

      room.applyDeskCount(13); // e.g. a reverify answered before the expansion, arriving late
      room.applyDeskCount(12.9);
      room.applyDeskCount(Number.NaN);
      room.applyDeskCount(3);

      expect(room.state.deskCount).toBe(17);
      expect({ x: avatar.x, z: avatar.z }).toEqual({ x: 3, z: 1 });
    });

    it('still grows after ignoring a smaller count', () => {
      const room = makeJoinedRoom();
      room.applyDeskCount(17);
      room.applyDeskCount(13);

      room.applyDeskCount(18);

      expect(room.state.deskCount).toBe(18);
    });

    it('takes the desk count from the access check made at admission', async () => {
      // The seat was reserved when the classroom had 12 desks; the check at admission sees 13.
      const room = makeRoomWith({ ...IDENTITY, deskCount: 13 });
      const auth = { ...AUTH, deskCount: 12 };

      await room.onJoin({ sessionId: 's1', auth } as never);

      expect(room.state.deskCount).toBe(13);
      expect(auth.deskCount).toBe(13);
    });

    it('rebuilds the layout when a reconnection is verified with another desk count', async () => {
      const joinThenReconnect = vi
        .fn()
        .mockResolvedValueOnce(IDENTITY)
        .mockResolvedValue({ ...IDENTITY, deskCount: 13 });
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify: joinThenReconnect }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const client = { sessionId: 's1', auth: { ...AUTH }, leave: vi.fn() };
      await room.onJoin(client as never);
      expect(room.state.deskCount).toBe(12);
      const avatar = room.state.avatars.get(IDENTITY.userId);
      if (!avatar) throw new Error('avatar missing');
      avatar.x = BLOCKED_BY_DESK_13.x;
      avatar.z = BLOCKED_BY_DESK_13.z;
      room.onDrop(client as never);

      await room.onReconnect(client as never);

      expect(room.state.deskCount).toBe(13);
      expect(client.auth.deskCount).toBe(13);
      expect(isWalkable(LAYOUT_13, avatar.x, avatar.z)).toBe(true);
    });
  });

  describe('tutor bot skin of the classroom (#154)', () => {
    const makeRoomWith = (reverify: JoinVerifier['reverify']) => {
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      return room;
    };
    const BOCA = { ...IDENTITY, tutorBotSkin: 'boca' as const, tutorBotSkinRevision: 2 };

    it('syncs the skin of the verified classroom to a new room', async () => {
      const room = makeRoomWith(vi.fn().mockResolvedValue(BOCA));

      await room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);

      expect(room.state.tutorBotSkin).toBe('boca');
    });

    it('applies a pushed change, including back to no skin', () => {
      const room = makeJoinedRoom();

      room.applyTutorBotSkin('gamer', 1);
      expect(room.state.tutorBotSkin).toBe('gamer');

      room.applyTutorBotSkin('none', 2);
      expect(room.state.tutorBotSkin).toBe('none');
    });

    it('ignores an older revision, such as a late delivery or re-verification', async () => {
      const room = makeRoomWith(vi.fn().mockResolvedValue(BOCA));
      room.applyTutorBotSkin('gamer', 3);

      await room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);
      room.applyTutorBotSkin('folklore', 1);

      expect(room.state.tutorBotSkin).toBe('gamer');
    });

    it('refreshes the skin when a reconnection is verified', async () => {
      const reverify = vi.fn().mockResolvedValueOnce(IDENTITY).mockResolvedValue(BOCA);
      const room = makeRoomWith(reverify);
      const client = { sessionId: 's1', auth: { ...AUTH }, leave: vi.fn() };
      await room.onJoin(client as never);
      expect(room.state.tutorBotSkin).toBe('none');
      room.onDrop(client as never);

      await room.onReconnect(client as never);

      expect(room.state.tutorBotSkin).toBe('boca');
      expect(client.auth.tutorBotSkin).toBe('boca');
    });
  });

  describe('admission re-verification (a seat reservation outlives access)', () => {
    const makeAdmissionRoom = (reverify: JoinVerifier['reverify']) => {
      const clock = { value: 1_000_000 };
      const reporter = { report: vi.fn().mockResolvedValue(undefined) };
      const room = new (createClassroomRoom(
        { verify: vi.fn(), reverify },
        { now: () => clock.value, reporter },
      ))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      return { room, reporter, clock };
    };
    const hold = () => {
      let settle: { resolve(i: typeof IDENTITY): void; reject(e: Error): void } = {
        resolve: () => undefined,
        reject: () => undefined,
      };
      const reverify = vi.fn(
        () => new Promise<typeof IDENTITY>((resolve, reject) => (settle = { resolve, reject })),
      );
      return { reverify, settle: () => settle };
    };

    it('checks the verified identity against the API before admitting', async () => {
      const requests: unknown[] = [];
      const reverify = vi.fn((request: object) => {
        requests.push({ ...request }); // the room refreshes the same object afterwards
        return Promise.resolve({ ...IDENTITY, role: 'STUDENT' as const, displayName: 'Ada L.' });
      });
      const { room } = makeAdmissionRoom(reverify);
      const client = { sessionId: 's1', auth: { ...AUTH } };

      await room.onJoin(client as never);

      expect(requests).toEqual([
        {
          userId: AUTH.userId,
          authSessionId: AUTH.authSessionId,
          classroomId: CLASSROOM_ID,
          role: AUTH.role,
          displayName: AUTH.displayName,
          appearanceRevision: AUTH.appearanceRevision,
          appearance: AUTH.appearance,
          deskCount: AUTH.deskCount,
          tutorBotSkin: AUTH.tutorBotSkin,
          tutorBotSkinRevision: AUTH.tutorBotSkinRevision,
        },
      ]);
      expect(room.state.avatars.get(IDENTITY.userId)).toMatchObject({
        role: 'STUDENT',
        displayName: 'Ada L.',
      });
      expect(client.auth).toMatchObject({ role: 'STUDENT', displayName: 'Ada L.' });
    });

    it('refuses the join as revoked access when the API denies it', async () => {
      const { room } = makeAdmissionRoom(vi.fn().mockRejectedValue(new JoinDeniedError()));

      await expect(
        room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never),
      ).rejects.toMatchObject({
        code: CLOSE_CODE_ACCESS_REVOKED,
        message: CLOSE_REASON_ACCESS_REVOKED,
      });
      expect(room.state.avatars.size).toBe(0);
    });

    it('refuses the join with the retryable code when access cannot be verified', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { room } = makeAdmissionRoom(
        vi.fn().mockRejectedValue(new JoinVerificationUnavailableError()),
      );

      await expect(
        room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never),
      ).rejects.toMatchObject({
        code: CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        message: CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      });
      expect(room.state.avatars.size).toBe(0);
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'realtime: join access verification unavailable',
      );
    });

    it('refuses an eviction that arrives while access is being verified, creating nothing', async () => {
      const { reverify, settle } = hold();
      const { room, reporter } = makeAdmissionRoom(reverify);
      const joining = room.onJoin({ sessionId: 's1', auth: { ...AUTH } } as never);
      const outcome = expect(joining).rejects.toMatchObject({
        code: CLOSE_CODE_ACCESS_REVOKED,
        message: CLOSE_REASON_ACCESS_REVOKED,
      });

      const evicted = room.evict({ userId: IDENTITY.userId });
      settle().resolve(IDENTITY); // the API still answered yes: only the eviction can refuse it

      await outcome;
      await room.onDispose();
      expect(evicted).toBe(1);
      expect(room.state.avatars.size).toBe(0);
      expect(reporter.report).not.toHaveBeenCalled();
    });

    it('spares a pending admission of another session when the eviction is session-filtered', async () => {
      const { reverify, settle } = hold();
      const { room } = makeAdmissionRoom(reverify);
      const joining = room.onJoin({
        sessionId: 's1',
        auth: { ...AUTH, authSessionId: 'session-a' },
      } as never);

      const evicted = room.evict({ userId: IDENTITY.userId, sessionId: 'session-b' });
      settle().resolve(IDENTITY);

      await expect(joining).resolves.toBeUndefined();
      expect(evicted).toBe(0);
      expect(room.state.avatars.has(IDENTITY.userId)).toBe(true);
    });

    it('evicts only the pending admissions of the named user and of the matching session', async () => {
      const { reverify, settle } = hold();
      const { room } = makeAdmissionRoom(reverify);
      const other = { ...AUTH, userId: 'other-user' };
      const joining = room.onJoin({
        sessionId: 's1',
        auth: { ...AUTH, authSessionId: 'session-a' },
      } as never);

      expect(room.evict({ userId: other.userId })).toBe(0);
      expect(room.evict({ userId: IDENTITY.userId, sessionId: 'session-a' })).toBe(1);
      settle().resolve(IDENTITY);

      await expect(joining).rejects.toMatchObject({ code: CLOSE_CODE_ACCESS_REVOKED });
    });

    it('does not admit a connection whose socket closed while access was being verified', async () => {
      // Colyseus only marks the client as LEAVING while onJoin is pending; onLeave runs afterwards.
      const { reverify, settle } = hold();
      const { room, reporter, clock } = makeAdmissionRoom(reverify);
      const client = {
        sessionId: 's1',
        auth: { ...AUTH },
        state: ClientState.JOINING as ClientState,
      };
      const joining = room.onJoin(client as never);
      const outcome = expect(joining).rejects.toMatchObject({ code: CloseCode.CONSENTED });

      client.state = ClientState.LEAVING;
      settle().resolve(IDENTITY); // the API still says access is granted

      await outcome;
      clock.value += 60_000;
      await room.onDispose();
      expect(room.state.avatars.size).toBe(0);
      expect(room.evict({ userId: IDENTITY.userId })).toBe(0); // nothing was attached
      expect(reporter.report).not.toHaveBeenCalled();
    });

    it('keeps the connection cap when admission completes', async () => {
      const { room } = makeAdmissionRoom(vi.fn().mockResolvedValue(IDENTITY));
      for (const id of ['s1', 's2', 's3'])
        await room.onJoin({ sessionId: id, auth: { ...AUTH } } as never);

      await expect(
        room.onJoin({ sessionId: 's4', auth: { ...AUTH } } as never),
      ).rejects.toMatchObject({
        code: CLOSE_CODE_TOO_MANY_CONNECTIONS,
      });
    });

    it('does not call the API for a join into another classroom', async () => {
      const reverify = vi.fn();
      const { room } = makeAdmissionRoom(reverify);

      await expect(
        room.onJoin({
          sessionId: 's1',
          auth: { ...AUTH, classroomId: '11111111-1111-4111-8111-111111111111' },
        } as never),
      ).rejects.toThrow(ServerError);
      expect(reverify).not.toHaveBeenCalled();
    });
  });
});

describe('NPC routines (#147)', () => {
  /** Same seed, same walk: a tiny deterministic PRNG injected through the room options. */
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const makeRoom = (seed = 1) => {
    const room = new (createClassroomRoom(
      { verify: vi.fn(), reverify: vi.fn().mockResolvedValue(IDENTITY) },
      { random: seeded(seed) },
    ))();
    vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
    room.onCreate({ classroomId: CLASSROOM_ID });
    return room;
  };
  const snapshot = (room: ClassroomRoom) =>
    NPC_IDS.map((id) => {
      const { x, z, rotation, state, emote } = room.state.npcs.get(id)!;
      return { x, z, rotation, state, emote };
    });
  const tickFor = (room: ClassroomRoom, seconds: number, dt = 0.05) => {
    for (let t = 0; t < seconds; t += dt) room.tick(dt);
  };

  it('keeps the NPCs frozen while nobody is in the room', () => {
    const room = makeRoom();
    const before = snapshot(room);

    tickFor(room, 300);

    expect(snapshot(room)).toEqual(before);
  });

  it('moves them, within walkable spots, while a member is present', async () => {
    const room = makeRoom();
    const homes = deriveNpcHomes(buildClassroomLayout(12));
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    const layout = buildClassroomLayout(12);
    const seenStates = new Set<string>();

    for (let t = 0; t < 300; t += 0.05) {
      room.tick(0.05);
      for (const id of NPC_IDS) {
        const npc = room.state.npcs.get(id)!;
        seenStates.add(npc.state);
        expect(
          isWalkable(layout, npc.x, npc.z, {
            radius: 0.3,
            ignoreProps: id === 'pet' ? ['petBed'] : [],
          }),
        ).toBe(true);
        if (npc.state !== 'emote') expect(npc.emote).toBe('');
      }
    }

    expect(seenStates.has('walking')).toBe(true);
    expect(
      NPC_IDS.some((id) => {
        const npc = room.state.npcs.get(id)!;
        return npc.x !== homes[id].x || npc.z !== homes[id].z;
      }),
    ).toBe(true);
  });

  it('freezes again when the last member leaves', async () => {
    const room = makeRoom();
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    tickFor(room, 60);

    room.onLeave({ sessionId: 's1' } as never);
    const frozen = snapshot(room);
    tickFor(room, 120);

    expect(room.state.avatars.size).toBe(0);
    expect(snapshot(room)).toEqual(frozen);
  });

  it('shows every member the same thing for the same seed', async () => {
    const a = makeRoom(7);
    const b = makeRoom(7);
    await a.onJoin({ sessionId: 's1', auth: AUTH } as never);
    await b.onJoin({ sessionId: 's1', auth: AUTH } as never);

    tickFor(a, 120);
    tickFor(b, 120);

    expect(snapshot(a)).toEqual(snapshot(b));
  });

  it('keeps the routine on the grown layout after desks are added', async () => {
    const room = makeRoom(3);
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    room.applyDeskCount(20);
    const grown = buildClassroomLayout(20);

    for (let t = 0; t < 120; t += 0.05) {
      room.tick(0.05);
      for (const id of NPC_IDS) {
        const npc = room.state.npcs.get(id)!;
        expect(
          isWalkable(grown, npc.x, npc.z, {
            radius: 0.3,
            ignoreProps: id === 'pet' ? ['petBed'] : [],
          }),
        ).toBe(true);
      }
    }
  });
});

describe('NPC interactions (#147)', () => {
  const OTHER_AUTH = { ...AUTH, userId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f' };
  const homes = deriveNpcHomes(buildClassroomLayout(12));
  let random = 0.5;
  let nowMs = 1_000_000;

  const makeRoom = async () => {
    random = 0.5;
    nowMs = 1_000_000;
    const room = new (createClassroomRoom(
      { verify: vi.fn(), reverify: vi.fn().mockResolvedValue(IDENTITY) },
      { random: () => random, now: () => nowMs },
    ))();
    vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
    room.onCreate({ classroomId: CLASSROOM_ID });
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    await room.onJoin({ sessionId: 's2', auth: OTHER_AUTH } as never);
    return room;
  };
  const interact = (room: ClassroomRoom, sessionId: string, payload: unknown): void =>
    (
      room as unknown as { onNpcInteract(c: { sessionId: string }, i: unknown): void }
    ).onNpcInteract({ sessionId }, payload);
  /** Puts a member's avatar `d` metres from the NPC. */
  const standNear = (room: ClassroomRoom, userId: string, npcId: 'pet' | 'tutorBot', d = 1) => {
    const avatar = room.state.avatars.get(userId)!;
    avatar.x = homes[npcId].x + d;
    avatar.z = homes[npcId].z;
  };
  const tickFor = (room: ClassroomRoom, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) room.tick(0.05);
  };
  const runtimeOf = (room: ClassroomRoom, id: 'pet' | 'tutorBot') =>
    (
      room as unknown as { npcRuntimes: Map<string, { phase: string; state: string }> }
    ).npcRuntimes.get(id)!;

  it('makes the pet react, stops it in place and tells the room who triggered it', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');
    random = 0.1;

    interact(room, 's1', { npcId: 'pet' });

    const pet = room.state.npcs.get('pet')!;
    expect(pet).toMatchObject({
      state: 'reacting',
      reaction: 'greet',
      phraseId: -1,
      reactionSeq: 1,
      reactingSessionId: 's1',
      emote: '',
    });
    expect(pet.rotation).toBeCloseTo(Math.PI / 2, 5); // faces the member, who stands at +x
    const { x, z } = pet;
    tickFor(room, 1.5);
    expect(pet).toMatchObject({ x, z, state: 'reacting', reaction: 'greet' });
  });

  it('picks the other pet reaction with a high roll', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');
    random = 0.9;

    interact(room, 's1', { npcId: 'pet' });

    expect(room.state.npcs.get('pet')!.reaction).toBe('askForPets');
  });

  it('makes the tutor bot say a phrase of the shared list', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'tutorBot');

    interact(room, 's1', { npcId: 'tutorBot' });

    const bot = room.state.npcs.get('tutorBot')!;
    expect(bot).toMatchObject({ state: 'reacting', reaction: 'phrase', reactingSessionId: 's1' });
    expect(bot.phraseId).toBeGreaterThanOrEqual(0);
    expect(bot.phraseId).toBeLessThan(TUTOR_BOT_PHRASES.length);
  });

  it('ignores a member who is too far from the NPC', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet', NPC_INTERACT_MAX_DISTANCE + 0.2);

    interact(room, 's1', { npcId: 'pet' });

    expect(room.state.npcs.get('pet')).toMatchObject({ reaction: '', reactionSeq: 0 });
    expect(room.state.npcs.get('pet')!.state).not.toBe('reacting');
  });

  it('ignores an unknown npc id, and a connection that is not in the room', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');

    interact(room, 's1', { npcId: 'dog' });
    interact(room, 'ghost', { npcId: 'pet' });

    expect(room.state.npcs.get('pet')!.reactionSeq).toBe(0);
  });

  it('forgets the cooldown when the member leaves for good', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');
    interact(room, 's1', { npcId: 'pet' });
    tickFor(room, 6); // the reaction is over, only the now-based cooldown remains
    nowMs += NPC_INTERACT_COOLDOWN_MS / 2;

    room.onLeave({ sessionId: 's1' } as never);
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    standNear(room, AUTH.userId, 'pet');
    random = 0.1;

    interact(room, 's1', { npcId: 'pet' });
    expect(room.state.npcs.get('pet')!.reactionSeq).toBe(2);
  });

  it('applies a per-member cooldown for the same NPC', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');
    interact(room, 's1', { npcId: 'pet' });
    tickFor(room, 6); // the reaction is over, only the cooldown remains
    nowMs += NPC_INTERACT_COOLDOWN_MS - 1;

    interact(room, 's1', { npcId: 'pet' });
    expect(room.state.npcs.get('pet')!.reactionSeq).toBe(1);

    nowMs += 1;
    interact(room, 's1', { npcId: 'pet' });
    expect(room.state.npcs.get('pet')!.reactionSeq).toBe(2);
  });

  it('ignores another member while the NPC is already reacting', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');
    standNear(room, OTHER_AUTH.userId, 'pet');
    interact(room, 's1', { npcId: 'pet' });

    interact(room, 's2', { npcId: 'pet' });

    expect(room.state.npcs.get('pet')).toMatchObject({ reactionSeq: 1, reactingSessionId: 's1' });
  });

  it('wakes a sleeping pet and makes it react', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'pet');
    const runtime = runtimeOf(room, 'pet');
    runtime.phase = 'sleep';
    runtime.state = 'sleeping';
    room.tick(0.05);
    expect(room.state.npcs.get('pet')!.state).toBe('sleeping');

    interact(room, 's1', { npcId: 'pet' });

    expect(room.state.npcs.get('pet')).toMatchObject({ state: 'reacting', reactionSeq: 1 });
  });

  it('never says the same phrase twice in a row', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'tutorBot');
    random = 0; // the raw roll always lands on the first phrase
    const phrases: number[] = [];

    for (let i = 0; i < 3; i++) {
      interact(room, 's1', { npcId: 'tutorBot' });
      phrases.push(room.state.npcs.get('tutorBot')!.phraseId);
      tickFor(room, 8);
      nowMs += NPC_INTERACT_COOLDOWN_MS;
    }

    expect(phrases[0]).not.toBe(phrases[1]);
    expect(phrases[1]).not.toBe(phrases[2]);
  });

  it('clears the reaction when it ends and the routine resumes', async () => {
    const room = await makeRoom();
    standNear(room, AUTH.userId, 'tutorBot');
    interact(room, 's1', { npcId: 'tutorBot' });
    const bot = room.state.npcs.get('tutorBot')!;
    expect(bot.reaction).toBe('phrase');

    tickFor(room, 4);
    expect(bot.state).toBe('reacting');
    tickFor(room, 2);

    expect(bot).toMatchObject({ reaction: '', phraseId: -1, reactingSessionId: '' });
    expect(bot.state).not.toBe('reacting');
    expect(bot.reactionSeq).toBe(1);
    expect(runtimeOf(room, 'tutorBot').phase).not.toBe('reacting');
  });
});

describe('avatar emotes (#154)', () => {
  const emote = (room: ClassroomRoom, sessionId: string): void =>
    (
      room as unknown as { onAvatarEmote(c: { sessionId: string }, i: unknown): void }
    ).onAvatarEmote({ sessionId }, { emote: 'Wave' });

  const makeRoom = async () => {
    const room = new (createClassroomRoom({
      verify: vi.fn(),
      reverify: vi.fn().mockResolvedValue(IDENTITY),
    }))();
    vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
    vi.spyOn(room, 'allowReconnection').mockReturnValue(new Promise(() => undefined) as never);
    const broadcast = vi.spyOn(room, 'broadcast').mockImplementation(() => undefined as never);
    room.onCreate({ classroomId: CLASSROOM_ID });
    await room.onJoin({ sessionId: 's1', auth: AUTH } as never);
    return { room, broadcast };
  };

  it('ignores a held connection and a connection that never joined', async () => {
    const { room, broadcast } = await makeRoom();
    room.onDrop({ sessionId: 's1' } as never);

    emote(room, 's1');
    emote(room, 'unknown');

    expect(broadcast).not.toHaveBeenCalled();
  });

  it('forgets the cooldown of a member who left for good', async () => {
    const { room, broadcast } = await makeRoom();
    emote(room, 's1');
    room.onLeave({ sessionId: 's1' } as never);
    await room.onJoin({ sessionId: 's2', auth: AUTH } as never);

    emote(room, 's2');

    expect(broadcast).toHaveBeenCalledTimes(2);
  });
});
