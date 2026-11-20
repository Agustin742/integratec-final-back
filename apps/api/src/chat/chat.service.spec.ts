/* eslint-disable @typescript-eslint/no-explicit-any -- loose Prisma/service doubles */
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import type { MetricRecordingService } from '../metrics/metric-recording.service';
import type { NotificationRecorder } from '../notifications/notification-recorder.service';
import { OutboxDispatcher } from '../platform/outbox/outbox.dispatcher';
import type { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import {
  REALTIME_CHAT_MESSAGE_CREATED_EVENT,
  REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
} from '../platform/realtime/realtime-events';
import type { RealtimeEventsRecorder } from '../platform/realtime/realtime-events.recorder';
import type { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

const ACTOR = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const MESSAGE = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-19T12:00:00.000Z');

describe('ChatService post-commit realtime dispatch', () => {
  let committed: boolean;
  let kickedBeforeCommit: boolean;
  let tx: Record<string, any>;
  let dispatcher: { dispatchNow: ReturnType<typeof vi.fn> };
  let recorder: { recordChatMessageCreated: any; recordChatMessageHidden: any };
  let service: ChatService;

  const build = (dispatch: Pick<OutboxDispatcher, 'dispatchNow'>) => {
    const prisma = {
      $transaction: async (run: (client: unknown) => Promise<unknown>) => {
        const result = await run(tx);
        committed = true;
        return result;
      },
    } as unknown as PrismaService;
    const access = {
      verifyClassroomAccess: vi
        .fn()
        .mockResolvedValue({ myRole: 'STUDENT', classroom: { id: CLASSROOM } }),
      listActiveMentionCandidates: vi.fn().mockResolvedValue([]),
    } as unknown as AccessVerificationService;
    return new ChatService(
      prisma,
      access,
      { record: vi.fn() } as unknown as NotificationRecorder,
      { recordMessage: vi.fn() } as unknown as MetricRecordingService,
      recorder as unknown as RealtimeEventsRecorder,
      dispatch as OutboxDispatcher,
    );
  };

  beforeEach(() => {
    committed = false;
    kickedBeforeCommit = false;
    tx = {
      $queryRaw: vi.fn(),
      message: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({
          id: MESSAGE,
          authorId: ACTOR,
          body: 'hello',
          createdAt: NOW,
        }),
        findFirst: vi.fn().mockResolvedValue({ id: MESSAGE, hiddenAt: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      mention: { createMany: vi.fn() },
    };
    tx.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ chat_muted: false }])
      .mockResolvedValueOnce([{ now: NOW }]);
    recorder = {
      recordChatMessageCreated: vi.fn().mockResolvedValue(EVENT_ID),
      recordChatMessageHidden: vi.fn().mockResolvedValue(EVENT_ID),
    };
    dispatcher = {
      dispatchNow: vi.fn(() => {
        kickedBeforeCommit = !committed;
      }),
    };
    service = build(dispatcher);
  });

  afterEach(() => vi.restoreAllMocks());

  it('kicks the created event once, after the send transaction commits', async () => {
    const result = await service.send(ACTOR, CLASSROOM, 'hello');

    expect(result.id).toBe(MESSAGE);
    expect(dispatcher.dispatchNow).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatchNow).toHaveBeenCalledWith(
      REALTIME_CHAT_MESSAGE_CREATED_EVENT,
      EVENT_ID,
    );
    expect(kickedBeforeCommit).toBe(false);
  });

  it('does not kick when the send transaction fails', async () => {
    tx.message.create.mockRejectedValue(new Error('boom'));

    await expect(service.send(ACTOR, CLASSROOM, 'hello')).rejects.toThrow('boom');
    expect(dispatcher.dispatchNow).not.toHaveBeenCalled();
  });

  it('kicks the hidden event once, after the hide transaction commits', async () => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ now: NOW }]);

    await service.hide(ACTOR, CLASSROOM, MESSAGE);

    expect(dispatcher.dispatchNow).toHaveBeenCalledTimes(1);
    expect(dispatcher.dispatchNow).toHaveBeenCalledWith(
      REALTIME_CHAT_MESSAGE_HIDDEN_EVENT,
      EVENT_ID,
    );
    expect(kickedBeforeCommit).toBe(false);
  });

  it('does not kick when the message was already hidden', async () => {
    tx.message.findFirst.mockResolvedValue({ id: MESSAGE, hiddenAt: NOW });

    await service.hide(ACTOR, CLASSROOM, MESSAGE);

    expect(recorder.recordChatMessageHidden).not.toHaveBeenCalled();
    expect(dispatcher.dispatchNow).not.toHaveBeenCalled();
  });

  it('does not kick when a concurrent moderation won (count 0)', async () => {
    tx.$queryRaw.mockReset().mockResolvedValue([{ now: NOW }]);
    tx.message.updateMany.mockResolvedValue({ count: 0 });

    await service.hide(ACTOR, CLASSROOM, MESSAGE);

    expect(dispatcher.dispatchNow).not.toHaveBeenCalled();
  });

  it('still answers the REST call and logs without payload when the kick fails', async () => {
    const failing = new OutboxDispatcher(
      { $queryRaw: vi.fn().mockRejectedValue(new TypeError('postgres://secret')) } as never,
      {} as OutboxHandlerRegistry,
    );
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const withRealDispatcher = build(failing);

    await expect(withRealDispatcher.send(ACTOR, CLASSROOM, 'hello')).resolves.toMatchObject({
      id: MESSAGE,
    });
    await failing.onModuleDestroy();

    expect(error).toHaveBeenCalledWith({
      operation: 'outbox.dispatch.now',
      type: REALTIME_CHAT_MESSAGE_CREATED_EVENT,
      errorName: 'TypeError',
    });
  });
});
