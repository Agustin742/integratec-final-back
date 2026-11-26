import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from '../outbox/outbox.registry';
import { REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT } from './realtime-events';
import {
  HttpRealtimeTutorBotSkinClient,
  RealtimeTutorBotSkinError,
} from './realtime-tutor-bot-skin.client';
import {
  RealtimeTutorBotSkinHandler,
  TUTOR_BOT_SKIN_MAX_ATTEMPTS,
} from './realtime-tutor-bot-skin.handler';

const SECRET = 'synthetic-internal-secret-for-auth-specs-0000';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const REQUEST = { classroomId: CLASSROOM, tutorBotSkin: 'boca', tutorBotSkinRevision: 3 } as const;

const envelope = (payload: object): OutboxEventEnvelope => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT,
  payload: payload as OutboxEventEnvelope['payload'],
  occurredAt: new Date(),
});

afterEach(() => vi.restoreAllMocks());

describe('HttpRealtimeTutorBotSkinClient', () => {
  const make = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
    new HttpRealtimeTutorBotSkinClient({
      baseUrl: 'http://realtime.internal:2567/',
      serviceSecret: SECRET,
      timeoutMs,
      fetchImpl,
    });

  it('posts the skin and its revision with the service secret header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await make(fetchImpl).applyTutorBotSkin(REQUEST);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://realtime.internal:2567/internal/classroom-tutor-bot-skin');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('x-internal-service-secret')).toBe(SECRET);
    expect(JSON.parse(init.body as string)).toEqual(REQUEST);
  });

  it('fails with the status and logs no identifier or secret, so the outbox retries', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await expect(
      make(vi.fn().mockResolvedValue(new Response('{}', { status: 503 }))).applyTutorBotSkin(
        REQUEST,
      ),
    ).rejects.toMatchObject({ name: 'RealtimeTutorBotSkinError', kind: 'http', status: 503 });

    expect(warn).toHaveBeenCalledExactlyOnceWith({
      operation: 'realtime.tutor-bot-skin.failed',
      kind: 'http',
      status: 503,
    });
  });

  it('reports unreachable without echoing the cause', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = (await make(vi.fn().mockRejectedValue(new TypeError(`refused ${SECRET}`)))
      .applyTutorBotSkin(REQUEST)
      .catch((e: unknown) => e)) as RealtimeTutorBotSkinError;

    expect(error).toMatchObject({ kind: 'unreachable', status: undefined });
    expect(error.message).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  it('aborts and reports a timeout when the realtime server does not answer', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(make(fetchImpl, 20).applyTutorBotSkin(REQUEST)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });
});

describe('RealtimeTutorBotSkinHandler', () => {
  const makeHandler = () => {
    const client = { applyTutorBotSkin: vi.fn().mockResolvedValue(undefined) };
    const registry = new OutboxHandlerRegistry();
    new RealtimeTutorBotSkinHandler(registry, client).onModuleInit();
    return { client, registry };
  };
  const run = (registry: OutboxHandlerRegistry, payload: object) =>
    Promise.all(
      registry
        .handlersFor(REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT)
        .map((h) => h(envelope(payload))),
    );

  it('sends the committed skin to the realtime server', async () => {
    const { client, registry } = makeHandler();
    await run(registry, REQUEST);
    expect(client.applyTutorBotSkin).toHaveBeenCalledExactlyOnceWith(REQUEST);
  });

  it.each([
    ['a malformed classroomId', { ...REQUEST, classroomId: 'x' }],
    ['an unknown skin', { ...REQUEST, tutorBotSkin: 'river' }],
    ['a negative revision', { ...REQUEST, tutorBotSkinRevision: -1 }],
    ['a missing revision', { classroomId: CLASSROOM, tutorBotSkin: 'boca' }],
  ])('rejects %s without calling the realtime server', async (_label, payload) => {
    const { client, registry } = makeHandler();
    await expect(run(registry, payload)).rejects.toThrow();
    expect(client.applyTutorBotSkin).not.toHaveBeenCalled();
  });

  it('uses the long retry budget and logs when it is exhausted', () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registry } = makeHandler();
    const event = envelope(REQUEST);

    const policy = registry.retryPolicyFor(REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT);
    policy.onExhausted?.(event);

    expect(policy.maxAttempts).toBe(TUTOR_BOT_SKIN_MAX_ATTEMPTS);
    expect(error).toHaveBeenCalledExactlyOnceWith({
      operation: 'realtime.tutor-bot-skin.undelivered',
      eventId: event.id,
      type: event.type,
    });
  });
});
