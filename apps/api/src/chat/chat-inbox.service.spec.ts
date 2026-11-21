/* eslint-disable @typescript-eslint/no-explicit-any -- loose Prisma/service doubles */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CHAT_INBOX_MAX_CLASSROOMS, CHAT_INBOX_PREVIEW_MAX_LENGTH } from './chat-policy';
import { ChatInboxService } from './chat-inbox.service';

const ACTOR = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const ROOM_A = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const ROOM_B = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a11';
const ROOM_C = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a12';
const ROOM_PARENT = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a13';
const MESSAGE = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';

const room = (id: string, name: string, myRole = 'STUDENT') => ({
  classroom: { id, name },
  myRole,
  capabilities: [],
});
const row = (classroomId: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  classroom_id: classroomId,
  message_id: `m-${classroomId}`,
  author_id: 'author',
  author_display_name: 'Ana',
  body: 'hello',
  created_at: new Date(createdAt),
  unread_count: 0,
  ...extra,
});

describe('ChatInboxService.list', () => {
  let prisma: { $queryRaw: any; $executeRaw: any; message: { findFirst: any } };
  let access: { listAccessibleClassrooms: any; verifyClassroomAccess: any };
  let service: ChatInboxService;

  beforeEach(() => {
    prisma = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(1),
      message: { findFirst: vi.fn() },
    };
    access = {
      listAccessibleClassrooms: vi.fn().mockResolvedValue({ total: 0, items: [] }),
      verifyClassroomAccess: vi.fn(),
    };
    service = new ChatInboxService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
    );
  });

  it('returns an empty list without touching messages when there are no classrooms', async () => {
    await expect(service.list(ACTOR)).resolves.toEqual({ items: [] });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(access.listAccessibleClassrooms).toHaveBeenCalledWith(ACTOR, {
      skip: 0,
      take: CHAT_INBOX_MAX_CLASSROOMS,
      sort: { field: 'name', direction: 'asc' },
    });
  });

  it('drops parent-only classrooms and summarizes the rest in one query', async () => {
    access.listAccessibleClassrooms.mockResolvedValue({
      total: 3,
      items: [room(ROOM_A, 'A'), room(ROOM_PARENT, 'P', 'PARENT'), room(ROOM_B, 'B', 'TEACHER')],
    });
    prisma.$queryRaw.mockResolvedValue([
      row(ROOM_A, '2026-11-20T10:00:00.000Z', { unread_count: 3 }),
    ]);

    const result = await service.list(ACTOR);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result.items.map((item) => item.classroomId)).toEqual([ROOM_A, ROOM_B]);
    expect(result.items[0]).toEqual({
      classroomId: ROOM_A,
      classroomName: 'A',
      lastMessage: {
        id: `m-${ROOM_A}`,
        authorId: 'author',
        authorDisplayName: 'Ana',
        bodyPreview: 'hello',
        createdAt: '2026-11-20T10:00:00.000Z',
      },
      unreadCount: 3,
    });
    expect(result.items[1]).toEqual({
      classroomId: ROOM_B,
      classroomName: 'B',
      lastMessage: null,
      unreadCount: 0,
    });
  });

  it('orders by last activity desc, classrooms without messages last by name', async () => {
    access.listAccessibleClassrooms.mockResolvedValue({
      total: 4,
      items: [room(ROOM_C, 'Zeta'), room(ROOM_A, 'Alpha'), room(ROOM_B, 'Beta')],
    });
    prisma.$queryRaw.mockResolvedValue([
      row(ROOM_A, '2026-11-20T09:00:00.000Z'),
      row(ROOM_B, '2026-11-20T11:00:00.000Z'),
    ]);

    const result = await service.list(ACTOR);

    expect(result.items.map((item) => item.classroomId)).toEqual([ROOM_B, ROOM_A, ROOM_C]);
  });

  it('collapses whitespace and truncates the preview to the maximum length', async () => {
    access.listAccessibleClassrooms.mockResolvedValue({ total: 2, items: [room(ROOM_A, 'A')] });
    prisma.$queryRaw.mockResolvedValue([
      row(ROOM_A, '2026-11-20T09:00:00.000Z', {
        body: `line one\n\n  line   two ${'x'.repeat(300)}`,
      }),
    ]);

    const [item] = (await service.list(ACTOR)).items;

    expect(item!.lastMessage!.bodyPreview.startsWith('line one line two x')).toBe(true);
    expect(Array.from(item!.lastMessage!.bodyPreview)).toHaveLength(CHAT_INBOX_PREVIEW_MAX_LENGTH);
    expect(item!.lastMessage!.bodyPreview.endsWith('…')).toBe(true);
  });
});

describe('ChatInboxService.markRead', () => {
  let prisma: { $queryRaw: any; $executeRaw: any; message: { findFirst: any } };
  let access: { listAccessibleClassrooms: any; verifyClassroomAccess: any };
  let service: ChatInboxService;

  beforeEach(() => {
    prisma = {
      $queryRaw: vi.fn(),
      $executeRaw: vi.fn().mockResolvedValue(1),
      message: { findFirst: vi.fn().mockResolvedValue({ id: MESSAGE }) },
    };
    access = {
      listAccessibleClassrooms: vi.fn(),
      verifyClassroomAccess: vi
        .fn()
        .mockResolvedValue({ myRole: 'STUDENT', classroom: { id: ROOM_A } }),
    };
    service = new ChatInboxService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
    );
  });

  it('denies parents before reading or writing anything', async () => {
    access.verifyClassroomAccess.mockResolvedValue({
      myRole: 'PARENT',
      classroom: { id: ROOM_A },
    });

    await expect(service.markRead(ACTOR, ROOM_A, MESSAGE)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed message id', async () => {
    await expect(service.markRead(ACTOR, ROOM_A, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers 404 when the message is not a visible message of this classroom', async () => {
    prisma.message.findFirst.mockResolvedValue(null);

    await expect(service.markRead(ACTOR, ROOM_A, MESSAGE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MESSAGE, classroomId: ROOM_A, hiddenAt: null } }),
    );
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('writes the forward-only upsert once for a valid message', async () => {
    await expect(service.markRead(ACTOR, ROOM_A, MESSAGE)).resolves.toBeUndefined();
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
