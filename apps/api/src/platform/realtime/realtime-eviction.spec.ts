import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { OutboxWriter } from '../outbox/outbox.writer';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import { HttpRealtimeEvictionClient, RealtimeEvictionError } from './realtime-eviction.client';
import { EVICTION_MAX_ATTEMPTS, RealtimeEvictionHandler } from './realtime-eviction.handler';
import { RealtimeEventsModule } from './realtime-events.module';
import {
  CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
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
    'fails on a %i response, keeping the status, so the outbox retries',
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
      const error = (await make(fetchImpl)
        .evict({ userId: USER })
        .catch((e: unknown) => e)) as RealtimeEvictionError;

      expect(error).toBeInstanceOf(RealtimeEvictionError);
      expect(error).toMatchObject({ kind: 'http', status });
      expect(error.message).toBe(`realtime eviction failed: http ${status}`);
    },
  );

  it('fails as unreachable, without echoing the cause, when the realtime server refuses', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`ECONNREFUSED ${SECRET}`));
    const error = (await make(fetchImpl)
      .evict({ userId: USER })
      .catch((e: unknown) => e)) as RealtimeEvictionError;

    expect(error).toBeInstanceOf(RealtimeEvictionError);
    expect(error).toMatchObject({ kind: 'unreachable', status: undefined });
    expect(error.message).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  it('aborts the request and reports a timeout when the realtime server does not answer', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    await expect(make(fetchImpl, 20).evict({ userId: USER })).rejects.toMatchObject({
      name: 'RealtimeEvictionError',
      kind: 'timeout',
    });
    expect(signal?.aborted).toBe(true);
  });

  describe('failure log', () => {
    afterEach(() => vi.restoreAllMocks());

    const cases: [string, () => Promise<Response>, string, number | undefined][] = [
      ['a non-2xx answer', () => Promise.resolve(new Response('{}', { status: 401 })), 'http', 401],
      [
        'a refused connection',
        () => Promise.reject(new TypeError('ECONNREFUSED')),
        'unreachable',
        undefined,
      ],
    ];
    it.each(cases)(
      'logs the kind and status for %s, with no identifier or secret',
      async (_label, impl, kind, status) => {
        const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

        await make(vi.fn(impl) as unknown as typeof fetch)
          .evict({ userId: USER, classroomId: CLASSROOM, sessionId: SESSION })
          .catch(() => undefined);

        expect(warn).toHaveBeenCalledExactlyOnceWith({
          operation: 'realtime.eviction.failed',
          kind,
          ...(status === undefined ? {} : { status }),
        });
        const logged = JSON.stringify(warn.mock.calls);
        for (const sensitive of [USER, CLASSROOM, SESSION, SECRET]) {
          expect(logged).not.toContain(sensitive);
        }
      },
    );

    it('logs nothing when the eviction is accepted', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await make(vi.fn().mockResolvedValue(new Response(null, { status: 204 }))).evict({
        userId: USER,
      });
      expect(warn).not.toHaveBeenCalled();
    });
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

  it('evicts a removed student from the classroom from the membership removal event', async () => {
    const { client, registry } = makeHandler();
    expect(registry.handlersFor(CLASSROOM_MEMBERSHIP_REMOVED_EVENT)).toHaveLength(1);
    await run(
      registry,
      envelope(CLASSROOM_MEMBERSHIP_REMOVED_EVENT, {
        classroomId: CLASSROOM,
        membershipId: SESSION,
        userId: USER,
      }),
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
    ['a removal without a classroomId', CLASSROOM_MEMBERSHIP_REMOVED_EVENT, { userId: USER }],
    ['a non-object payload', REALTIME_SESSIONS_REVOKED_EVENT, 'x'],
  ])('rejects %s without calling the realtime server', async (_label, type, payload) => {
    const { client, registry } = makeHandler();
    await expect(run(registry, envelope(type, payload as object))).rejects.toThrow();
    expect(client.evict).not.toHaveBeenCalled();
  });

  it('gives every eviction event type a longer retry budget than the default', () => {
    const { registry } = makeHandler();
    for (const type of [
      REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
      REALTIME_SESSIONS_REVOKED_EVENT,
      CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
    ]) {
      expect(registry.retryPolicyFor(type).maxAttempts).toBe(EVICTION_MAX_ATTEMPTS);
    }
    expect(EVICTION_MAX_ATTEMPTS).toBeGreaterThan(5);
  });

  it('logs loudly, without identifiers, when an eviction is given up on', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registry } = makeHandler();
    const event = envelope(REALTIME_SESSIONS_REVOKED_EVENT, { userId: USER, sessionId: SESSION });

    registry.retryPolicyFor(event.type).onExhausted?.(event);

    expect(error).toHaveBeenCalledExactlyOnceWith({
      operation: 'realtime.eviction.undelivered',
      eventId: event.id,
      type: event.type,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(USER);
    error.mockRestore();
  });

  it('lets a delivery failure propagate so the outbox retries', async () => {
    const { client, registry } = makeHandler();
    client.evict.mockRejectedValue(new RealtimeEvictionError('http', 503));
    await expect(
      run(registry, envelope(REALTIME_SESSIONS_REVOKED_EVENT, { userId: USER })),
    ).rejects.toBeInstanceOf(RealtimeEvictionError);
  });
});

describe('Outbox to realtime eviction (integration)', () => {
  let realtime: Server;
  let received: { path: string; secret: unknown; body: { userId?: string } }[] = [];
  let realtimeStatus = 204;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let outbox: OutboxWriter;
  /** Unique per test: other spec files write the same event types into the shared database. */
  let user: string;

  beforeAll(async () => {
    realtime = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        received.push({
          path: req.url ?? '',
          secret: req.headers['x-internal-service-secret'],
          body: JSON.parse(raw) as { userId?: string },
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

  beforeEach(() => {
    received = [];
    realtimeStatus = 204;
    user = randomUUID();
  });

  // Only this test's own rows are removed: a type-wide delete would race with the other suites.
  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: ownRows(user) });
  });

  afterAll(async () => {
    await new Promise((resolve) => realtime.close(resolve));
  });

  const ownRows = (userId: string) => ({
    type: {
      in: [
        REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
        REALTIME_SESSIONS_REVOKED_EVENT,
        CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
      ],
    },
    payload: { path: ['userId'], equals: userId },
  });
  const ownRow = () => prisma.outboxEvent.findFirstOrThrow({ where: ownRows(user) });
  /** What the stub received for this test's user; strangers' events may pass through it too. */
  const ownReceived = () => received.filter((call) => call.body.userId === user);
  const record = (type: string, payload: object) =>
    prisma.$transaction((tx) => outbox.record(tx, { type, payload }));

  const dispatch = (now = new Date()) =>
    dispatcher.dispatchPending(50, now, [
      REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT,
      REALTIME_SESSIONS_REVOKED_EVENT,
      CLASSROOM_MEMBERSHIP_REMOVED_EVENT,
    ]);

  it('delivers a recorded event to the realtime server with the service secret', async () => {
    await record(REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, { userId: user, classroomId: CLASSROOM });

    await dispatch();

    expect(ownReceived()).toEqual([
      {
        path: '/internal/evictions',
        secret: SECRET,
        body: { userId: user, classroomId: CLASSROOM },
      },
    ]);
    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('is not disturbed by a pending event of another user in the same table', async () => {
    const stranger = randomUUID();
    await record(REALTIME_SESSIONS_REVOKED_EVENT, { userId: stranger });
    await record(REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT, { userId: user, classroomId: CLASSROOM });

    try {
      await dispatch();

      expect(ownReceived()).toHaveLength(1);
      expect((await ownRow()).processedAt).not.toBeNull();
    } finally {
      await prisma.outboxEvent.deleteMany({ where: ownRows(stranger) });
    }
  });

  it('evicts a removed student: the event ClassroomRemovalService records reaches the realtime server', async () => {
    await record(CLASSROOM_MEMBERSHIP_REMOVED_EVENT, {
      classroomId: CLASSROOM,
      membershipId: SESSION,
      userId: user,
    });

    await dispatch();

    expect(ownReceived().map((call) => call.body)).toEqual([
      { userId: user, classroomId: CLASSROOM },
    ]);
    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('retries the event when the realtime server is unavailable and delivers it later', async () => {
    realtimeStatus = 503;
    await record(REALTIME_SESSIONS_REVOKED_EVENT, { userId: user });

    await dispatch();
    expect(ownReceived()).toHaveLength(1);
    const failed = await ownRow();
    expect(failed).toMatchObject({ attempts: 1, processedAt: null, failedAt: null });
    expect(failed.lastError).toBe('RealtimeEvictionError: realtime eviction failed: http 503');

    realtimeStatus = 204;
    await dispatch(new Date(Date.now() + 3_600_000));

    expect(ownReceived()).toHaveLength(2);
    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('keeps retrying past the default attempt budget before giving up', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    realtimeStatus = 503;
    await record(REALTIME_SESSIONS_REVOKED_EVENT, { userId: user });

    let at = new Date();
    for (let attempt = 1; attempt <= EVICTION_MAX_ATTEMPTS; attempt += 1) {
      await dispatch(at);
      const row = await ownRow();
      expect(row.failedAt === null).toBe(attempt < EVICTION_MAX_ATTEMPTS);
      at = new Date(Math.max(at.getTime(), row.availableAt.getTime()));
    }

    expect(ownReceived()).toHaveLength(EVICTION_MAX_ATTEMPTS);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'realtime.eviction.undelivered' }),
    );
    vi.restoreAllMocks();
  });
});
