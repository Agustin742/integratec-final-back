import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export const STUB_SECRET = 'test-only-secret-with-at-least-32-characters';

export interface StubUser {
  token: string;
  userId: string;
  sessionId: string;
  role: 'OWNER' | 'ADMIN' | 'TEACHER' | 'STUDENT';
  displayName: string;
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
  const byUserId = new Map(users.map((user) => [user.userId, user]));
  const calls: RecordedCall[] = [];

  const stub: StubApi = {
    server: undefined as unknown as HttpServer,
    url: '',
    users: new Map(users.map((user) => [user.userId, user])),
    calls,
    connectedTimeStatus: 204,
    close: () => new Promise((resolve) => stub.server.close(() => resolve())),
  };

  const identity = (user: StubUser, classroomId: string) => ({
    userId: user.userId,
    sessionId: user.sessionId,
    classroomId,
    role: user.role,
    displayName: user.displayName,
  });

  stub.server = createServer((req, res) => {
    void readBody(req).then((body) => {
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
        const user = byUserId.get(String(body.userId));
        return user && user.sessionId === body.sessionId && user.classrooms.has(classroomId)
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
  classrooms: new Set(classrooms),
});
