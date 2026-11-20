import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_MESSAGE_EVENT, CHAT_MESSAGE_HIDDEN_EVENT } from '@aula/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import {
  HttpRealtimeChatBroadcastClient,
  RealtimeChatBroadcastError,
} from './realtime-chat.client';
import { CHAT_HIDDEN_MAX_ATTEMPTS, RealtimeChatEventHandler } from './realtime-chat.handler';
import {
  REALTIME_CHAT_MESSAGE_CREATED_EVENT,
  REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
} from './realtime-events';

const SECRET = 'synthetic-internal-secret-for-chat-specs-0000';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const MESSAGE = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const USER = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const MESSAGE_ROW = {
  id: MESSAGE,
  classroomId: CLASSROOM,
  authorId: USER,
  body: 'Persisted message',
  createdAt: new Date('2026-11-19T12:00:00.000Z'),
  hiddenAt: null,
};

const event = (type: string, payload: Prisma.JsonValue): OutboxEventEnvelope => ({
  id: '11111111-1111-4111-8111-111111111111',
  type,
  payload,
  occurredAt: new Date('2026-11-19T12:00:00.000Z'),
});

describe('HttpRealtimeChatBroadcastClient', () => {
  const make = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
    new HttpRealtimeChatBroadcastClient({
      baseUrl: 'http://realtime.internal:2567/',
      serviceSecret: SECRET,
      timeoutMs,
      fetchImpl,
    });

  it('posts the event with the shared internal service secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const payload = {
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_HIDDEN_EVENT,
      payload: { messageId: MESSAGE, hiddenAt: '2026-11-19T12:01:00.000Z' },
    } as const;

    await make(fetchImpl).broadcast(payload);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://realtime.internal:2567/internal/chat-events');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-internal-service-secret')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it.each([400, 401, 500, 503])('rejects HTTP %i so the outbox retries', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(
      make(fetchImpl).broadcast({
        classroomId: CLASSROOM,
        event: CHAT_MESSAGE_HIDDEN_EVENT,
        payload: { messageId: MESSAGE, hiddenAt: '2026-11-19T12:01:00.000Z' },
      }),
    ).rejects.toMatchObject({
      name: 'RealtimeChatBroadcastError',
      kind: 'http',
      status,
    });
  });

  it('does not expose message content, identifiers, or the secret in failure logs', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const body = 'private chat body';
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`${SECRET} ${body} ${MESSAGE}`));

    await expect(
      make(fetchImpl).broadcast({
        classroomId: CLASSROOM,
        event: CHAT_MESSAGE_EVENT,
        payload: {
          id: MESSAGE,
          classroomId: CLASSROOM,
          authorId: USER,
          body,
          mentionedUserIds: [],
          createdAt: '2026-11-19T12:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(RealtimeChatBroadcastError);

    const logged = JSON.stringify(warn.mock.calls);
    for (const sensitive of [SECRET, body, MESSAGE, USER, CLASSROOM]) {
      expect(logged).not.toContain(sensitive);
    }
    warn.mockRestore();
  });

  it('aborts a timed-out request and reports only a timeout kind', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    await expect(
      make(fetchImpl, 20).broadcast({
        classroomId: CLASSROOM,
        event: CHAT_MESSAGE_HIDDEN_EVENT,
        payload: { messageId: MESSAGE, hiddenAt: '2026-11-19T12:01:00.000Z' },
      }),
    ).rejects.toMatchObject({ name: 'RealtimeChatBroadcastError', kind: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });
});

describe('RealtimeChatEventHandler', () => {
  afterEach(() => vi.restoreAllMocks());

  const makeHandler = (hiddenAt: Date | null = null) => {
    const tx = {
      message: { findFirst: vi.fn().mockResolvedValue({ ...MESSAGE_ROW, hiddenAt }) },
      mention: {
        findMany: vi.fn().mockResolvedValue([{ mentionedUserId: USER }]),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    } as unknown as PrismaService;
    const registry = new OutboxHandlerRegistry();
    const realtime = { broadcast: vi.fn().mockResolvedValue(undefined) };
    const handler = new RealtimeChatEventHandler(registry, prisma, realtime);
    handler.onModuleInit();
    return { handler, registry, prisma, tx, realtime };
  };
  const run = (registry: OutboxHandlerRegistry, message: OutboxEventEnvelope) =>
    Promise.all(registry.handlersFor(message.type).map((registered) => registered(message)));

  it('registers both committed chat event types with retry behavior', () => {
    const { registry } = makeHandler();
    expect(registry.handlersFor(REALTIME_CHAT_MESSAGE_CREATED_EVENT)).toHaveLength(1);
    expect(registry.handlersFor(REALTIME_CHAT_MESSAGE_HIDDEN_EVENT)).toHaveLength(1);
    expect(
      registry.retryPolicyFor(REALTIME_CHAT_MESSAGE_CREATED_EVENT).maxAttempts,
    ).toBeUndefined();
  });

  it('gives hidden events a larger retry budget than the default', () => {
    const { registry } = makeHandler();
    expect(registry.retryPolicyFor(REALTIME_CHAT_MESSAGE_HIDDEN_EVENT).maxAttempts).toBe(
      CHAT_HIDDEN_MAX_ATTEMPTS,
    );
    expect(CHAT_HIDDEN_MAX_ATTEMPTS).toBeGreaterThan(5);
  });

  it('loads the committed message and mentions from PostgreSQL before broadcasting', async () => {
    const { registry, prisma, tx, realtime } = makeHandler();
    await run(
      registry,
      event(REALTIME_CHAT_MESSAGE_CREATED_EVENT, { classroomId: CLASSROOM, messageId: MESSAGE }),
    );

    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(tx.message.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { id: MESSAGE, classroomId: CLASSROOM },
      select: {
        id: true,
        classroomId: true,
        authorId: true,
        body: true,
        createdAt: true,
        hiddenAt: true,
      },
    });
    expect(tx.mention.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { sourceType: 'message', sourceId: MESSAGE },
      select: { mentionedUserId: true },
      orderBy: { mentionedUserId: 'asc' },
    });
    expect(realtime.broadcast).toHaveBeenCalledExactlyOnceWith({
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_EVENT,
      payload: {
        id: MESSAGE,
        classroomId: CLASSROOM,
        authorId: USER,
        body: MESSAGE_ROW.body,
        mentionedUserIds: [USER],
        createdAt: MESSAGE_ROW.createdAt.toISOString(),
      },
    });
  });

  it('does not broadcast a creation event if moderation committed before delivery', async () => {
    const { registry, tx, realtime } = makeHandler(new Date('2026-11-19T12:01:00.000Z'));
    await run(
      registry,
      event(REALTIME_CHAT_MESSAGE_CREATED_EVENT, { classroomId: CLASSROOM, messageId: MESSAGE }),
    );

    expect(tx.mention.findMany).not.toHaveBeenCalled();
    expect(realtime.broadcast).not.toHaveBeenCalled();
  });

  it('broadcasts the moderation notification without exposing staff-only audit fields', async () => {
    const { registry, prisma, realtime } = makeHandler();
    const hiddenAt = '2026-11-19T12:01:00.000Z';
    await run(
      registry,
      event(REALTIME_CHAT_MESSAGE_HIDDEN_EVENT, {
        classroomId: CLASSROOM,
        messageId: MESSAGE,
        hiddenAt,
      }),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(realtime.broadcast).toHaveBeenCalledExactlyOnceWith({
      classroomId: CLASSROOM,
      event: CHAT_MESSAGE_HIDDEN_EVENT,
      payload: { messageId: MESSAGE, hiddenAt },
    });
  });

  it('rejects invalid outbox data and propagates delivery failures for retry', async () => {
    const invalid = makeHandler();
    await expect(
      run(invalid.registry, event(REALTIME_CHAT_MESSAGE_CREATED_EVENT, { messageId: MESSAGE })),
    ).rejects.toThrow('invalid realtime chat event');
    expect(invalid.realtime.broadcast).not.toHaveBeenCalled();

    const unavailable = makeHandler();
    unavailable.realtime.broadcast.mockRejectedValue(new Error('realtime unavailable'));
    await expect(
      run(
        unavailable.registry,
        event(REALTIME_CHAT_MESSAGE_HIDDEN_EVENT, {
          classroomId: CLASSROOM,
          messageId: MESSAGE,
          hiddenAt: '2026-11-19T12:01:00.000Z',
        }),
      ),
    ).rejects.toThrow('realtime unavailable');
  });
});
