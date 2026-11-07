import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../config/api-config';
import type { AuthDataCleanupResult, AuthDataCleanupService } from './auth-data-cleanup.service';
import {
  AuthDataCleanupScheduler,
  AUTH_CLEANUP_STARTUP_DELAY_MS,
} from './auth-data-cleanup.scheduler';
import { authTestConfig } from './testing/auth-test-config';

const INTERVAL_SECONDS = 600;
const INTERVAL_MS = INTERVAL_SECONDS * 1000;
const result: AuthDataCleanupResult = { sessions: 3, refreshTokens: 5, passwordResetTokens: 2 };

describe('AuthDataCleanupScheduler', () => {
  let run: ReturnType<typeof vi.fn<AuthDataCleanupService['run']>>;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  const build = (nodeEnv: ApiConfig['nodeEnv'] = 'development') =>
    new AuthDataCleanupScheduler(
      { run } as unknown as AuthDataCleanupService,
      authTestConfig({ nodeEnv, authCleanupIntervalSeconds: INTERVAL_SECONDS }),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    run = vi.fn<AuthDataCleanupService['run']>().mockResolvedValue(result);
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('runs once shortly after startup and then at every interval', async () => {
    const scheduler = build();
    scheduler.onModuleInit();
    expect(run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);
    await scheduler.onModuleDestroy();
  });

  it('does not schedule anything when nodeEnv is test', async () => {
    const scheduler = build('test');
    scheduler.onModuleInit();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(run).not.toHaveBeenCalled();
    await scheduler.onModuleDestroy();
  });

  it('skips a tick while the previous run is still in progress', async () => {
    let finish: (value: AuthDataCleanupResult) => void = () => undefined;
    run.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const scheduler = build();
    scheduler.onModuleInit();

    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);

    finish(result);
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.onModuleDestroy();
  });

  it('swallows and logs a failing run, then keeps running', async () => {
    run.mockRejectedValueOnce(
      Object.assign(new Error('token=abc123 user@example.com'), {
        name: 'PrismaClientKnownRequestError',
      }),
    );
    const scheduler = build();
    scheduler.onModuleInit();

    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS);
    expect(error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).toContain('auth.cleanup');
    expect(logged).toContain('PrismaClientKnownRequestError');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('user@example.com');

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.onModuleDestroy();
  });

  it('logs the Prisma error code but never the message', async () => {
    run.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('msg with token abc', {
        code: 'P1001',
        clientVersion: 'x',
      }),
    );
    const scheduler = build();
    scheduler.onModuleInit();

    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toMatchObject({
      operation: 'auth.cleanup',
      errorName: 'PrismaClientKnownRequestError',
      errorCode: 'P1001',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('token abc');
    await scheduler.onModuleDestroy();
  });

  it('stops scheduling after destroy, including a pending startup run', async () => {
    const early = build();
    early.onModuleInit();
    await early.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS + INTERVAL_MS);
    expect(run).not.toHaveBeenCalled();

    const late = build();
    late.onModuleInit();
    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS);
    await late.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('logs only counts and the duration on success', async () => {
    const scheduler = build();
    scheduler.onModuleInit();
    await vi.advanceTimersByTimeAsync(AUTH_CLEANUP_STARTUP_DELAY_MS);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toEqual({
      operation: 'auth.cleanup',
      ...result,
      durationMs: expect.any(Number),
    });
    await scheduler.onModuleDestroy();
  });
});
