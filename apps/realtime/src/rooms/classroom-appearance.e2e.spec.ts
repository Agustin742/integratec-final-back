import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import type { Room as SdkRoom } from '@colyseus/sdk';
import { CLASSROOM_ROOM_NAME } from '@aula/contracts';
import { createAppConfig } from '../app.config';
import { ApiJoinVerifier } from '../join/api-join-verifier';
import {
  STUB_SECRET,
  makeStubAppearance,
  makeUser,
  startStubApi,
  type StubApi,
  type StubUser,
} from '../testing/stub-api';
import { waitUntil } from '../testing/wait-until';
import type { ClassroomRoom } from './classroom-room';

const CLASSROOM_A = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const PORT = 2576;

describe('ClassroomRoom live appearance updates (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 1, [CLASSROOM_A]);
  const bob = makeUser('Bob', 2, [CLASSROOM_A]);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
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

  const join = async (user: StubUser, classroomId = CLASSROOM_A): Promise<SdkRoom> => {
    colyseus.sdk.auth.token = user.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId });
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
  const applyAppearance = (body: object, secret: string | null = STUB_SECRET) =>
    fetch(`http://127.0.0.1:${PORT}/internal/appearance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret === null ? {} : { 'x-internal-service-secret': secret }),
      },
      body: JSON.stringify(body),
    });
  /** Client-side decoded avatar; undefined until the client has decoded the room state. */
  const clientAvatarOf = (
    room: SdkRoom,
    userId: string,
  ):
    | {
        appearance?: { hairColor: string; items: Map<string, { shopItemCode?: string }> };
      }
    | undefined =>
    (
      room.state as unknown as {
        avatars?: {
          get(key: string): {
            appearance?: { hairColor: string; items: Map<string, { shopItemCode?: string }> };
          };
        };
      }
    ).avatars?.get(userId);

  it('shows the new appearance to the other member without any rejoin or reconnect (S4.1)', async () => {
    const observerRoom = await join(bob);
    await join(ada);
    // Both clients have decoded Ada with her join-time appearance.
    await waitUntil(
      () => clientAvatarOf(observerRoom, ada.userId)?.appearance?.hairColor === '#AF6D63',
      'observer decoded the initial appearance',
    );

    const res = await applyAppearance({
      classroomId: CLASSROOM_A,
      userId: ada.userId,
      appearanceRevision: 1,
      appearance: makeStubAppearance('#353849'),
    });

    expect(res.status).toBe(204);
    // The server state is updated...
    expect(serverRoom(observerRoom).state.avatars.get(ada.userId)?.appearance.hairColor).toBe(
      '#353849',
    );
    // ...and the patch reaches the other member's decoded room state, with no rejoin or reconnect.
    await waitUntil(
      () => clientAvatarOf(observerRoom, ada.userId)?.appearance?.hairColor === '#353849',
      'observer decoded the new appearance',
    );
    const decoded = clientAvatarOf(observerRoom, ada.userId);
    expect(decoded?.appearance?.items.get('head')?.shopItemCode).toBe('head_cap');
    expect(decoded?.appearance?.items.has('face')).toBe(false);
  });

  it('is idempotent: repeating the update is a harmless 204 with the same final state', async () => {
    const observerRoom = await join(bob);
    await join(ada);
    const appearance = makeStubAppearance('#C77DAA');

    expect(
      (
        await applyAppearance({
          classroomId: CLASSROOM_A,
          userId: ada.userId,
          appearanceRevision: 1,
          appearance,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await applyAppearance({
          classroomId: CLASSROOM_A,
          userId: ada.userId,
          appearanceRevision: 1,
          appearance,
        })
      ).status,
    ).toBe(204);

    expect(serverRoom(observerRoom).state.avatars.get(ada.userId)?.appearance.hairColor).toBe(
      '#C77DAA',
    );
    expect(serverRoom(observerRoom).state.avatars.get(bob.userId)?.appearance.hairColor).toBe(
      '#AF6D63',
    );
  });

  it('does not let a delayed older snapshot overwrite a newer appearance', async () => {
    const observerRoom = await join(bob);
    await join(ada);
    const latest = makeStubAppearance('#C77DAA');

    expect(
      (
        await applyAppearance({
          classroomId: CLASSROOM_A,
          userId: ada.userId,
          appearanceRevision: 2,
          appearance: latest,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await applyAppearance({
          classroomId: CLASSROOM_A,
          userId: ada.userId,
          appearanceRevision: 1,
          appearance: makeStubAppearance('#353849'),
        })
      ).status,
    ).toBe(204);

    expect(serverRoom(observerRoom).state.avatars.get(ada.userId)?.appearance.hairColor).toBe(
      '#C77DAA',
    );
  });

  it('answers 204 and changes nothing when the room or avatar does not exist', async () => {
    const observerRoom = await join(bob);

    expect(
      (
        await applyAppearance({
          classroomId: '99999999-9999-4999-8999-999999999999',
          userId: bob.userId,
          appearanceRevision: 1,
          appearance: makeStubAppearance('#353849'),
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await applyAppearance({
          classroomId: CLASSROOM_A,
          userId: '99999999-9999-4999-8999-999999999999',
          appearanceRevision: 1,
          appearance: makeStubAppearance('#353849'),
        })
      ).status,
    ).toBe(204);

    expect(serverRoom(observerRoom).state.avatars.get(bob.userId)?.appearance.hairColor).toBe(
      '#AF6D63',
    );
  });

  it('refuses callers without the service secret and applies nothing', async () => {
    const observerRoom = await join(bob);

    expect(
      (
        await applyAppearance(
          {
            classroomId: CLASSROOM_A,
            userId: bob.userId,
            appearanceRevision: 1,
            appearance: makeStubAppearance('#353849'),
          },
          null,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await applyAppearance(
          {
            classroomId: CLASSROOM_A,
            userId: bob.userId,
            appearanceRevision: 1,
            appearance: makeStubAppearance('#353849'),
          },
          'x'.repeat(STUB_SECRET.length),
        )
      ).status,
    ).toBe(401);

    expect(serverRoom(observerRoom).state.avatars.get(bob.userId)?.appearance.hairColor).toBe(
      '#AF6D63',
    );
  });

  it('answers 400 for a malformed payload and applies nothing', async () => {
    const observerRoom = await join(bob);

    const res = await applyAppearance({
      classroomId: CLASSROOM_A,
      userId: bob.userId,
      appearanceRevision: 1,
      appearance: { junk: true },
    });

    expect(res.status).toBe(400);
    expect(serverRoom(observerRoom).state.avatars.get(bob.userId)?.appearance.hairColor).toBe(
      '#AF6D63',
    );
  });
});
