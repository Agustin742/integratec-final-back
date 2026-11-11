import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { OutboxWriter } from '../outbox/outbox.writer';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import { HttpRealtimeEvictionClient, RealtimeEvictionError } from './realtime-eviction.client';
import { RealtimeEvictionHandler } from './realtime-eviction.handler';
import { RealtimeEventsModule } from './realtime-events.module';
import {
  REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
  REALTIME_SESSIONS_REVOKED_EVENT,
} from './realtime-events';

const SECRET = 'synthetic-internal-secret-for-auth-specs-0000';
const USER = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const SESSION = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';

const envelope = (type: string, payload: object): OutboxEventEnvelope => ({
  id: '11111111-1111-4111-8111-111111111111',
  type,
  payload,
  occurredAt: new Date(),
});

describe('HttpRealtimeEvictionClient', () => {
  const make = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
    new HttpRealtimeEvictionClient({
      baseUrl: 'http://realtime.internal:2567/',
      serviceSecret: SECRET,
      timeoutMs,
      fetchImpl,
    });

  it('posts the eviction with the service secret header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await make(fetchImpl).evict({ userId: USER, classroomId: CLASSROOM });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://realtime.internal:2567/internal/evictions');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-internal-service-secret')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({ userId: USER, classroomId: CLASSROOM });
  });

  it.each([400, 401, 404, 500, 503])(
    'fails on a %i response so the outbox retries',
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
      await expect(make(fetchImpl).evict({ userId: USER })).rejects.toBeInstanceOf(
        RealtimeEvictionError,
      );
    },
  );

  it('fails without echoing the cause when the realtime server is unreachable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`ECONNREFUSED ${SECRET}`));
    const error = (await make(fetchImpl)
      .evict({ userId: USER })
      .catch((e: unknown) => e)) as Error;

    expect(error).toBeInstanceOf(RealtimeEvictionError);
    expect(error.message).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  it('aborts the request when the realtime server does not answer in time', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    await expect(make(fetchImpl, 20).evict({ userId: USER })).rejects.toBeInstanceOf(
      RealtimeEvictionError,
    );
    expect(signal?.aborted).toBe(true);
  });
});

describe('RealtimeEvictionHandler', () => {
  const makeHandler = () => {
    const client = { evict: vi.fn().mockResolvedValue(undefined) };
    const registry = new OutboxHandlerRegistry();
    const handler = new RealtimeEvictionHandler(registry, client);
    handler.onModuleInit();
    return { client, registry };
  };
  const run = (registry: OutboxHandlerRegistry, event: OutboxEventEnvelope) =>
    Promise.all(registry.handlersFor(event.type).map((h) => h(event)));

  it('registers for both eviction event types', () => {
    const { registry } = makeHandler();
    expect(registry.handlersFor(REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT)).toHaveLength(1);
    expect(registry.handlersFor(REALTIME_SESSIONS_REVOKED_EVENT)).toHaveLength(1);
  });

  it('evicts the user from the classroom whose access was revoked', async () => {
    const { client, registry } = makeHandler();
    await run(
      registry,
      envelope(REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, { userId: USER, classroomId: CLASSROOM }),
    );
    expect(client.evict).toHaveBeenCalledExactlyOnceWith({ userId: USER, classroomId: CLASSROOM });
  });

  it('evicts the connections of the revoked session from every classroom', async () => {
    const { client, registry } = makeHandler();
    await run(
      registry,
      envelope(REALTIME_SESSIONS_REVOKED_EVENT, { userId: USER, sessionId: SESSION }),
    );
    expect(client.evict).toHaveBeenCalledExactlyOnceWith({ userId: USER, sessionId: SESSION });
  });

  it('evicts every connection of the user when all sessions were revoked', async () => {
    const { client, registry } = makeHandler();
    await run(registry, envelope(REALTIME_SESSIONS_REVOKED_EVENT, { userId: USER }));
    expect(client.evict).toHaveBeenCalledExactlyOnceWith({ userId: USER });
  });

  it.each([
    ['a missing userId', REALTIME_SESSIONS_REVOKED_EVENT, {}],
    ['a malformed userId', REALTIME_SESSIONS_REVOKED_EVENT, { userId: 'x' }],
    ['a missing classroomId', REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, { userId: USER }],
    ['a non-object payload', REALTIME_SESSIONS_REVOKED_EVENT, 'x'],
  ])('rejects %s without calling the realtime server', async (_label, type, payload) => {
    const { client, registry } = makeHandler();
    await expect(run(registry, envelope(type, payload as object))).rejects.toThrow();
    expect(client.evict).not.toHaveBeenCalled();
  });

  it('lets a delivery failure propagate so the outbox retries', async () => {
    const { client, registry } = makeHandler();
    client.evict.mockRejectedValue(new RealtimeEvictionError());
    await expect(
      run(registry, envelope(REALTIME_SESSIONS_REVOKED_EVENT, { userId: USER })),
    ).rejects.toBeInstanceOf(RealtimeEvictionError);
  });
});

describe('Outbox to realtime eviction (integration)', () => {
  let realtime: Server;
  let received: { path: string; secret: unknown; body: unknown }[] = [];
  let realtimeStatus = 204;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let outbox: OutboxWriter;

  beforeAll(async () => {
    realtime = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        received.push({
          path: req.url ?? '',
          secret: req.headers['x-internal-service-secret'],
          body: JSON.parse(raw) as unknown,
        });
        res.writeHead(realtimeStatus).end();
      });
    });
    await new Promise<void>((resolve) => realtime.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(realtime.address() as AddressInfo).port}`;
    const moduleRef = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(authTestConfig({ realtimeInternalUrl: url })),
        PrismaModule,
        RealtimeEventsModule,
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    dispatcher = moduleRef.get(OutboxDispatcher);
    outbox = moduleRef.get(OutboxWriter);
  });

  beforeEach(async () => {
    received = [];
    realtimeStatus = 204;
    // Only this suite's event types may be pending, or dispatching would deliver strangers' rows.
    await prisma.outboxEvent.deleteMany({
      where: {
        type: { in: [REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, REALTIME_SESSIONS_REVOKED_EVENT] },
      },
    });
  });

  afterAll(async () => {
    await prisma?.outboxEvent.deleteMany({
      where: {
        type: { in: [REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, REALTIME_SESSIONS_REVOKED_EVENT] },
      },
    });
    await new Promise((resolve) => realtime.close(resolve));
  });

  const dispatch = () =>
    dispatcher.dispatchPending(50, new Date(), [
      REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
      REALTIME_SESSIONS_REVOKED_EVENT,
    ]);

  it('delivers a recorded event to the realtime server with the service secret', async () => {
    await prisma.$transaction((tx) =>
      outbox.record(tx, {
        type: REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
        payload: { userId: USER, classroomId: CLASSROOM },
      }),
    );

    await expect(dispatch()).resolves.toMatchObject({ delivered: 1, retried: 0 });

    expect(received).toEqual([
      {
        path: '/internal/evictions',
        secret: SECRET,
        body: { userId: USER, classroomId: CLASSROOM },
      },
    ]);
  });

  it('retries the event when the realtime server is unavailable and delivers it later', async () => {
    realtimeStatus = 503;
    await prisma.$transaction((tx) =>
      outbox.record(tx, { type: REALTIME_SESSIONS_REVOKED_EVENT, payload: { userId: USER } }),
    );

    await expect(dispatch()).resolves.toMatchObject({ delivered: 0, retried: 1 });

    realtimeStatus = 204;
    const later = new Date(Date.now() + 3_600_000);
    await expect(
      dispatcher.dispatchPending(50, later, [REALTIME_SESSIONS_REVOKED_EVENT]),
    ).resolves.toMatchObject({ delivered: 1 });
    expect(received).toHaveLength(2);
  });
});
