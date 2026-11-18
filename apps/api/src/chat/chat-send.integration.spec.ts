import { createHash, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessVerificationService } from '../access/access-verification.service';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { PrismaService } from '../prisma/prisma.service';
import { ChatService } from './chat.service';

loadIsolatedTestDatabaseUrl();
const prisma = new PrismaService();
const otherClient = new PrismaService();
const recorder = new NotificationRecorder(new OutboxWriter());
const service = (client: PrismaService) =>
  new ChatService(client, new AccessVerificationService(client), recorder);
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
    'admits exactly five across independent clients for %s, counting hidden rows',
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
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(4);
      const failures = outcomes.filter((result) => result.status === 'rejected');
      expect(failures).toHaveLength(3);
      for (const failure of failures)
        expect((failure.reason as HttpException).getStatus()).toBe(429);
      expect(await counts()).toEqual([5, 4, 4]);
      await chat.send(role === 'staff' ? student : teacher, classroom, 'Other pair');
    },
  );

  it('uses the clock after a real lock wait, excluding rows expired at admission', async () => {
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
    const sending = chat.send(student, classroom, 'Fresh').then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await vi.waitFor(async () => {
        const [waiting] = await prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'
          AND NOT granted AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
        expect(waiting!.count).toBeGreaterThan(0);
      });
      // Insert AFTER the waiting transaction began: CURRENT_TIMESTAMP would wrongly
      // count these five rows, but the post-lock clock must see them as expired.
      await prisma.$executeRaw`INSERT INTO messages (id, classroom_id, author_id, body, created_at, updated_at)
        SELECT gen_random_uuid(), ${classroom}::uuid, ${student}::uuid, 'Expired',
        date_trunc('milliseconds', clock_timestamp()) - interval '10 seconds', clock_timestamp() FROM generate_series(1, 5)`;
    } finally {
      release();
      await holder;
    }
    expect(await sending).toMatchObject({ value: { body: 'Fresh' } });
    expect(await counts()).toEqual([6, 0, 0]);
  });
});
