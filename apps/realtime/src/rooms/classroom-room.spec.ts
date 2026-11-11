import { describe, it, expect, vi } from 'vitest';
import { ServerError } from '@colyseus/core';
import {
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_ACCESS_REVOKED,
  CLOSE_REASON_VERIFICATION_UNAVAILABLE,
} from '@aula/contracts';
import { createClassroomRoom, type ClassroomRoom } from './classroom-room';
import {
  JoinDeniedError,
  JoinVerificationUnavailableError,
  type JoinVerifier,
} from '../join/join-verifier';

const CLASSROOM_ID = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  classroomId: CLASSROOM_ID,
  role: 'TEACHER' as const,
  displayName: 'Ada Lovelace',
};
const AUTH = {
  userId: IDENTITY.userId,
  authSessionId: IDENTITY.sessionId,
  classroomId: CLASSROOM_ID,
  role: IDENTITY.role,
  displayName: IDENTITY.displayName,
};

describe('createClassroomRoom', () => {
  it('exposes a static onAuth that Colyseus can call detached from the class', async () => {
    const verifier: JoinVerifier = {
      verify: vi.fn().mockResolvedValue(IDENTITY),
      reverify: vi.fn(),
    };
    const RoomClass = createClassroomRoom(verifier);
    const { onAuth } = RoomClass; // MatchMaker invokes it without `this`
    const context = { token: 'token-1' } as never;

    await expect(onAuth('token-1', { classroomId: CLASSROOM_ID }, context)).resolves.toEqual(AUTH);
    expect(verifier.verify).toHaveBeenCalledExactlyOnceWith('token-1', CLASSROOM_ID);
  });

  /** A room that has run `onCreate`, with the real-time loop replaced so no timer leaks. */
  const makeCreatedRoom = () => {
    const room = new (createClassroomRoom({ verify: vi.fn(), reverify: vi.fn() }))();
    const setFixedTimestep = vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
    room.onCreate({ classroomId: CLASSROOM_ID });
    return { room, setFixedTimestep };
  };
  const makeJoinedRoom = () => makeCreatedRoom().room;

  it('rejects a join whose verified classroom differs from the room classroom', () => {
    const room = makeJoinedRoom();
    const client = {
      sessionId: 's1',
      auth: { ...AUTH, classroomId: '11111111-1111-4111-8111-111111111111' },
    };

    expect(() => room.onJoin(client as never)).toThrow(ServerError);
    expect(room.state.avatars.size).toBe(0);
  });

  it('admits a join whose verified classroom equals the room classroom', () => {
    const room = makeJoinedRoom();

    expect(() => room.onJoin({ sessionId: 's1', auth: AUTH } as never)).not.toThrow();
    expect(room.state.avatars.get(IDENTITY.userId)).toMatchObject({
      displayName: 'Ada Lovelace',
      role: 'TEACHER',
      status: 'online',
    });
  });

  it('rejects a join with no verified identity', () => {
    const room = makeJoinedRoom();

    expect(() => room.onJoin({ sessionId: 's1' } as never)).toThrow(ServerError);
    expect(room.state.avatars.size).toBe(0);
  });

  describe('onDispose', () => {
    const makeTimedRoom = (nowMs: { value: number }) => {
      const reporter = { report: vi.fn().mockResolvedValue(undefined) };
      const room = new (createClassroomRoom(
        { verify: vi.fn(), reverify: vi.fn() },
        { now: () => nowMs.value, reporter },
      ))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      return { room, reporter };
    };

    it('reports the connected time of whoever is still present', async () => {
      const clock = { value: 1_000_000 };
      const { room, reporter } = makeTimedRoom(clock);
      room.onJoin({ sessionId: 's1', auth: AUTH } as never);
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
      room.onJoin(client);
      clock.value += 10_000;
      room.onLeave(client);

      await room.onDispose();

      expect(reporter.report).toHaveBeenCalledTimes(1);
    });

    it('never reports more seconds than the API accepts in one report', async () => {
      const clock = { value: 1_000_000 };
      const { room, reporter } = makeTimedRoom(clock);
      room.onJoin({ sessionId: 's1', auth: AUTH } as never);
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
        { verify: vi.fn(), reverify: vi.fn() },
        { now: () => clock.value, reporter },
      ))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      room.onCreate({ classroomId: CLASSROOM_ID });
      room.onJoin({ sessionId: 's1', auth: AUTH } as never);
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
    new (createClassroomRoom({ verify: vi.fn(), reverify: vi.fn() }))();

  describe('a second connection while another is held', () => {
    it('shows the avatar as online with the current identity instead of staying reconnecting', () => {
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify: vi.fn() }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const first = { sessionId: 's1', auth: { ...AUTH } };
      room.onJoin(first as never);
      room.onDrop(first as never); // for example a page refresh
      expect(room.state.avatars.get(IDENTITY.userId)?.status).toBe('reconnecting');

      room.onJoin({
        sessionId: 's2',
        auth: { ...AUTH, role: 'STUDENT', displayName: 'Ada L.' },
      } as never);

      expect(room.state.avatars.get(IDENTITY.userId)).toMatchObject({
        status: 'online',
        role: 'STUDENT',
        displayName: 'Ada L.',
      });
      expect(room.state.avatars.size).toBe(1);
    });
  });

  describe('session-specific eviction of held reconnections', () => {
    it('rejects the held reconnection of the evicted session only and keeps the other session', () => {
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify: vi.fn() }))();
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
      room.onJoin(other as never);
      room.onJoin(revoked as never);
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

    const makeReconnectingRoom = (reverify: JoinVerifier['reverify']) => {
      const room = new (createClassroomRoom({ verify: vi.fn(), reverify }))();
      vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
      // The unit test has no real transport: a resolved promise stands in for the pending hold.
      vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
      room.onCreate({ classroomId: CLASSROOM_ID });
      const client: FakeClient = { sessionId: 's1', auth: { ...AUTH }, leave: vi.fn() };
      room.onJoin(client as never);
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
      const { room, client } = makeReconnectingRoom(
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

    it('releases the connection and its avatar when access is denied, without relying on the transport', async () => {
      const { room, client } = makeReconnectingRoom(() => Promise.reject(new JoinDeniedError()));

      await room.onReconnect(client as never);
      sendInput(room, client, 1, 0);
      room.tick(0.5);

      expect(room.state.avatars.has(IDENTITY.userId)).toBe(false);
    });

    it('releases the connection when verification is unavailable too', async () => {
      const { room, client } = makeReconnectingRoom(() =>
        Promise.reject(new JoinVerificationUnavailableError()),
      );

      await room.onReconnect(client as never);

      expect(room.state.avatars.has(IDENTITY.userId)).toBe(false);
    });

    describe('a connection released while access is being re-verified', () => {
      const makeTimedReconnectingRoom = () => {
        const clock = { value: 1_000_000 };
        const reporter = { report: vi.fn().mockResolvedValue(undefined) };
        let settle: { resolve(i: typeof IDENTITY): void; reject(e: Error): void } = {
          resolve: () => undefined,
          reject: () => undefined,
        };
        const reverify = () =>
          new Promise<typeof IDENTITY>((resolve, reject) => (settle = { resolve, reject }));
        const room = new (createClassroomRoom(
          { verify: vi.fn(), reverify },
          { now: () => clock.value, reporter },
        ))();
        vi.spyOn(room, 'setFixedTimestep').mockImplementation(() => undefined);
        vi.spyOn(room, 'allowReconnection').mockReturnValue(Promise.resolve(undefined) as never);
        room.onCreate({ classroomId: CLASSROOM_ID });
        const client: FakeClient = { sessionId: 's1', auth: { ...AUTH }, leave: vi.fn() };
        room.onJoin(client as never);
        clock.value += 30_000;
        room.onDrop(client as never);
        return { room, client, reporter, settle: () => settle };
      };

      it('reports the connected time once and does not close the socket again when it already left', async () => {
        const { room, client, reporter, settle } = makeTimedReconnectingRoom();
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
        const { room, client, reporter, settle } = makeTimedReconnectingRoom();
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
      const { room, client } = makeReconnectingRoom(() => Promise.reject(new JoinDeniedError()));

      await room.onReconnect(client as never);

      expect(client.leave).toHaveBeenCalledExactlyOnceWith(
        CLOSE_CODE_ACCESS_REVOKED,
        CLOSE_REASON_ACCESS_REVOKED,
      );
    });

    it('closes an unverifiable reconnection with the retryable code, not as revoked access', async () => {
      const { room, client } = makeReconnectingRoom(() =>
        Promise.reject(new JoinVerificationUnavailableError()),
      );

      await room.onReconnect(client as never);

      expect(client.leave).toHaveBeenCalledExactlyOnceWith(
        CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      );
    });

    it('treats an unexpected verifier failure as unavailable and fails closed', async () => {
      const { room, client } = makeReconnectingRoom(() => Promise.reject(new Error('boom')));

      await room.onReconnect(client as never);

      expect(client.leave).toHaveBeenCalledExactlyOnceWith(
        CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      );
    });
  });
});
