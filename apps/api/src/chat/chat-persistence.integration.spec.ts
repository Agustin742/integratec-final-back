import { randomUUID } from 'node:crypto';
import { type Prisma, PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';

const prisma = new PrismaClient({ datasourceUrl: loadIsolatedTestDatabaseUrl() });
const rollback = new Error('Roll back synthetic chat fixture');

type Fixture = {
  tx: Prisma.TransactionClient;
  authorId: string;
  moderatorId: string;
  classroomId: string;
  parentLinkId: string;
};

// Every fixture and write rolls back, including when an assertion fails. No seed reset
// or deletion is needed, and tests do not depend on another file's data.
async function withFixture(check: (fixture: Fixture) => Promise<void>) {
  try {
    await prisma.$transaction(async (tx) => {
      const [authorId, moderatorId, parentId] = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of [authorId, moderatorId, parentId]) {
        await tx.user.create({
          data: {
            id,
            email: `chat-${id}@example.invalid`,
            displayName: 'Synthetic chat user',
            passwordHash: 'synthetic-unused-hash',
            registrationPath: 'INDEPENDENT_TEACHER',
          },
        });
      }
      const classroom = await tx.classroom.create({
        data: { name: 'Synthetic chat classroom', independentTeacherId: moderatorId },
      });
      await tx.classroomMembership.create({
        data: { classroomId: classroom.id, userId: authorId, role: 'STUDENT' },
      });
      const link = await tx.parentLink.create({
        data: { parentId, childId: authorId, classroomId: classroom.id },
      });
      await check({ tx, authorId, moderatorId, classroomId: classroom.id, parentLinkId: link.id });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

function messageData(fixture: Fixture): Prisma.MessageUncheckedCreateInput {
  return { classroomId: fixture.classroomId, authorId: fixture.authorId, body: 'Hello @member' };
}

afterAll(async () => prisma.$disconnect());

describe('chat persistence through Prisma and PostgreSQL constraints', () => {
  it('persists classroom text, author and UTC time with visible audit defaults', async () => {
    await withFixture(async (fixture) => {
      const before = new Date();
      const message = await fixture.tx.message.create({ data: messageData(fixture) });
      expect(message).toMatchObject({
        authorId: fixture.authorId,
        classroomId: fixture.classroomId,
        parentLinkId: null,
        body: 'Hello @member',
        hiddenAt: null,
        hiddenById: null,
      });
      expect(message.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(message.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(message.id).toMatch(/^[\da-f-]{36}$/);
    });
  });

  it('allows the alternative ParentLink context at storage level only', async () => {
    await withFixture(async (fixture) => {
      const message = await fixture.tx.message.create({
        data: { ...messageData(fixture), classroomId: null, parentLinkId: fixture.parentLinkId },
      });
      expect(message).toMatchObject({ classroomId: null, parentLinkId: fixture.parentLinkId });
    });
  });

  it.each(['neither', 'both'])('rejects %s contexts in the database', async (context) => {
    await withFixture(async (fixture) => {
      await expect(
        fixture.tx.message.create({
          data: {
            ...messageData(fixture),
            classroomId: context === 'both' ? fixture.classroomId : null,
            parentLinkId: context === 'both' ? fixture.parentLinkId : null,
          },
        }),
      ).rejects.toThrow(/messages_context_check/);
    });
  });

  it.each(['hiddenAt', 'hiddenById'] as const)(
    'rejects incomplete moderation: %s only',
    async (field) => {
      await withFixture(async (fixture) => {
        await expect(
          fixture.tx.message.create({
            data: {
              ...messageData(fixture),
              ...(field === 'hiddenAt'
                ? { hiddenAt: new Date() }
                : { hiddenById: fixture.moderatorId }),
            },
          }),
        ).rejects.toThrow(/messages_moderation_check/);
      });
    },
  );

  it('hides by state change while retaining text, author and moderation audit', async () => {
    await withFixture(async (fixture) => {
      const { tx } = fixture;
      const original = await tx.message.create({ data: messageData(fixture) });
      const hiddenAt = new Date('2026-11-18T12:00:00.000Z');
      await tx.message.update({
        where: { id: original.id },
        data: { hiddenAt, hiddenById: fixture.moderatorId },
      });
      expect(await tx.message.findUniqueOrThrow({ where: { id: original.id } })).toMatchObject({
        body: original.body,
        authorId: original.authorId,
        createdAt: original.createdAt,
        hiddenById: fixture.moderatorId,
        hiddenAt,
      });
    });
  });

  it('retains attribution and mentions after logical membership removal', async () => {
    await withFixture(async (fixture) => {
      const { tx, classroomId, authorId } = fixture;
      const message = await tx.message.create({ data: messageData(fixture) });
      await tx.mention.create({
        data: { sourceType: 'message', sourceId: message.id, mentionedUserId: authorId },
      });
      await tx.classroomMembership.update({
        where: { classroomId_userId: { classroomId, userId: authorId } },
        data: { state: 'INACTIVE', deletedAt: new Date() },
      });
      expect(await tx.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject({
        authorId,
      });
      expect(
        await tx.mention.count({ where: { sourceType: 'message', sourceId: message.id } }),
      ).toBe(1);
    });
  });

  it('deduplicates message mentions without changing other source namespaces', async () => {
    await withFixture(async (fixture) => {
      const { tx } = fixture;
      const message = await tx.message.create({ data: messageData(fixture) });
      const mention = { sourceId: message.id, mentionedUserId: fixture.authorId };
      for (const sourceType of ['message', 'announcement', 'activity_forum_post']) {
        await tx.mention.create({ data: { ...mention, sourceType } });
      }
      expect(await tx.mention.count({ where: mention })).toBe(3);
      await expect(
        tx.mention.create({ data: { ...mention, sourceType: 'message' } }),
      ).rejects.toThrow(/Unique constraint/);
    });
  });

  it.each(['authorId', 'classroomId', 'parentLinkId', 'hiddenById'] as const)(
    'enforces the %s foreign key',
    async (field) => {
      await withFixture(async (fixture) => {
        const data = { ...messageData(fixture), [field]: randomUUID() };
        if (field === 'parentLinkId') data.classroomId = null;
        if (field === 'hiddenById') data.hiddenAt = new Date();
        await expect(fixture.tx.message.create({ data })).rejects.toThrow(/Foreign key constraint/);
      });
    },
  );
});
