import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AppearanceSlotName } from '@aula/contracts';

export const STUB_SECRET = 'test-only-secret-with-at-least-32-characters';

/**
 * Public appearance payload the stub API answers with; mirrors `MemberAppearance` in contracts.
 * The fixture always equips the head slot and leaves the others empty, so `head` is non-null.
 */
export interface StubAppearance {
  baseAvatar: {
    bodyId: string;
    hairId: string;
    topId: string;
    hairColor: string;
    clothingColor: string;
  };
  items: {
    head: StubEquippedItem;
    face: null;
    back: null;
    desk_decor: null;
  };
}

export interface StubEquippedItem {
  slot: AppearanceSlotName;
  shopItemId: string;
  shopItemCode: string;
  shopItemName: string;
  kind: string;
}

/** Deterministic appearance fixture; vary the hair color to tell two snapshots apart. */
export const makeStubAppearance = (hairColor = '#AF6D63'): StubAppearance => ({
  baseAvatar: {
    bodyId: 'female',
    hairId: 'afro',
    topId: 'tshirt',
    hairColor,
    clothingColor: '#75B7DA',
  },
  items: {
    head: {
      slot: 'head',
      shopItemId: '20000000-0000-4000-8000-000000000001',
      shopItemCode: 'cap_blue',
      shopItemName: 'Blue Classroom Cap',
      kind: 'AVATAR_ACCESSORY',
    },
    face: null,
    back: null,
    desk_decor: null,
  },
});

export interface StubUser {
  token: string;
  userId: string;
  sessionId: string;
  role: 'OWNER' | 'ADMIN' | 'TEACHER' | 'STUDENT';
  displayName: string;
  /** Appearance served on join and reverification; mutate it to simulate a change. */
  appearance: StubAppearance;
  /** Classrooms the user can currently access; mutate it to simulate access loss. */
  classrooms: Set<string>;
}

export interface RecordedCall {
  path: string;
  body: Record<string, unknown>;
}

export interface StubApi {
  server: HttpServer;
  url: string;
  users: Map<string, StubUser>;
  calls: RecordedCall[];
  /** Replies to the internal endpoints; set `connectedTimeStatus` to simulate a failure. */
  connectedTimeStatus: number;
  /** Forces the reverification endpoint to answer with this status. */
  reverificationStatus: number | undefined;
  /** When set, the reverification endpoint answers only once this settles (request still recorded). */
  reverificationGate: Promise<unknown> | undefined;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });

/** Stand-in for the NestJS internal endpoints, driven by an in-memory user table. */
export async function startStubApi(users: StubUser[]): Promise<StubApi> {
  const byToken = new Map(users.map((user) => [user.token, user]));
  // One account can have several sessions (logins), each with its own token and session id.
  const bySession = (userId: string, sessionId: unknown) =>
    users.find((user) => user.userId === userId && user.sessionId === sessionId);
  const calls: RecordedCall[] = [];

  const stub: StubApi = {
    server: undefined as unknown as HttpServer,
    url: '',
    users: new Map(users.map((user) => [user.userId, user])),
    calls,
    connectedTimeStatus: 204,
    reverificationStatus: undefined,
    reverificationGate: undefined,
    close: () => new Promise((resolve) => stub.server.close(() => resolve())),
  };

  const identity = (user: StubUser, classroomId: string) => ({
    userId: user.userId,
    sessionId: user.sessionId,
    classroomId,
    role: user.role,
    displayName: user.displayName,
    appearance: user.appearance,
  });

  stub.server = createServer((req, res) => {
    void readBody(req).then(async (body) => {
      const path = req.url ?? '';
      calls.push({ path, body });
      const reply = (status: number, payload: unknown = {}) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(status === 204 ? undefined : JSON.stringify(payload));
      };
      if (req.headers['x-internal-service-secret'] !== STUB_SECRET) return reply(401);

      const classroomId = String(body.classroomId);
      if (path === '/internal/realtime/join-verification') {
        const user = byToken.get(String(body.accessToken));
        return user?.classrooms.has(classroomId)
          ? reply(200, identity(user, classroomId))
          : reply(401);
      }
      if (path === '/internal/realtime/access-reverification') {
        await stub.reverificationGate;
        if (stub.reverificationStatus !== undefined) return reply(stub.reverificationStatus);
        const user = bySession(String(body.userId), body.sessionId);
        return user?.classrooms.has(classroomId)
          ? reply(200, identity(user, classroomId))
          : reply(401);
      }
      if (path === '/internal/realtime/connected-time') return reply(stub.connectedTimeStatus);
      return reply(404);
    });
  });

  await new Promise<void>((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
  stub.url = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
  return stub;
}

export const makeUser = (name: string, index: number, classrooms: string[]): StubUser => ({
  token: `token-${name}`,
  userId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  sessionId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  role: 'STUDENT',
  displayName: name,
  appearance: makeStubAppearance(),
  classrooms: new Set(classrooms),
});
