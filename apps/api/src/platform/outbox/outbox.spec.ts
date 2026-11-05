import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiConfigModule } from '../../config/config.module';
import type { ApiConfig } from '../../config/api-config';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { OutboxDispatcher, backoffMs } from './outbox.dispatcher';
import { OutboxHandlerRegistry, type OutboxEventEnvelope } from './outbox.registry';
import { OutboxModule } from './outbox.module';
import { OutboxWriter } from './outbox.writer';

const MAX_ATTEMPTS = 3;

// Same approach as prisma.spec.ts: tests read the database URL from the environment (CI sets it).
function testDatabaseUrl(): string {
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return (
    env?.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public'
  );
}

const config: ApiConfig = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: testDatabaseUrl(),
  accessTokenTtlSeconds: 1,
  refreshTokenTtlSeconds: 1,
  invitationTtlSeconds: 1,
  outboxPollIntervalSeconds: 1,
  outboxMaxAttempts: MAX_ATTEMPTS,
  internalServiceSecret: 'outbox-spec-placeholder-not-a-secret',
  allowedOrigins: ['http://localhost'],
};

describe('transactional outbox (integration, real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let writer: OutboxWriter;
  let registry: OutboxHandlerRegistry;
  let dispatcher: OutboxDispatcher;
  let type: string;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, OutboxModule],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    writer = moduleRef.get(OutboxWriter);
    registry = moduleRef.get(OutboxHandlerRegistry);
    dispatcher = moduleRef.get(OutboxDispatcher);
    // Rows left by an interrupted earlier run would be claimed ahead of this run's rows.
    await prisma.outboxEvent.deleteMany({ where: { type: { startsWith: 'spec.' } } });
    // Open a few connections up front so the concurrency test is not timing-sensitive.
    await Promise.all([1, 2, 3, 4].map(() => prisma.$queryRaw`SELECT 1`));
  }, 30_000);

  afterAll(() => moduleRef.close());

  // Each test uses its own event type, so rows and handlers never overlap.
  beforeEach(() => {
    type = `spec.${randomUUID()}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.outboxEvent.deleteMany({ where: { type } });
  });

  const record = (payload: Prisma.InputJsonObject = { classroomId: 'c-1' }) =>
    prisma.$transaction((tx) => writer.record(tx, { type, payload }));

  it('delivers a committed event exactly once', async () => {
    const received: OutboxEventEnvelope[] = [];
    registry.register(type, (event) => {
      received.push(event);
      return Promise.resolve();
    });

    await record({ classroomId: 'c-1' });
    const first = await dispatcher.dispatchPending();
    const second = await dispatcher.dispatchPending();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type, payload: { classroomId: 'c-1' } });
    expect(first).toMatchObject({ delivered: 1, retried: 0, exhausted: 0 });
    expect(second.delivered).toBe(0);
    const row = await prisma.outboxEvent.findFirstOrThrow({ where: { type } });
    expect(row.processedAt).not.toBeNull();
  });

  it('leaves no row and delivers nothing when the transaction rolls back', async () => {
    const handler = vi.fn(() => Promise.resolve());
    registry.register(type, handler);

    await expect(
      prisma.$transaction(async (tx) => {
        await writer.record(tx, { type, payload: { classroomId: 'c-2' } });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    await dispatcher.dispatchPending();

    expect(await prisma.outboxEvent.count({ where: { type } })).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('retries a failing handler with exponential backoff and stops after the max attempts', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const handler = vi.fn(() => Promise.reject(new Error('x'.repeat(1000))));
    registry.register(type, handler);
    await record();
    const t0 = new Date();

    const first = await dispatcher.dispatchPending(10, t0);
    expect(first).toMatchObject({ delivered: 0, retried: 1, exhausted: 0 });
    let row = await prisma.outboxEvent.findFirstOrThrow({ where: { type } });
    expect(row.attempts).toBe(1);
    expect(row.processedAt).toBeNull();
    expect(row.availableAt.getTime()).toBe(t0.getTime() + backoffMs(1));
    expect(row.lastError).toMatch(/^Error: x+$/);
    expect(row.lastError!.length).toBeLessThanOrEqual(300);

    // Not yet available: the handler is not called again.
    await dispatcher.dispatchPending(10, new Date(t0.getTime() + backoffMs(1) - 1));
    expect(handler).toHaveBeenCalledTimes(1);

    const t1 = new Date(t0.getTime() + backoffMs(1));
    await dispatcher.dispatchPending(10, t1);
    row = await prisma.outboxEvent.findFirstOrThrow({ where: { type } });
    expect(row.attempts).toBe(2);
    expect(row.availableAt.getTime()).toBe(t1.getTime() + backoffMs(2));
    expect(backoffMs(2)).toBe(backoffMs(1) * 2);

    const t2 = new Date(t1.getTime() + backoffMs(2));
    const last = await dispatcher.dispatchPending(10, t2);
    expect(last).toMatchObject({ retried: 0, exhausted: 1 });
    row = await prisma.outboxEvent.findFirstOrThrow({ where: { type } });
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    expect(row.failedAt).not.toBeNull();
    expect(row.processedAt).toBeNull();

    await dispatcher.dispatchPending(10, new Date(t2.getTime() + 365 * 24 * 3600 * 1000));
    expect(handler).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('delivers on a later attempt once the handler recovers', async () => {
    let calls = 0;
    registry.register(type, () =>
      ++calls === 1 ? Promise.reject(new Error('flaky')) : Promise.resolve(),
    );
    await record();
    const t0 = new Date();

    await dispatcher.dispatchPending(10, t0);
    const retry = await dispatcher.dispatchPending(10, new Date(t0.getTime() + backoffMs(1)));

    expect(retry.delivered).toBe(1);
    const row = await prisma.outboxEvent.findFirstOrThrow({ where: { type } });
    expect(row.processedAt).not.toBeNull();
    expect(row.failedAt).toBeNull();
  });

  it('treats an event with no registered handler as a failed attempt, never dropping it', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await record();

    const result = await dispatcher.dispatchPending();

    expect(result).toMatchObject({ delivered: 0, retried: 1 });
    const row = await prisma.outboxEvent.findFirstOrThrow({ where: { type } });
    expect(row.processedAt).toBeNull();
    expect(row.lastError).toContain('no handler');
    expect(warn).toHaveBeenCalled();
  });

  it('does not double-deliver when dispatchers run concurrently (SKIP LOCKED)', async () => {
    const other = new OutboxDispatcher(prisma, registry, config);
    const seen: string[] = [];
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    registry.register(type, async (event) => {
      seen.push(event.id);
      entered += 1;
      await gate;
    });
    for (let i = 0; i < 6; i += 1) await record({ n: i });

    const both = Promise.all([dispatcher.dispatchPending(3), other.dispatchPending(3)]);
    // Both dispatchers must hold a disjoint batch at the same time; a plain
    // FOR UPDATE would leave the second one blocked, so this would time out.
    await vi.waitFor(() => expect(entered).toBe(2), { timeout: 10_000 });
    release();
    const results = await both;

    expect(results.map((r) => r.delivered)).toEqual([3, 3]);
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  }, 20_000);

  it('logs structured diagnostics without payload contents', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    registry.register(type, () => Promise.reject(new Error('boom')));
    await record({ secret: 'student-private-note' });

    await dispatcher.dispatchPending();

    const logged = JSON.stringify([...log.mock.calls, ...error.mock.calls, ...warn.mock.calls]);
    expect(logged).toContain('outbox.dispatch');
    expect(logged).not.toContain('student-private-note');
  });
});

describe('OutboxDispatcher polling', () => {
  afterEach(() => vi.useRealTimers());

  const build = (nodeEnv: ApiConfig['nodeEnv'] | undefined) => {
    const dispatcher = new OutboxDispatcher(
      {} as PrismaService,
      new OutboxHandlerRegistry(),
      nodeEnv ? { ...config, nodeEnv } : undefined,
    );
    const dispatch = vi
      .spyOn(dispatcher, 'dispatchPending')
      .mockResolvedValue({ delivered: 0, retried: 0, exhausted: 0 });
    return { dispatcher, dispatch };
  };

  it('polls at the configured interval and stops on destroy', async () => {
    vi.useFakeTimers();
    const { dispatcher, dispatch } = build('development');

    dispatcher.onModuleInit();
    await vi.advanceTimersByTimeAsync(3000);
    expect(dispatch).toHaveBeenCalledTimes(3);

    await dispatcher.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(3000);
    expect(dispatch).toHaveBeenCalledTimes(3);
  });

  it.each(['test', undefined] as const)('does not poll when nodeEnv is %s', async (nodeEnv) => {
    vi.useFakeTimers();
    const { dispatcher, dispatch } = build(nodeEnv);

    dispatcher.onModuleInit();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(dispatch).not.toHaveBeenCalled();
    await dispatcher.onModuleDestroy();
  });
});
