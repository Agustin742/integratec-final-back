import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClassroomRole, MembershipState, SchoolRole } from '@prisma/client';
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
    classroom: {
      findMany: ReturnType<typeof vi.fn>;
    };
    classroomMembership: {
      findMany: ReturnType<typeof vi.fn>;
    };
    parentLink: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
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
      classroom: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      classroomMembership: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      parentLink: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
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

  describe('listMyFamilyThreads', () => {
    const link2Id = '00000000-0000-4000-8000-000000000032';
    const link3Id = '00000000-0000-4000-8000-000000000033';
    const link4Id = '00000000-0000-4000-8000-000000000034';
    const classroom2Id = '00000000-0000-4000-8000-000000000012';
    const child2Id = '00000000-0000-4000-8000-000000000008';

    it.each([
      { label: 'Teacher', actorId: teacherId },
      { label: 'School Owner', actorId: schoolOwnerId },
      { label: 'School Admin', actorId: schoolAdminId },
    ])(
      'returns active family threads for $label ordered by lastMessageAt DESC NULLS LAST, createdAt ASC, id ASC',
      async ({ actorId }) => {
        prisma.classroom.findMany.mockResolvedValueOnce([
          { id: classroomId },
          { id: classroom2Id },
        ]);
        prisma.parentLink.findMany.mockResolvedValueOnce([
          {
            id: link3Id,
            classroomId,
            parentId: foreignParentId,
            childId: child2Id,
            createdAt: new Date('2026-11-22T10:00:00.000Z'),
            classroom: {
              id: classroomId,
              name: 'Physics A',
              adultMode: false,
              deletedAt: null,
              schoolId,
              school: { deletedAt: null },
            },
            parent: { id: foreignParentId, displayName: 'Parent Bruno' },
            child: { id: child2Id, displayName: 'Student Lucas' },
            messages: [],
          },
          {
            id: linkId,
            classroomId,
            parentId,
            childId,
            createdAt: new Date('2026-11-20T10:00:00.000Z'),
            classroom: {
              id: classroomId,
              name: 'Physics A',
              adultMode: false,
              deletedAt: null,
              schoolId,
              school: { deletedAt: null },
            },
            parent: { id: parentId, displayName: 'Parent Ana' },
            child: { id: childId, displayName: 'Student Sofia' },
            messages: [
              {
                body: 'Hello teacher',
                createdAt: msg1CreatedAt,
                authorId: parentId,
              },
            ],
          },
          {
            id: link2Id,
            classroomId: classroom2Id,
            parentId: foreignParentId,
            childId: child2Id,
            createdAt: new Date('2026-11-21T10:00:00.000Z'),
            classroom: {
              id: classroom2Id,
              name: 'Chemistry B',
              adultMode: false,
              deletedAt: null,
              schoolId,
              school: { deletedAt: null },
            },
            parent: { id: foreignParentId, displayName: 'Parent Bruno' },
            child: { id: child2Id, displayName: 'Student Lucas' },
            messages: [
              {
                body: 'Latest reply from staff',
                createdAt: msg2CreatedAt,
                authorId: actorId,
              },
            ],
          },
          {
            id: link4Id,
            classroomId: classroom2Id,
            parentId,
            childId,
            createdAt: new Date('2026-11-21T10:00:00.000Z'),
            classroom: {
              id: classroom2Id,
              name: 'Chemistry B',
              adultMode: false,
              deletedAt: null,
              schoolId,
              school: { deletedAt: null },
            },
            parent: { id: parentId, displayName: 'Parent Ana' },
            child: { id: childId, displayName: 'Student Sofia' },
            messages: [],
          },
        ]);
        prisma.classroomMembership.findMany.mockResolvedValueOnce([
          { classroomId, userId: childId },
          { classroomId, userId: child2Id },
          { classroomId: classroom2Id, userId: childId },
          { classroomId: classroom2Id, userId: child2Id },
        ]);

        const res = await service.listMyFamilyThreads(actorId);

        expect(prisma.classroom.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              deletedAt: null,
              adultMode: false,
              AND: [{ OR: [{ schoolId: null }, { school: { deletedAt: null } }] }],
              OR: [
                {
                  school: {
                    members: {
                      some: {
                        userId: actorId,
                        state: MembershipState.ACTIVE,
                        role: { in: [SchoolRole.OWNER, SchoolRole.ADMIN] },
                      },
                    },
                  },
                },
                { independentTeacherId: actorId },
                {
                  memberships: {
                    some: {
                      userId: actorId,
                      role: ClassroomRole.TEACHER,
                      state: MembershipState.ACTIVE,
                      deletedAt: null,
                    },
                  },
                  OR: [
                    { schoolId: null },
                    {
                      school: {
                        members: { some: { userId: actorId, state: MembershipState.ACTIVE } },
                      },
                    },
                  ],
                },
              ],
            },
            select: { id: true },
          }),
        );
        expect(prisma.parentLink.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              classroomId: { in: [classroomId, classroom2Id] },
              state: MembershipState.ACTIVE,
              classroom: {
                deletedAt: null,
                adultMode: false,
                OR: [{ schoolId: null }, { school: { deletedAt: null } }],
              },
            },
          }),
        );
        expect(res).toEqual({
          items: [
            {
              id: link2Id,
              classroomId: classroom2Id,
              classroomName: 'Chemistry B',
              parentId: foreignParentId,
              parentDisplayName: 'Parent Bruno',
              childId: child2Id,
              childDisplayName: 'Student Lucas',
              lastMessageBody: 'Latest reply from staff',
              lastMessageAt: msg2CreatedAt.toISOString(),
              lastMessageAuthorRole: 'STAFF',
            },
            {
              id: linkId,
              classroomId,
              classroomName: 'Physics A',
              parentId,
              parentDisplayName: 'Parent Ana',
              childId,
              childDisplayName: 'Student Sofia',
              lastMessageBody: 'Hello teacher',
              lastMessageAt: msg1CreatedAt.toISOString(),
              lastMessageAuthorRole: 'PARENT',
            },
            {
              id: link4Id,
              classroomId: classroom2Id,
              classroomName: 'Chemistry B',
              parentId,
              parentDisplayName: 'Parent Ana',
              childId,
              childDisplayName: 'Student Sofia',
              lastMessageBody: null,
              lastMessageAt: null,
              lastMessageAuthorRole: null,
            },
            {
              id: link3Id,
              classroomId,
              classroomName: 'Physics A',
              parentId: foreignParentId,
              parentDisplayName: 'Parent Bruno',
              childId: child2Id,
              childDisplayName: 'Student Lucas',
              lastMessageBody: null,
              lastMessageAt: null,
              lastMessageAuthorRole: null,
            },
          ],
        });
      },
    );

    it('excludes adultMode classrooms, deleted classrooms/schools, inactive links, and removed students', async () => {
      prisma.classroom.findMany.mockResolvedValueOnce([{ id: classroomId }]);
      prisma.parentLink.findMany.mockResolvedValueOnce([
        // Live active link with active student -> kept
        {
          id: linkId,
          classroomId,
          parentId,
          childId,
          createdAt: linkCreatedAt,
          classroom: {
            id: classroomId,
            name: 'Physics A',
            adultMode: false,
            deletedAt: null,
            schoolId,
            school: { deletedAt: null },
          },
          parent: { id: parentId, displayName: 'Parent Ana' },
          child: { id: childId, displayName: 'Student Sofia' },
          messages: [],
        },
        // adultMode: true -> defensively excluded
        {
          id: link2Id,
          classroomId: classroom2Id,
          parentId,
          childId,
          createdAt: linkCreatedAt,
          classroom: {
            id: classroom2Id,
            name: 'Adult Night',
            adultMode: true,
            deletedAt: null,
            schoolId: null,
            school: null,
          },
          parent: { id: parentId, displayName: 'Parent Ana' },
          child: { id: childId, displayName: 'Student Sofia' },
          messages: [],
        },
        // Deleted classroom -> defensively excluded
        {
          id: link3Id,
          classroomId: classroom2Id,
          parentId,
          childId,
          createdAt: linkCreatedAt,
          classroom: {
            id: classroom2Id,
            name: 'Deleted Class',
            adultMode: false,
            deletedAt: new Date(),
            schoolId: null,
            school: null,
          },
          parent: { id: parentId, displayName: 'Parent Ana' },
          child: { id: childId, displayName: 'Student Sofia' },
          messages: [],
        },
        // Removed student (child2Id not in activeMemberships) -> excluded
        {
          id: link4Id,
          classroomId,
          parentId: foreignParentId,
          childId: child2Id,
          createdAt: linkCreatedAt,
          classroom: {
            id: classroomId,
            name: 'Physics A',
            adultMode: false,
            deletedAt: null,
            schoolId,
            school: { deletedAt: null },
          },
          parent: { id: foreignParentId, displayName: 'Parent Bruno' },
          child: { id: child2Id, displayName: 'Former Student' },
          messages: [],
        },
      ]);
      // Only (classroomId, childId) has an active STUDENT membership
      prisma.classroomMembership.findMany.mockResolvedValueOnce([{ classroomId, userId: childId }]);

      const res = await service.listMyFamilyThreads(teacherId);
      expect(res.items.map((item) => item.id)).toEqual([linkId]);
    });

    it('returns { items: [] } for students, parents without staff classrooms, and invalid UUIDs', async () => {
      await expect(service.listMyFamilyThreads('not-a-uuid')).resolves.toEqual({ items: [] });
      expect(prisma.classroom.findMany).not.toHaveBeenCalled();

      prisma.classroom.findMany.mockResolvedValueOnce([]);
      await expect(service.listMyFamilyThreads(childId)).resolves.toEqual({ items: [] });

      prisma.classroom.findMany.mockResolvedValueOnce([]);
      await expect(service.listMyFamilyThreads(parentId)).resolves.toEqual({ items: [] });

      expect(prisma.parentLink.findMany).not.toHaveBeenCalled();
      expect(prisma.classroomMembership.findMany).not.toHaveBeenCalled();
    });
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
