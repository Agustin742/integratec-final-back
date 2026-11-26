import { createHash } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ClassroomRole, MembershipState, Prisma, SchoolRole } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { toIsoString } from '../http/iso-string';
import { RequestValidationException } from '../http/validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  type CreateParentLinkMessageDto,
  type ListParentLinkMessagesQueryDto,
  PARENT_LINK_MESSAGES_DEFAULT_PAGE,
  PARENT_LINK_MESSAGES_DEFAULT_PAGE_SIZE,
  PARENT_LINK_MESSAGE_MAX_BODY_LENGTH,
  type ParentLinkMessageAuthorRole,
  type ParentLinkMessageDto,
  type ParentLinkMessagesResponseDto,
  type StaffFamilyThreadDto,
  type StaffFamilyThreadsResponseDto,
  UNSAFE_PARENT_MESSAGE_CONTROL_CHARS,
} from './family-messages.dto';
import { FAMILY_LINK_SELECT, isClassroomLive, toFamilyLinkDto } from './family.service';

// Match classroom chat's admission budget, scoped to author + private thread.
const SEND_MAX_MESSAGES = 5;
const SEND_WINDOW_MS = 10_000;

const PARENT_LINK_MESSAGE_THREAD_SELECT = {
  ...FAMILY_LINK_SELECT,
  parentId: true,
} satisfies Prisma.ParentLinkSelect;

type ParentLinkMessageThreadRow = Prisma.ParentLinkGetPayload<{
  select: typeof PARENT_LINK_MESSAGE_THREAD_SELECT;
}>;

const STAFF_FAMILY_THREAD_SELECT = {
  id: true,
  classroomId: true,
  parentId: true,
  childId: true,
  createdAt: true,
  classroom: {
    select: {
      id: true,
      name: true,
      adultMode: true,
      deletedAt: true,
      schoolId: true,
      school: { select: { deletedAt: true } },
    },
  },
  parent: {
    select: {
      id: true,
      displayName: true,
    },
  },
  child: {
    select: {
      id: true,
      displayName: true,
    },
  },
  messages: {
    where: { hiddenAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      body: true,
      createdAt: true,
      authorId: true,
    },
  },
} satisfies Prisma.ParentLinkSelect;

type StaffFamilyThreadRow = Prisma.ParentLinkGetPayload<{
  select: typeof STAFF_FAMILY_THREAD_SELECT;
}>;

const MESSAGE_SELECT = {
  id: true,
  parentLinkId: true,
  authorId: true,
  body: true,
  createdAt: true,
  author: {
    select: {
      displayName: true,
    },
  },
} satisfies Prisma.MessageSelect;

type ParentLinkMessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

function validateMessageBody(input: unknown): string {
  if (typeof input !== 'string') {
    throw new RequestValidationException([{ field: 'body', messages: ['body must be a string'] }]);
  }
  if (UNSAFE_PARENT_MESSAGE_CONTROL_CHARS.test(input)) {
    throw new RequestValidationException([
      { field: 'body', messages: ['body must not contain control characters'] },
    ]);
  }
  const trimmed = input.trim();
  if (!/[^\s\u200B-\u200D\uFEFF]/u.test(trimmed)) {
    throw new RequestValidationException([{ field: 'body', messages: ['body must not be empty'] }]);
  }
  if (trimmed.length > PARENT_LINK_MESSAGE_MAX_BODY_LENGTH) {
    throw new RequestValidationException([
      {
        field: 'body',
        messages: [`body must not exceed ${PARENT_LINK_MESSAGE_MAX_BODY_LENGTH} characters`],
      },
    ]);
  }
  return trimmed;
}

function toParentLinkMessageDto(row: ParentLinkMessageRow, parentId: string): ParentLinkMessageDto {
  return {
    id: row.id,
    parentLinkId: row.parentLinkId!,
    authorId: row.authorId,
    authorDisplayName: row.author.displayName,
    authorRole: row.authorId === parentId ? 'PARENT' : 'STAFF',
    body: row.body,
    createdAt: toIsoString(row.createdAt),
  };
}

function toStaffFamilyThreadDto(row: StaffFamilyThreadRow): StaffFamilyThreadDto {
  const lastMessage = row.messages[0] ?? null;
  return {
    id: row.id,
    classroomId: row.classroom.id,
    classroomName: row.classroom.name,
    parentId: row.parent.id,
    parentDisplayName: row.parent.displayName,
    childId: row.child.id,
    childDisplayName: row.child.displayName,
    lastMessageBody: lastMessage ? lastMessage.body : null,
    lastMessageAt: lastMessage ? toIsoString(lastMessage.createdAt) : null,
    lastMessageAuthorRole: lastMessage
      ? lastMessage.authorId === row.parentId
        ? 'PARENT'
        : 'STAFF'
      : null,
  };
}

function compareStaffFamilyThreads(a: StaffFamilyThreadRow, b: StaffFamilyThreadRow): number {
  const aLast = a.messages[0]?.createdAt.getTime() ?? null;
  const bLast = b.messages[0]?.createdAt.getTime() ?? null;
  if (aLast !== bLast) {
    if (aLast === null) return 1;
    if (bLast === null) return -1;
    return bLast - aLast;
  }
  const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
  if (createdDiff !== 0) return createdDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Private Parent <-> Teacher messaging bound to an active `ParentLink` (`Message.parentLinkId`).
 * Enforces strict 404 anti-enumeration for non-participants (including the linked child, foreign
 * parents, and outsiders) and 403 while the classroom is in adult education mode.
 */
@Injectable()
export class FamilyMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  /**
   * Lists active parent-child messaging threads across every non-adult-mode live classroom where
   * the authenticated user is the classroom's independent teacher or has an active classroom
   * TEACHER membership (with active school TEACHER membership when school-owned), excluding
   * school Owner/Admin. Returns `{ items: [] }` without error for users without eligible teaching
   * classrooms.
   */
  async listMyFamilyThreads(actorUserId: string): Promise<StaffFamilyThreadsResponseDto> {
    if (!UUID_PATTERN.test(actorUserId)) {
      return { items: [] };
    }

    const staffClassrooms = await this.prisma.classroom.findMany({
      where: {
        deletedAt: null,
        adultMode: false,
        AND: [{ OR: [{ schoolId: null }, { school: { deletedAt: null } }] }],
        OR: [
          { independentTeacherId: actorUserId },
          {
            memberships: {
              some: {
                userId: actorUserId,
                role: ClassroomRole.TEACHER,
                state: MembershipState.ACTIVE,
                deletedAt: null,
              },
            },
            OR: [
              { schoolId: null },
              {
                school: {
                  members: {
                    some: {
                      userId: actorUserId,
                      state: MembershipState.ACTIVE,
                      role: SchoolRole.TEACHER,
                    },
                  },
                },
              },
            ],
          },
        ],
      },
      select: { id: true },
    });

    if (staffClassrooms.length === 0) {
      return { items: [] };
    }

    const staffClassroomIds = staffClassrooms.map((classroom) => classroom.id);
    const links = await this.prisma.parentLink.findMany({
      where: {
        classroomId: { in: staffClassroomIds },
        state: MembershipState.ACTIVE,
        classroom: {
          deletedAt: null,
          adultMode: false,
          OR: [{ schoolId: null }, { school: { deletedAt: null } }],
        },
      },
      select: STAFF_FAMILY_THREAD_SELECT,
    });

    const liveLinks = links.filter(
      (row) => !row.classroom.adultMode && isClassroomLive(row.classroom),
    );
    if (liveLinks.length === 0) {
      return { items: [] };
    }

    const activeMemberships = await this.prisma.classroomMembership.findMany({
      where: {
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
        deletedAt: null,
        OR: liveLinks.map((row) => ({
          classroomId: row.classroomId,
          userId: row.childId,
        })),
      },
      select: { classroomId: true, userId: true },
    });

    const activePairKeys = new Set(
      activeMemberships.map((membership) => `${membership.classroomId}:${membership.userId}`),
    );

    const activeLinks = liveLinks
      .filter((row) => activePairKeys.has(`${row.classroomId}:${row.childId}`))
      .sort(compareStaffFamilyThreads);

    return {
      items: activeLinks.map(toStaffFamilyThreadDto),
    };
  }

  async listMessages(
    actorUserId: string,
    linkId: string,
    query: ListParentLinkMessagesQueryDto,
  ): Promise<ParentLinkMessagesResponseDto> {
    const { link } = await this.resolveAuthorizedLink(actorUserId, linkId);

    const page = query.page ?? PARENT_LINK_MESSAGES_DEFAULT_PAGE;
    const pageSize = query.pageSize ?? PARENT_LINK_MESSAGES_DEFAULT_PAGE_SIZE;
    const skip = (page - 1) * pageSize;

    const where: Prisma.MessageWhereInput = {
      parentLinkId: link.id,
      hiddenAt: null,
    };

    const [total, rows] = await this.prisma.$transaction(
      async (tx) =>
        Promise.all([
          tx.message.count({ where }),
          tx.message.findMany({
            where,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            skip,
            take: pageSize,
            select: MESSAGE_SELECT,
          }),
        ]),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000 },
    );

    return {
      link: toFamilyLinkDto(link),
      items: rows.map((row) => toParentLinkMessageDto(row, link.parentId)),
      page,
      pageSize,
      total,
    };
  }

  async createMessage(
    actorUserId: string,
    linkId: string,
    dto: CreateParentLinkMessageDto,
  ): Promise<ParentLinkMessageDto> {
    const body = validateMessageBody(dto.body);
    return this.prisma.$transaction(
      async (tx) => {
        // Authorize before admission so contention never reveals a foreign thread.
        const { link } = await this.resolveAuthorizedLink(actorUserId, linkId, tx);
        const key = createHash('sha256')
          .update(`parent-message:${link.id.toLowerCase()}:${actorUserId.toLowerCase()}`)
          .digest()
          .readBigInt64BE(0);
        const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${key}) AS locked`;
        if (!lock?.locked) throw new HttpException('Parent message rate limit exceeded', 429);
        // Sample after admission, not transaction-start CURRENT_TIMESTAMP.
        const [clock] = await tx.$queryRaw<{ now: Date }[]>`
          SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
        const now = clock!.now;
        const count = await tx.message.count({
          where: {
            parentLinkId: link.id,
            authorId: actorUserId,
            createdAt: { gt: new Date(now.getTime() - SEND_WINDOW_MS) },
          },
        });
        if (count >= SEND_MAX_MESSAGES)
          throw new HttpException('Parent message rate limit exceeded', 429);
        const created = await tx.message.create({
          data: {
            parentLinkId: link.id,
            classroomId: null,
            authorId: actorUserId,
            body,
            createdAt: now,
          },
          select: MESSAGE_SELECT,
        });
        return toParentLinkMessageDto(created, link.parentId);
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }

  private async resolveAuthorizedLink(
    actorUserId: string,
    linkId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<{ link: ParentLinkMessageThreadRow; actorRole: ParentLinkMessageAuthorRole }> {
    if (!UUID_PATTERN.test(actorUserId) || !UUID_PATTERN.test(linkId)) {
      throw new NotFoundException('Parent link not found');
    }

    const link = await client.parentLink.findFirst({
      where: {
        id: linkId,
        state: MembershipState.ACTIVE,
        classroom: {
          deletedAt: null,
          OR: [{ schoolId: null }, { school: { deletedAt: null } }],
        },
      },
      select: PARENT_LINK_MESSAGE_THREAD_SELECT,
    });

    if (!link || !isClassroomLive(link.classroom)) {
      throw new NotFoundException('Parent link not found');
    }

    const childStillEnrolled = await this.access.isActiveStudent(link.classroomId, link.childId, {
      client,
    });
    if (!childStillEnrolled) {
      throw new NotFoundException('Parent link not found');
    }

    let actorRole: ParentLinkMessageAuthorRole;
    if (actorUserId === link.parentId) {
      actorRole = 'PARENT';
    } else {
      try {
        const access = await this.access.verifyClassroomAccess(actorUserId, link.classroomId, {
          requiredRole: 'STAFF',
          client,
        });
        // General staff authority is not private-conversation participation. Owner/Admin
        // are denied even when they also hold a classroom teaching membership.
        if (access.myRole !== 'TEACHER') throw new NotFoundException('Parent link not found');
        actorRole = 'STAFF';
      } catch (error) {
        if (error instanceof NotFoundException || error instanceof ForbiddenException) {
          throw new NotFoundException('Parent link not found');
        }
        throw error;
      }
    }

    if (link.classroom.adultMode) {
      throw new ForbiddenException(
        'Parent messaging is disabled while the classroom is in adult education mode',
      );
    }

    return { link, actorRole };
  }
}
