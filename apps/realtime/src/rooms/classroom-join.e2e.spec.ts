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
} from '../testing/stub-api';
import { waitUntil } from '../testing/wait-until';
import type { ClassroomRoom } from './classroom-room';

const CLASSROOM_A = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const CLASSROOM_B = '11111111-1111-4111-8111-111111111111';

describe('ClassroomRoom join (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: StubApi;
  const ada = makeUser('Ada', 1, [CLASSROOM_A]);
  const bob = makeUser('Bob', 2, [CLASSROOM_A]);
  bob.appearance = makeStubAppearance('#353849');

  /** Server-side room with its typed live state, as in the reconnection spec. */
  const serverRoom = (room: SdkRoom): ClassroomRoom =>
    colyseus.getRoomById(room.roomId) as unknown as ClassroomRoom;

  /** Client-side decoded avatar; undefined until the client has decoded the room state. */
  const clientAvatarOf = (
    room: SdkRoom,
    userId: string,
  ):
    | {
        appearance?: { bodyId: string; hairColor: string; items: Map<string, unknown> };
      }
    | undefined =>
    (
      room.state as unknown as {
        avatars?: {
          get(key: string):
            | {
                appearance?: { bodyId: string; hairColor: string; items: Map<string, unknown> };
              }
            | undefined;
        };
      }
    ).avatars?.get(userId);

  beforeAll(async () => {
    api = await startStubApi([ada, bob]);
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: STUB_SECRET });
    colyseus = await boot(createAppConfig(verifier));
  });

  afterEach(async () => {
    ada.classrooms.add(CLASSROOM_A);
    bob.classrooms.add(CLASSROOM_A);
    api.calls.length = 0;
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await api.close();
  });

  it('admits a client with a valid token for its classroom', async () => {
    colyseus.sdk.auth.token = ada.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A });

    expect(room.sessionId).toBeTruthy();
    const server = colyseus.getRoomById(room.roomId);
    expect(server.clients).toHaveLength(1);
    expect(server.clients[0].auth).toMatchObject({
      userId: ada.userId,
      authSessionId: ada.sessionId,
      role: ada.role,
      displayName: ada.displayName,
      classroomId: CLASSROOM_A,
    });
    // The Colyseus connection id must stay independent of the account session id.
    expect(server.clients[0].sessionId).not.toBe(ada.sessionId);
  });

  it('shares the joining member appearance through the room state (#114)', async () => {
    colyseus.sdk.auth.token = ada.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A });

    const serverAvatar = serverRoom(room).state.avatars.get(ada.userId);
    expect(serverAvatar?.appearance.bodyId).toBe('female');
    expect(serverAvatar?.appearance.hairColor).toBe('#AF6D63');
    expect(serverAvatar?.appearance.items.size).toBe(1);
    expect(serverAvatar?.appearance.items.get('head')).toMatchObject(ada.appearance.items.head);
    expect(serverAvatar?.appearance.items.has('face')).toBe(false);

    // The same state reaches the joined client, decoded with the generated types.
    await waitUntil(
      () => clientAvatarOf(room, ada.userId)?.appearance?.bodyId === 'female',
      'client decoded the joiner appearance',
    );
    const clientAvatar = clientAvatarOf(room, ada.userId);
    expect(clientAvatar?.appearance?.items.get('head')).toMatchObject(ada.appearance.items.head);
    expect(clientAvatar?.appearance?.items.has('face')).toBe(false);
  });

  it('gives a joiner the appearance of every member already present (#114)', async () => {
    colyseus.sdk.auth.token = bob.token;
    await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A });
    colyseus.sdk.auth.token = ada.token;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A });

    const server = serverRoom(room);
    expect(server.state.avatars.size).toBe(2);
    expect(server.state.avatars.get(bob.userId)?.appearance.hairColor).toBe('#353849');
    expect(server.state.avatars.get(ada.userId)?.appearance.hairColor).toBe('#AF6D63');

    await waitUntil(
      () => clientAvatarOf(room, bob.userId)?.appearance?.hairColor === '#353849',
      'client decoded the other member appearance',
    );
    const clientAvatar = clientAvatarOf(room, bob.userId);
    expect(clientAvatar?.appearance?.hairColor).toBe('#353849');
    expect(clientAvatar?.appearance?.items.get('head')).toMatchObject(bob.appearance.items.head);
  });

  it('rejects a join without a token', async () => {
    await expect(
      colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A }),
    ).rejects.toThrow();
    expect(api.calls).toHaveLength(0);
  });

  it('rejects a token the API denies', async () => {
    colyseus.sdk.auth.token = 'forged-token';
    await expect(
      colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A }),
    ).rejects.toThrow();
  });

  it('rejects a classroom the user cannot access', async () => {
    colyseus.sdk.auth.token = ada.token;
    await expect(
      colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_B }),
    ).rejects.toThrow();
  });

  it('rejects a token passed in the join options instead of the header', async () => {
    await expect(
      colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, {
        classroomId: CLASSROOM_A,
        accessToken: ada.token,
      }),
    ).rejects.toThrow();
  });

  it('rejects joinById into a room of another classroom', async () => {
    // Room for classroom B exists, but the token is only valid for classroom A.
    const roomB = await colyseus.createRoom(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_B });
    colyseus.sdk.auth.token = ada.token;

    await expect(
      colyseus.sdk.joinById(roomB.roomId, { classroomId: CLASSROOM_A }),
    ).rejects.toThrow();
    // A failed join leaves the empty room disposed (or at least without clients).
    expect(colyseus.getRoomById(roomB.roomId)?.clients ?? []).toHaveLength(0);
  });
});
