import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { CLASSROOM_ROOM_NAME } from '@aula/contracts';
import { createAppConfig } from '../app.config';
import { ApiJoinVerifier } from '../join/api-join-verifier';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const GOOD_TOKEN = 'valid-access-token';
const CLASSROOM_A = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const CLASSROOM_B = '11111111-1111-4111-8111-111111111111';
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  role: 'STUDENT',
  displayName: 'Ada Lovelace',
};

/**
 * Stub of the NestJS endpoints: the token is valid only for classroom A, and so is the user's
 * access when it is checked again at admission.
 */
function startStubApi(): Promise<{ server: HttpServer; url: string; calls: string[] }> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      calls.push(raw);
      const body = JSON.parse(raw) as { accessToken?: string; classroomId: string };
      const reverification = req.url === '/internal/realtime/access-reverification';
      const authorized =
        req.headers['x-internal-service-secret'] === SECRET &&
        (reverification || body.accessToken === GOOD_TOKEN) &&
        body.classroomId === CLASSROOM_A;
      res.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(authorized ? { ...IDENTITY, classroomId: CLASSROOM_A } : {}));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        calls,
      }),
    ),
  );
}

describe('ClassroomRoom join (real Colyseus server + stub API)', () => {
  let colyseus: ColyseusTestServer;
  let api: Awaited<ReturnType<typeof startStubApi>>;

  beforeAll(async () => {
    api = await startStubApi();
    const verifier = new ApiJoinVerifier({ baseUrl: api.url, serviceSecret: SECRET });
    colyseus = await boot(createAppConfig(verifier));
  });

  afterEach(async () => {
    api.calls.length = 0;
    colyseus.sdk.auth.token = undefined as never;
    await colyseus.cleanup();
  });

  afterAll(async () => {
    await colyseus.shutdown();
    await new Promise((resolve) => api.server.close(resolve));
  });

  it('admits a client with a valid token for its classroom', async () => {
    colyseus.sdk.auth.token = GOOD_TOKEN;
    const room = await colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_A });

    expect(room.sessionId).toBeTruthy();
    const serverRoom = colyseus.getRoomById(room.roomId);
    expect(serverRoom.clients).toHaveLength(1);
    expect(serverRoom.clients[0].auth).toMatchObject({
      userId: IDENTITY.userId,
      authSessionId: IDENTITY.sessionId,
      role: IDENTITY.role,
      displayName: IDENTITY.displayName,
      classroomId: CLASSROOM_A,
    });
    // The Colyseus connection id must stay independent of the account session id.
    expect(serverRoom.clients[0].sessionId).not.toBe(IDENTITY.sessionId);
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
    colyseus.sdk.auth.token = GOOD_TOKEN;
    await expect(
      colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_B }),
    ).rejects.toThrow();
  });

  it('rejects a token passed in the join options instead of the header', async () => {
    await expect(
      colyseus.sdk.joinOrCreate(CLASSROOM_ROOM_NAME, {
        classroomId: CLASSROOM_A,
        accessToken: GOOD_TOKEN,
      }),
    ).rejects.toThrow();
  });

  it('rejects joinById into a room of another classroom', async () => {
    // Room for classroom B exists, but the token is only valid for classroom A.
    const roomB = await colyseus.createRoom(CLASSROOM_ROOM_NAME, { classroomId: CLASSROOM_B });
    colyseus.sdk.auth.token = GOOD_TOKEN;

    await expect(
      colyseus.sdk.joinById(roomB.roomId, { classroomId: CLASSROOM_A }),
    ).rejects.toThrow();
    // A failed join leaves the empty room disposed (or at least without clients).
    expect(colyseus.getRoomById(roomB.roomId)?.clients ?? []).toHaveLength(0);
  });
});
