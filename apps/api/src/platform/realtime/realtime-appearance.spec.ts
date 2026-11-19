import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { MemberAppearance } from '@aula/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { OutboxWriter } from '../outbox/outbox.writer';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  HttpRealtimeAppearanceClient,
  RealtimeAppearanceError,
} from './realtime-appearance.client';
import { APPEARANCE_MAX_ATTEMPTS, RealtimeAppearanceHandler } from './realtime-appearance.handler';
import { RealtimeEventsModule } from './realtime-events.module';
import { REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT } from './realtime-events';

const SECRET = 'synthetic-internal-secret-for-auth-specs-0000';
const USER = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';

/** Public appearance payload, shaped exactly as `memberAppearanceSchema` allows. */
const APPEARANCE: MemberAppearance = {
  baseAvatar: {
    bodyId: 'female',
    hairId: 'afro',
    topId: 'tshirt',
    hairColor: '#AF6D63',
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
};

const envelope = (payload: object): OutboxEventEnvelope => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT,
  payload: payload as OutboxEventEnvelope['payload'],
  occurredAt: new Date(),
});

describe('HttpRealtimeAppearanceClient', () => {
  const make = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
    new HttpRealtimeAppearanceClient({
      baseUrl: 'http://realtime.internal:2567/',
      serviceSecret: SECRET,
      timeoutMs,
      fetchImpl,
    });

  it('posts the appearance change with the service secret header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await make(fetchImpl).applyAppearance({
      classroomId: CLASSROOM,
      userId: USER,
      appearance: APPEARANCE,
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://realtime.internal:2567/internal/appearance');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-internal-service-secret')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual({
      classroomId: CLASSROOM,
      userId: USER,
      appearance: APPEARANCE,
    });
  });

  it.each([400, 401, 404, 500, 503])(
    'fails on a %i response, keeping the status, so the outbox retries',
    async (status) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
      const error = (await make(fetchImpl)
        .applyAppearance({ classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE })
        .catch((e: unknown) => e)) as RealtimeAppearanceError;

      expect(error).toBeInstanceOf(RealtimeAppearanceError);
      expect(error).toMatchObject({ kind: 'http', status });
      expect(error.message).toBe(`realtime appearance failed: http ${status}`);
    },
  );

  it('fails as unreachable, without echoing the cause, when the realtime server refuses', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`ECONNREFUSED ${SECRET}`));
    const error = (await make(fetchImpl)
      .applyAppearance({ classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE })
      .catch((e: unknown) => e)) as RealtimeAppearanceError;

    expect(error).toBeInstanceOf(RealtimeAppearanceError);
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

    await expect(
      make(fetchImpl, 20).applyAppearance({
        classroomId: CLASSROOM,
        userId: USER,
        appearance: APPEARANCE,
      }),
    ).rejects.toMatchObject({ name: 'RealtimeAppearanceError', kind: 'timeout' });
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
          .applyAppearance({ classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE })
          .catch(() => undefined);

        expect(warn).toHaveBeenCalledExactlyOnceWith({
          operation: 'realtime.appearance.failed',
          kind,
          ...(status === undefined ? {} : { status }),
        });
        const logged = JSON.stringify(warn.mock.calls);
        for (const sensitive of [USER, CLASSROOM, SECRET]) {
          expect(logged).not.toContain(sensitive);
        }
      },
    );

    it('logs nothing when the appearance change is accepted', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      await make(vi.fn().mockResolvedValue(new Response(null, { status: 204 }))).applyAppearance({
        classroomId: CLASSROOM,
        userId: USER,
        appearance: APPEARANCE,
      });
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe('RealtimeAppearanceHandler', () => {
  const makeHandler = () => {
    const client = { applyAppearance: vi.fn().mockResolvedValue(undefined) };
    const registry = new OutboxHandlerRegistry();
    const handler = new RealtimeAppearanceHandler(registry, client);
    handler.onModuleInit();
    return { client, registry };
  };
  const run = (registry: OutboxHandlerRegistry, payload: object) =>
    Promise.all(
      registry
        .handlersFor(REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT)
        .map((h) => h(envelope(payload))),
    );

  it('registers for the appearance-changed event type', () => {
    const { registry } = makeHandler();
    expect(registry.handlersFor(REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT)).toHaveLength(1);
  });

  it('applies the appearance snapshot to the classroom it names', async () => {
    const { client, registry } = makeHandler();
    await run(registry, { classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE });
    expect(client.applyAppearance).toHaveBeenCalledExactlyOnceWith({
      classroomId: CLASSROOM,
      userId: USER,
      appearance: APPEARANCE,
    });
  });

  it.each([
    ['a missing userId', { classroomId: CLASSROOM, appearance: APPEARANCE }],
    ['a malformed userId', { classroomId: CLASSROOM, userId: 'x', appearance: APPEARANCE }],
    ['a missing classroomId', { userId: USER, appearance: APPEARANCE }],
    ['a malformed classroomId', { classroomId: 'x', userId: USER, appearance: APPEARANCE }],
    ['a missing appearance', { classroomId: CLASSROOM, userId: USER }],
    [
      'an appearance with a private extra field',
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearance: { ...APPEARANCE, email: 'leak@example.test' },
      },
    ],
    [
      'an equipped item whose slot does not match its items key',
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearance: {
          ...APPEARANCE,
          items: { ...APPEARANCE.items, face: { ...APPEARANCE.items.head!, slot: 'head' } },
        },
      },
    ],
    ['a non-object payload', 'x'],
  ])('rejects %s without calling the realtime server', async (_label, payload) => {
    const { client, registry } = makeHandler();
    await expect(run(registry, payload as object)).rejects.toThrow();
    expect(client.applyAppearance).not.toHaveBeenCalled();
  });

  it('gives the appearance event a longer retry budget than the default', () => {
    const { registry } = makeHandler();
    expect(registry.retryPolicyFor(REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT).maxAttempts).toBe(
      APPEARANCE_MAX_ATTEMPTS,
    );
    expect(APPEARANCE_MAX_ATTEMPTS).toBeGreaterThan(5);
  });

  it('logs loudly, without identifiers, when an appearance change is given up on', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registry } = makeHandler();
    const event = envelope({ classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE });

    registry.retryPolicyFor(event.type).onExhausted?.(event);

    expect(error).toHaveBeenCalledExactlyOnceWith({
      operation: 'realtime.appearance.undelivered',
      eventId: event.id,
      type: event.type,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain(USER);
    error.mockRestore();
  });

  it('lets a delivery failure propagate so the outbox retries', async () => {
    const { client, registry } = makeHandler();
    client.applyAppearance.mockRejectedValue(new RealtimeAppearanceError('http', 503));
    await expect(
      run(registry, { classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE }),
    ).rejects.toBeInstanceOf(RealtimeAppearanceError);
  });
});

describe('Outbox to realtime appearance (integration)', () => {
  let realtime: Server;
  let received: {
    path: string;
    secret: unknown;
    body: { userId?: string; classroomId?: string; appearance?: unknown };
  }[] = [];
  let realtimeStatus = 204;
  let prisma: PrismaService;
  let dispatcher: OutboxDispatcher;
  let outbox: OutboxWriter;
  /** Unique per test: other spec files write the same event types into the shared database. */
  let user: string;
  let eventIds: string[];

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
    eventIds = [];
  });

  // Only this test's own rows are removed: a type-wide delete would race with the other suites.
  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: ownRows(user) });
  });

  afterAll(async () => {
    await new Promise((resolve) => realtime.close(resolve));
  });

  const ownRows = (userId: string) => ({
    type: REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT,
    payload: { path: ['userId'], equals: userId },
  });
  const ownRow = () => prisma.outboxEvent.findFirstOrThrow({ where: ownRows(user) });
  const record = async (payload: object) => {
    const id = await prisma.$transaction((tx) =>
      outbox.record(tx, { type: REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT, payload }),
    );
    eventIds.push(id);
    return id;
  };

  const dispatch = (now = new Date()) =>
    dispatcher.dispatchPending(50, now, [REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT], eventIds);

  it('delivers a recorded event to the realtime server with the service secret', async () => {
    await record({ classroomId: CLASSROOM, userId: user, appearance: APPEARANCE });

    await dispatch();

    expect(received).toEqual([
      {
        path: '/internal/appearance',
        secret: SECRET,
        body: { classroomId: CLASSROOM, userId: user, appearance: APPEARANCE },
      },
    ]);
    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('retries the event when the realtime server is unavailable and delivers it later', async () => {
    realtimeStatus = 503;
    await record({ classroomId: CLASSROOM, userId: user, appearance: APPEARANCE });

    await dispatch();
    expect(received).toHaveLength(1);
    const failed = await ownRow();
    expect(failed).toMatchObject({ attempts: 1, processedAt: null, failedAt: null });
    expect(failed.lastError).toBe('RealtimeAppearanceError: realtime appearance failed: http 503');

    realtimeStatus = 204;
    await dispatch(new Date(Date.now() + 3_600_000));

    expect(received).toHaveLength(2);
    expect((await ownRow()).processedAt).not.toBeNull();
  });

  it('leaves no row behind when the recording transaction rolls back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.record(tx, {
          type: REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT,
          payload: { classroomId: CLASSROOM, userId: user, appearance: APPEARANCE },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    expect(await prisma.outboxEvent.count({ where: ownRows(user) })).toBe(0);
  });
});
