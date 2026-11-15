import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { OutboxDispatcher } from '../outbox/outbox.dispatcher';
import { ClassroomContextModule } from './classroom-context.module';
import { ClassroomContextRecorder } from './classroom-context.recorder';

// This module deliberately exposes recording only; delivery is wired independently.
describe('ClassroomContextRecorder', () => {
  it('exports a recorder using the caller transaction and minimal payload', async () => {
    const module = await Test.createTestingModule({ imports: [ClassroomContextModule] })
      .overrideProvider(OutboxDispatcher)
      .useValue({})
      .compile();
    const create = vi.fn().mockResolvedValue({ id: 'event-id' });
    const tx = { outboxEvent: { create } } as unknown as Prisma.TransactionClient;
    try {
      await expect(
        module.get(ClassroomContextRecorder).recordChanged(tx, 'classroom-id'),
      ).resolves.toBeUndefined();
      expect(create).toHaveBeenCalledExactlyOnceWith({
        data: { type: 'classroom.context.changed', payload: { classroomId: 'classroom-id' } },
        select: { id: true },
      });
    } finally {
      await module.close();
    }
  });
});
