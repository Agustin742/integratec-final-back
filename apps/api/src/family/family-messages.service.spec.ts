import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../access/access-verification.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CreateParentLinkMessageDto,
  ListParentLinkMessagesQueryDto,
  PARENT_LINK_MESSAGE_MAX_BODY_LENGTH,
} from './family-messages.dto';
import { FamilyMessagesService } from './family-messages.service';
import { ParentLinkMessagesController } from './parent-link-messages.controller';

const parentId = '00000000-0000-4000-8000-000000000001';
const foreignParentId = '00000000-0000-4000-8000-000000000002';
const childId = '00000000-0000-4000-8000-000000000003';
const teacherId = '00000000-0000-4000-8000-000000000004';
const schoolOwnerId = '00000000-0000-4000-8000-000000000005';
const schoolAdminId = '00000000-0000-4000-8000-000000000006';
const outsiderId = '00000000-0000-4000-8000-000000000007';
const classroomId = '00000000-0000-4000-8000-000000000011';
const schoolId = '00000000-0000-4000-8000-000000000021';
const linkId = '00000000-0000-4000-8000-000000000031';
const msg1Id = '00000000-0000-4000-8000-000000000041';
const msg2Id = '00000000-0000-4000-8000-000000000042';
const linkCreatedAt = new Date('2026-11-20T10:00:00.000Z');
const msg1CreatedAt = new Date('2026-11-25T10:00:00.000Z');
const msg2CreatedAt = new Date('2026-11-25T10:05:00.000Z');

function makeLinkRow(overrides?: { adultMode?: boolean }) {
  return {
    id: linkId,
    parentId,
    classroomId,
    childId,
    createdAt: linkCreatedAt,
    classroom: {
      name: 'Physics A',
      subject: 'Mechanics',
      schoolId,
      adultMode: overrides?.adultMode ?? false,
      deletedAt: null,
      school: { deletedAt: null },
    },
    child: { displayName: 'Student Sofia' },
  };
}

describe('FamilyMessagesService (unit)', () => {
  let prisma: {
    parentLink: {
      findFirst: ReturnType<typeof vi.fn>;
    };
    message: {
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let access: {
    isActiveStudent: ReturnType<typeof vi.fn>;
    verifyClassroomAccess: ReturnType<typeof vi.fn>;
  };
  let service: FamilyMessagesService;

  beforeEach(() => {
    prisma = {
      parentLink: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      message: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
    };
    access = {
      isActiveStudent: vi.fn().mockResolvedValue(true),
      verifyClassroomAccess: vi.fn().mockResolvedValue({
        classroom: {
          id: classroomId,
          schoolId,
          independentTeacherId: null,
          name: 'Physics A',
          adultMode: false,
        },
        myRole: 'TEACHER',
        capabilities: [],
      }),
    };
    service = new FamilyMessagesService(
      prisma as unknown as PrismaService,
      access as unknown as AccessVerificationService,
    );
  });

  it('allows the linked parent to read and send messages with authorRole PARENT and classroomId null', async () => {
    prisma.parentLink.findFirst.mockResolvedValue(makeLinkRow());
    prisma.message.count.mockResolvedValueOnce(2);
    prisma.message.findMany.mockResolvedValueOnce([
      {
        id: msg1Id,
        parentLinkId: linkId,
        authorId: parentId,
        body: 'Hello teacher',
        createdAt: msg1CreatedAt,
        author: { displayName: 'Parent Ana' },
      },
      {
        id: msg2Id,
        parentLinkId: linkId,
        authorId: teacherId,
        body: 'Hello Ana, Sofia is doing great!',
        createdAt: msg2CreatedAt,
        author: { displayName: 'Prof. Ada' },
      },
    ]);

    const listRes = await service.listMessages(parentId, linkId, { page: 1, pageSize: 30 });
    expect(access.verifyClassroomAccess).not.toHaveBeenCalled();
    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { parentLinkId: linkId, hiddenAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 30,
      }),
    );
    expect(listRes).toEqual({
      link: {
        id: linkId,
        classroomId,
        classroomName: 'Physics A',
        classroomSubject: 'Mechanics',
        schoolId,
        adultMode: false,
        childId,
        childDisplayName: 'Student Sofia',
        createdAt: linkCreatedAt.toISOString(),
      },
      items: [
        {
          id: msg1Id,
          parentLinkId: linkId,
          authorId: parentId,
          authorDisplayName: 'Parent Ana',
          authorRole: 'PARENT',
          body: 'Hello teacher',
          createdAt: msg1CreatedAt.toISOString(),
        },
        {
          id: msg2Id,
          parentLinkId: linkId,
          authorId: teacherId,
          authorDisplayName: 'Prof. Ada',
          authorRole: 'STAFF',
          body: 'Hello Ana, Sofia is doing great!',
          createdAt: msg2CreatedAt.toISOString(),
        },
      ],
      page: 1,
      pageSize: 30,
      total: 2,
    });

    prisma.message.create.mockResolvedValueOnce({
      id: msg1Id,
      parentLinkId: linkId,
      authorId: parentId,
      body: 'Thanks for the update!',
      createdAt: msg1CreatedAt,
      author: { displayName: 'Parent Ana' },
    });

    const created = await service.createMessage(parentId, linkId, {
      body: '  Thanks for the update!  ',
    });
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          parentLinkId: linkId,
          classroomId: null,
          authorId: parentId,
          body: 'Thanks for the update!',
        },
      }),
    );
    expect(created).toEqual({
      id: msg1Id,
      parentLinkId: linkId,
      authorId: parentId,
      authorDisplayName: 'Parent Ana',
      authorRole: 'PARENT',
      body: 'Thanks for the update!',
      createdAt: msg1CreatedAt.toISOString(),
    });
  });

  it.each([
    { label: 'Teacher', actorId: teacherId, myRole: 'TEACHER' },
    { label: 'School Owner', actorId: schoolOwnerId, myRole: 'OWNER' },
    { label: 'School Admin', actorId: schoolAdminId, myRole: 'ADMIN' },
  ])(
    'allows classroom $label to read and reply with authorRole STAFF',
    async ({ actorId, myRole }) => {
      prisma.parentLink.findFirst.mockResolvedValue(makeLinkRow());
      access.verifyClassroomAccess.mockResolvedValue({
        classroom: {
          id: classroomId,
          schoolId,
          independentTeacherId: null,
          name: 'Physics A',
          adultMode: false,
        },
        myRole,
        capabilities: [],
      });
      prisma.message.count.mockResolvedValueOnce(0);
      prisma.message.findMany.mockResolvedValueOnce([]);

      const listRes = await service.listMessages(actorId, linkId, { page: 1, pageSize: 30 });
      expect(access.verifyClassroomAccess).toHaveBeenCalledWith(actorId, classroomId, {
        requiredRole: 'STAFF',
      });
      expect(listRes.total).toBe(0);

      prisma.message.create.mockResolvedValueOnce({
        id: msg2Id,
        parentLinkId: linkId,
        authorId: actorId,
        body: 'Reply from staff',
        createdAt: msg2CreatedAt,
        author: { displayName: `Staff ${myRole}` },
      });

      const created = await service.createMessage(actorId, linkId, { body: 'Reply from staff' });
      expect(prisma.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            parentLinkId: linkId,
            classroomId: null,
            authorId: actorId,
            body: 'Reply from staff',
          },
        }),
      );
      expect(created.authorRole).toBe('STAFF');
    },
  );

  it('returns 404 for the linked student (childId), foreign parent, and outsider on both GET and POST', async () => {
    prisma.parentLink.findFirst.mockResolvedValue(makeLinkRow());

    // Student and foreign parent in the same classroom get ForbiddenException from verifyClassroomAccess(STAFF)
    for (const actor of [childId, foreignParentId]) {
      access.verifyClassroomAccess.mockRejectedValueOnce(
        new ForbiddenException('Staff role required for this action'),
      );
      await expect(service.listMessages(actor, linkId, { page: 1, pageSize: 30 })).rejects.toThrow(
        NotFoundException,
      );

      access.verifyClassroomAccess.mockRejectedValueOnce(
        new ForbiddenException('Staff role required for this action'),
      );
      await expect(service.createMessage(actor, linkId, { body: 'Hi' })).rejects.toThrow(
        NotFoundException,
      );
    }

    // Outsider gets NotFoundException from verifyClassroomAccess
    access.verifyClassroomAccess.mockRejectedValueOnce(
      new NotFoundException('Classroom not found'),
    );
    await expect(
      service.listMessages(outsiderId, linkId, { page: 1, pageSize: 30 }),
    ).rejects.toThrow(NotFoundException);

    access.verifyClassroomAccess.mockRejectedValueOnce(
      new NotFoundException('Classroom not found'),
    );
    await expect(service.createMessage(outsiderId, linkId, { body: 'Hi' })).rejects.toThrow(
      NotFoundException,
    );

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('returns 403 in adultMode on both GET and POST for parent and staff without writing', async () => {
    prisma.parentLink.findFirst.mockResolvedValue(makeLinkRow({ adultMode: true }));

    for (const actor of [parentId, teacherId]) {
      await expect(service.listMessages(actor, linkId, { page: 1, pageSize: 30 })).rejects.toThrow(
        new ForbiddenException(
          'Parent messaging is disabled while the classroom is in adult education mode',
        ),
      );
      await expect(service.createMessage(actor, linkId, { body: 'Hi' })).rejects.toThrow(
        new ForbiddenException(
          'Parent messaging is disabled while the classroom is in adult education mode',
        ),
      );
    }

    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('returns 404 for invalid UUID, inactive/missing link, or removed student', async () => {
    // Invalid UUID
    await expect(
      service.listMessages(parentId, 'not-a-uuid', { page: 1, pageSize: 30 }),
    ).rejects.toThrow(NotFoundException);
    await expect(service.createMessage(parentId, 'not-a-uuid', { body: 'Hi' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.parentLink.findFirst).not.toHaveBeenCalled();

    // Missing / inactive link
    prisma.parentLink.findFirst.mockResolvedValueOnce(null);
    await expect(service.listMessages(parentId, linkId, { page: 1, pageSize: 30 })).rejects.toThrow(
      NotFoundException,
    );

    // Removed student
    prisma.parentLink.findFirst.mockResolvedValueOnce(makeLinkRow());
    access.isActiveStudent.mockResolvedValueOnce(false);
    await expect(service.createMessage(parentId, linkId, { body: 'Hi' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe('FamilyMessages DTO validation (unit)', () => {
  it('accepts trimmed multiline text up to 2000 characters and rejects empty, whitespace, overlong, and control chars', async () => {
    const valid = plainToInstance(CreateParentLinkMessageDto, {
      body: '  Line 1\n\tLine 2  ',
    });
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.body).toBe('Line 1\n\tLine 2');

    const maxValid = plainToInstance(CreateParentLinkMessageDto, {
      body: `  ${'a'.repeat(PARENT_LINK_MESSAGE_MAX_BODY_LENGTH)}  `,
    });
    expect(await validate(maxValid)).toHaveLength(0);
    expect(maxValid.body).toHaveLength(PARENT_LINK_MESSAGE_MAX_BODY_LENGTH);

    const invalidCases = [
      '',
      '   \n\t  ',
      '\u200B\uFEFF',
      'a'.repeat(PARENT_LINK_MESSAGE_MAX_BODY_LENGTH + 1),
      'hello\u0000world',
      '\u000Bhello',
      'hello\u0007',
      'hello\u009F',
    ];

    for (const body of invalidCases) {
      const dto = plainToInstance(CreateParentLinkMessageDto, { body });
      const errors = await validate(dto);
      expect(
        errors.length,
        `expected validation error for ${JSON.stringify(body)}`,
      ).toBeGreaterThan(0);
    }
  });

  it('validates pagination bounds for ListParentLinkMessagesQueryDto', async () => {
    const defaults = plainToInstance(ListParentLinkMessagesQueryDto, {});
    expect(await validate(defaults)).toHaveLength(0);
    expect(defaults.page).toBe(1);
    expect(defaults.pageSize).toBe(30);

    const validBounds = plainToInstance(ListParentLinkMessagesQueryDto, {
      page: '2',
      pageSize: '50',
    });
    expect(await validate(validBounds)).toHaveLength(0);
    expect(validBounds.page).toBe(2);
    expect(validBounds.pageSize).toBe(50);

    for (const bad of [{ page: 0 }, { pageSize: 0 }, { pageSize: 51 }, { pageSize: 'abc' }]) {
      const dto = plainToInstance(ListParentLinkMessagesQueryDto, bad);
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
});

describe('ParentLinkMessagesController (unit adapter delegation)', () => {
  it('delegates listMessages and createMessage to FamilyMessagesService', async () => {
    const stub = {
      listMessages: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      createMessage: vi.fn().mockResolvedValue({ id: msg1Id }),
    };
    const controller = new ParentLinkMessagesController(stub as unknown as FamilyMessagesService);
    const query: ListParentLinkMessagesQueryDto = { page: 2, pageSize: 15 };
    const dto: CreateParentLinkMessageDto = { body: 'Hello' };

    await controller.listMessages(parentId, linkId, query);
    expect(stub.listMessages).toHaveBeenCalledWith(parentId, linkId, query);

    await controller.createMessage(parentId, linkId, dto);
    expect(stub.createMessage).toHaveBeenCalledWith(parentId, linkId, dto);
  });
});
