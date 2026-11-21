import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MAX_CLASSROOM_DESKS } from '@aula/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import { HttpRealtimeLayoutClient, RealtimeLayoutError } from './realtime-layout.client';
import { LAYOUT_MAX_ATTEMPTS, RealtimeLayoutHandler } from './realtime-layout.handler';
import { RealtimeEventsModule } from './realtime-events.module';
import { RealtimeEventsRecorder } from './realtime-events.recorder';
import { REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT } from './realtime-events';

const SECRET = 'synthetic-internal-secret-for-auth-specs-0000';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';

const envelope = (payload: object): OutboxEventEnvelope => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT,
  payload: payload as OutboxEventEnvelope['payload'],
  occurredAt: new Date(),
});

describe('HttpRealtimeLayoutClient', () => {
  const make = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
    new HttpRealtimeLayoutClient({
      baseUrl: 'http://realtime.internal:2567/',
      serviceSecret: SECRET,
      timeoutMs,
      fetchImpl,
    });

  it('posts the desk count with the service secret header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await make(fetchImpl).applyDeskCount({ classroomId: CLASSROOM, deskCount: 13 });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://realtime.internal:2567/internal/classroom-layout');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-internal-service-secret')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({ classroomId: CLASSROOM, deskCount: 13 });
  });

  it.each([400, 401, 404, 500, 503])(
    'fails on a %i response, keeping the status, so the outbox retries',
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
      const error = (await make(fetchImpl)
        .applyDeskCount({ classroomId: CLASSROOM, deskCount: 13 })
        .catch((e: unknown) => e)) as RealtimeLayoutError;

      expect(error).toBeInstanceOf(RealtimeLayoutError);
      expect(error).toMatchObject({ kind: 'http', status });
      expect(error.message).toBe(`realtime layout failed: http ${status}`);
    },
  );

  it('fails as unreachable, without echoing the cause, when the realtime server refuses', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`ECONNREFUSED ${SECRET}`));
    const error = (await make(fetchImpl)
      .applyDeskCount({ classroomId: CLASSROOM, deskCount: 13 })
      .catch((e: unknown) => e)) as RealtimeLayoutError;

    expect(error).toMatchObject({ kind: 'unreachable', status: undefined });
    expect(error.message).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  it('aborts the request and reports a timeout when the realtime server does not answer', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      make(fetchImpl, 20).applyDeskCount({ classroomId: CLASSROOM, deskCount: 13 }),
    ).rejects.toMatchObject({ name: 'RealtimeLayoutError', kind: 'timeout' });
  });

  it('logs the kind and status of a failure with no identifier or secret', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await make(vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
      .applyDeskCount({ classroomId: CLASSROOM, deskCount: 13 })
      .catch(() => undefined);

    expect(warn).toHaveBeenCalledExactlyOnceWith({
      operation: 'realtime.layout.failed',
      kind: 'http',
      status: 401,
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(CLASSROOM);
    warn.mockRestore();
  });
});

describe('RealtimeLayoutHandler', () => {
  const makeHandler = () => {
    const client = { applyDeskCount: vi.fn().mockResolvedValue(undefined) };
    const registry = new OutboxHandlerRegistry();
    const handler = new RealtimeLayoutHandler(registry, client);
    handler.onModuleInit();
    return { client, registry };
  };
  const run = (registry: OutboxHandlerRegistry, payload: object) =>
    Promise.all(
      registry
        .handlersFor(REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT)
        .map((h) => h(envelope(payload))),
    );

  it('registers for the layout-changed event type', () => {
    const { registry } = makeHandler();
    expect(registry.handlersFor(REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT)).toHaveLength(1);
  });

  it('sends the desk count to the classroom it names', async () => {
    const { client, registry } = makeHandler();
    await run(registry, { classroomId: CLASSROOM, deskCount: 13 });
    expect(client.applyDeskCount).toHaveBeenCalledExactlyOnceWith({
      classroomId: CLASSROOM,
      deskCount: 13,
    });
  });

  it.each([
    ['a missing classroomId', { deskCount: 13 }],
    ['a malformed classroomId', { classroomId: 'x', deskCount: 13 }],
    ['a missing deskCount', { classroomId: CLASSROOM }],
    ['a negative deskCount', { classroomId: CLASSROOM, deskCount: -1 }],
    ['a fractional deskCount', { classroomId: CLASSROOM, deskCount: 12.5 }],
    [
      'a deskCount over the maximum',
      { classroomId: CLASSROOM, deskCount: MAX_CLASSROOM_DESKS + 1 },
    ],
    ['a non-object payload', 'x'],
  ])('rejects %s without calling the realtime server', async (_label, payload) => {
    const { client, registry } = makeHandler();
    await expect(run(registry, payload as object)).rejects.toThrow();
    expect(client.applyDeskCount).not.toHaveBeenCalled();
  });

  it('gives the layout event a longer retry budget than the default and logs when exhausted', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registry } = makeHandler();
    const event = envelope({ classroomId: CLASSROOM, deskCount: 13 });

    const policy = registry.retryPolicyFor(REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT);
    policy.onExhausted?.(event);

    expect(policy.maxAttempts).toBe(LAYOUT_MAX_ATTEMPTS);
    expect(LAYOUT_MAX_ATTEMPTS).toBeGreaterThan(5);
    expect(error).toHaveBeenCalledExactlyOnceWith({
      operation: 'realtime.layout.undelivered',
      eventId: event.id,
      type: event.type,
    });
    error.mockRestore();
  });

  it('lets a delivery failure propagate so the outbox retries', async () => {
    const { client, registry } = makeHandler();
    client.applyDeskCount.mockRejectedValue(new RealtimeLayoutError('http', 503));
    await expect(run(registry, { classroomId: CLASSROOM, deskCount: 13 })).rejects.toBeInstanceOf(
      RealtimeLayoutError,
    );
  });
});

describe('Outbox to realtime layout (integration)', () => {
  let realtime: Server;
  let received: { path: string; secret: unknown; body: unknown }[] = [];
  let realtimeStatus = 204;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let recorder: RealtimeEventsRecorder;
  /** Unique per test: other spec files write the same event type into the shared database. */
  let classroomId: string;
  let eventIds: string[];

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
    recorder = moduleRef.get(RealtimeEventsRecorder);
  });

  beforeEach(() => {
    received = [];
    realtimeStatus = 204;
    classroomId = randomUUID();
    eventIds = [];
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: ownRows(classroomId) });
  });

  afterAll(async () => {
    await new Promise((resolve) => realtime.close(resolve));
  });

  const ownRows = (id: string) => ({
    type: REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT,
    payload: { path: ['classroomId'], equals: id },
  });
  const ownRow = () => prisma.outboxEvent.findFirstOrThrow({ where: ownRows(classroomId) });
  const dispatch = (now = new Date()) =>
    dispatcher.dispatchPending(50, now, [REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT], eventIds);
  const record = async () => {
    await prisma.$transaction((tx) =>
      recorder.recordClassroomLayoutChanged(tx, { classroomId, deskCount: 13 }),
    );
    eventIds.push((await ownRow()).id);
  };

  it('delivers a recorded event to the realtime server with the service secret', async () => {
    await record();

    await dispatch();

    expect(received).toEqual([
      {
        path: '/internal/classroom-layout',
        secret: SECRET,
        body: { classroomId, deskCount: 13 },
      },
    ]);
    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('retries the event when the realtime server is unavailable and delivers it later', async () => {
    realtimeStatus = 503;
    await record();

    await dispatch();
    const failed = await ownRow();
    expect(failed).toMatchObject({ attempts: 1, processedAt: null, failedAt: null });
    expect(failed.lastError).toBe('RealtimeLayoutError: realtime layout failed: http 503');

    realtimeStatus = 204;
    await dispatch(new Date(Date.now() + 3_600_000));

    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('leaves no row behind when the recording transaction rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await recorder.recordClassroomLayoutChanged(tx, { classroomId, deskCount: 13 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await prisma.outboxEvent.count({ where: ownRows(classroomId) })).toBe(0);
  });
});
