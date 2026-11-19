import { createHash, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { MetricRecordingService } from '../metrics/metric-recording.service';
import { utcDayOf } from '../metrics/utc-day';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

loadIsolatedTestDatabaseUrl();
const prisma = new PrismaService();
const otherClient = new PrismaService();
const recorder = new NotificationRecorder(new OutboxWriter());
const service = (client: PrismaService) =>
  new ChatService(
    client,
    new AccessVerificationService(client),
    recorder,
    new MetricRecordingService(client),
  );
const chat = service(prisma);
const otherChat = service(otherClient);
let teacher: string, student: string, parent: string, stranger: string, classroom: string;

// Real access/Prisma/outbox; no authentication mock or HTTP boundary in this unit.
// Unique synthetic fixtures remain only in the task-owned disposable database.
beforeEach(async () => {
  [teacher, student, parent, stranger, classroom] = Array.from({ length: 5 }, () => randomUUID());
  await prisma.user.createMany({
    data: [teacher, student, parent, stranger].map((id) => ({
      id,
      email: `chat-send-${id}@example.invalid`,
      displayName: id === teacher ? 'Member' : 'Synthetic user',
      passwordHash: 'synthetic-unused-hash',
      registrationPath: 'INDEPENDENT_TEACHER' as const,
    })),
  });
  await prisma.classroom.create({
    data: { id: classroom, name: 'Chat send fixture', independentTeacherId: teacher },
  });
  await prisma.classroomMembership.create({ data: { classroomId: classroom, userId: student } });
  await prisma.parentLink.create({
    data: { parentId: parent, childId: student, classroomId: classroom },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
  await otherClient.$disconnect();
});

async function counts() {
  const messages = await prisma.message.findMany({ where: { classroomId: classroom } });
  return [
    messages.length,
    await prisma.mention.count({ where: { sourceId: { in: messages.map((row) => row.id) } } }),
    await prisma.outboxEvent.count({
      where: { payload: { path: ['classroomId'], equals: classroom } },
    }),
  ];
}
async function rejected(actor: string, body: unknown, status: number) {
  const before = await counts();
  await expect(chat.send(actor, classroom, body)).rejects.toMatchObject({ status });
  expect(await counts()).toEqual(before);
}

describe('chat send service with PostgreSQL admission and atomic mentions', () => {
  it('trims plain text and atomically records deduplicated roster mentions and outbox requests', async () => {
    const row = await chat.send(student, classroom, '  <b>@Member</b> @Member @unknown  ');
    expect(row).toMatchObject({
      authorId: student,
      classroomId: classroom,
      body: '<b>@Member</b> @Member @unknown',
      mentionedUserIds: [teacher],
    });
    expect(new Date(row.createdAt).toISOString()).toBe(row.createdAt);
    expect(await counts()).toEqual([1, 1, 1]);
    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { payload: { path: ['resourceId'], equals: row.id } },
    });
    expect(event.payload).toEqual({
      kind: 'mention',
      classroomId: classroom,
      resourceId: row.id,
      recipientId: teacher,
    });
  });

  it('counts one participation message on the UTC day of the persisted message, only on success', async () => {
    const metric = async () =>
      (
        await prisma.activityMetric.findMany({
          where: { classroomId: classroom, userId: student },
        })
      ).reduce((sum, row) => sum + row.messageCount, 0);
    expect(await metric()).toBe(0);
    const row = await chat.send(student, classroom, 'Counted');
    const day = utcDayOf(new Date(row.createdAt));
    const stored = await prisma.activityMetric.findUniqueOrThrow({
      where: { classroomId_userId_day: { classroomId: classroom, userId: student, day } },
    });
    expect(stored.messageCount).toBe(1);
    await rejected(student, '', 400);
    expect(await metric()).toBe(1);
    for (let i = 0; i < 4; i++) await chat.send(student, classroom, 'Valid');
    await rejected(student, 'Sixth', 429);
    expect(await metric()).toBe(5);
  });

  it.each([null, 42, '', ' \n\t ', '\u200B\u200D', 'x'.repeat(2001), 'a\0b', 'a\u0085b'])(
    'rejects invalid text %# without admitting or writing anything',
    async (body) => {
      await rejected(student, body, 400);
      for (let i = 0; i < 5; i++) await chat.send(student, classroom, 'Valid');
      await rejected(student, 'Sixth', 429);
    },
  );
  it('accepts the trimmed 2000-character boundary and safe multiline text', async () => {
    expect((await chat.send(student, classroom, ` ${'x'.repeat(2000)} `)).body).toHaveLength(2000);
    expect((await chat.send(student, classroom, 'a\n\tb')).body).toBe('a\n\tb');
  });

  it('denies parents/strangers and rechecks logical removal on the next send', async () => {
    await rejected(parent, '@Member', 403);
    await rejected(stranger, '@Member', 404);
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: classroom, userId: student } },
      data: { state: 'INACTIVE', deletedAt: new Date() },
    });
    await rejected(student, '@Member', 404);
  });
  it('reads persisted mute on every send; independent staff may still send', async () => {
    await chat.send(student, classroom, 'Before mute');
    await prisma.classroom.update({ where: { id: classroom }, data: { chatMuted: true } });
    await rejected(student, '@Member', 403);
    await chat.send(teacher, classroom, 'Staff while muted');
    await prisma.classroom.update({ where: { id: classroom }, data: { chatMuted: false } });
    await chat.send(student, classroom, 'After mute');
  });

  it('caps resolved users, not tokens, at twenty with no partial writes', async () => {
    const ids = Array.from({ length: 21 }, () => randomUUID());
    await prisma.user.createMany({
      data: ids.map((id) => ({
        id,
        email: `${id}@example.invalid`,
        displayName: 'Group',
        passwordHash: 'synthetic-unused-hash',
        registrationPath: 'INDEPENDENT_TEACHER' as const,
      })),
    });
    await prisma.classroomMembership.createMany({
      data: ids.map((userId) => ({ userId, classroomId: classroom })),
    });
    await rejected(student, '@Group', 400);
    await prisma.classroomMembership.update({
      where: { classroomId_userId: { classroomId: classroom, userId: ids[20]! } },
      data: { state: 'INACTIVE' },
    });
    expect((await chat.send(student, classroom, '@Group @Group')).mentionedUserIds).toHaveLength(
      20,
    );
    expect(await counts()).toEqual([1, 20, 20]);
  });

  it('rolls back message, mentions and outbox on downstream failure, without consuming admission', async () => {
    const original = recorder.record.bind(recorder);
    const spy = vi.spyOn(recorder, 'record').mockImplementationOnce(async (tx, request) => {
      await original(tx, request);
      throw new Error('Synthetic recorder failure');
    });
    try {
      await expect(chat.send(student, classroom, '@Member')).rejects.toThrow(
        'Synthetic recorder failure',
      );
      expect(await counts()).toEqual([0, 0, 0]);
    } finally {
      spy.mockRestore();
    }
    for (let i = 0; i < 5; i++) await chat.send(student, classroom, 'Valid');
    await rejected(student, 'Sixth', 429);
  });

  it.each(['student', 'staff'])(
    'never admits more than five across independent clients for %s, counting hidden rows',
    async (role) => {
      const actor = role === 'staff' ? teacher : student;
      await prisma.message.create({
        data: {
          classroomId: classroom,
          authorId: actor,
          body: 'Retained hidden',
          hiddenAt: new Date(),
          hiddenById: teacher,
        },
      });
      const outcomes = await Promise.allSettled(
        Array.from({ length: 7 }, (_, i) =>
          (i % 2 ? otherChat : chat).send(
            actor,
            i % 2 ? classroom.toUpperCase() : classroom,
            '@Member',
          ),
        ),
      );
      // Concurrent sends for one pair are rejected (429) instead of queued, so how many
      // succeed is timing-dependent; the first lock holder always does. Invariants only.
      const admitted = outcomes.filter((result) => result.status === 'fulfilled').length;
      const failures = outcomes.filter((result) => result.status === 'rejected');
      expect(admitted).toBeGreaterThanOrEqual(1);
      expect(admitted).toBeLessThanOrEqual(4);
      expect(failures).toHaveLength(7 - admitted);
      for (const failure of failures)
        expect((failure.reason as HttpException).getStatus()).toBe(429);
      // Rejections persist nothing and consume no quota: one hidden row plus admitted ones.
      expect(await counts()).toEqual([1 + admitted, admitted, admitted]);
      await chat.send(role === 'staff' ? student : teacher, classroom, 'Other pair');
    },
  );

  it('rejects with 429 immediately, persisting nothing, while another connection holds the pair lock', async () => {
    const key = createHash('sha256')
      .update(`chat:${classroom}:${student}`)
      .digest()
      .readBigInt64BE(0);
    let release!: () => void;
    let acquired!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const holder = otherClient.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${key})`;
      acquired();
      await gate;
    });
    await locked;
    try {
      // The lock is still held: a queued send would never settle here, so settling at all
      // proves the send did not wait for it.
      await rejected(student, '@Member', 429);
      expect(await counts()).toEqual([0, 0, 0]);
    } finally {
      release();
      await holder;
    }
    // Quota was not consumed by the rejection: the full five are still admitted.
    for (let i = 0; i < 5; i++) await chat.send(student, classroom, 'Valid');
    await rejected(student, 'Sixth', 429);
  });
});
