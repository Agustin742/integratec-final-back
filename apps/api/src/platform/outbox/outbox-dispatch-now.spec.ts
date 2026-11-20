import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import { OutboxDispatcher } from './outbox.dispatcher';
import type { OutboxHandlerRegistry } from './outbox.registry';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const TYPE = 'realtime.chat.message.created';

const make = () => new OutboxDispatcher({} as PrismaService, {} as OutboxHandlerRegistry);

describe('OutboxDispatcher.dispatchNow', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dispatches exactly the given event, filtered by type and id', async () => {
    const dispatcher = make();
    const spy = vi
      .spyOn(dispatcher, 'dispatchPending')
      .mockResolvedValue({ delivered: 1, retried: 0, exhausted: 0 });

    dispatcher.dispatchNow(TYPE, EVENT_ID);
    await dispatcher.onModuleDestroy();

    expect(spy).toHaveBeenCalledTimes(1);
    const [batchSize, now, types, eventIds] = spy.mock.calls[0]!;
    expect(batchSize).toBe(1);
    expect(now).toBeInstanceOf(Date);
    expect(types).toEqual([TYPE]);
    expect(eventIds).toEqual([EVENT_ID]);
  });

  it('never throws or rejects, and logs only the operation, type and error name', async () => {
    const dispatcher = make();
    vi.spyOn(dispatcher, 'dispatchPending').mockRejectedValue(
      new TypeError('connection string postgres://secret'),
    );
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    expect(() => dispatcher.dispatchNow(TYPE, EVENT_ID)).not.toThrow();
    await expect(dispatcher.onModuleDestroy()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith({
      operation: 'outbox.dispatch.now',
      type: TYPE,
      errorName: 'TypeError',
    });
  });

  it('waits for in-flight kicks on shutdown', async () => {
    const dispatcher = make();
    let release!: () => void;
    let finished = false;
    vi.spyOn(dispatcher, 'dispatchPending').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => {
            finished = true;
            resolve({ delivered: 1, retried: 0, exhausted: 0 });
          };
        }),
    );

    dispatcher.dispatchNow(TYPE, EVENT_ID);
    const destroyed = dispatcher.onModuleDestroy();
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await destroyed;
    expect(finished).toBe(true);
  });
});
