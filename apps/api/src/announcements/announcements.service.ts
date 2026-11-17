import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AccessVerificationService,
  UUID_PATTERN,
  type ClassroomAccessResult,
} from '../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import { RequestValidationException } from '../http/validation';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ANNOUNCEMENT_LIMITS,
  type AnnouncementDto,
  type CreateAnnouncementDto,
  type ListAnnouncementsQueryDto,
  type UpdateAnnouncementDto,
} from './announcements.dto';

/** Source discriminator stored in `Mention.sourceType` (PointTransaction pattern). */
const ANNOUNCEMENT_SOURCE_TYPE = 'announcement';

const announcementSelect = {
  id: true,
  classroomId: true,
  authorId: true,
  title: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AnnouncementSelect;

type AnnouncementRow = Prisma.AnnouncementGetPayload<{ select: typeof announcementSelect }>;

function toDto(row: AnnouncementRow, mentionedUserIds: readonly string[]): AnnouncementDto {
  return {
    id: row.id,
    classroomId: row.classroomId,
    authorId: row.authorId,
    title: row.title,
    content: row.content,
    mentionedUserIds: [...mentionedUserIds],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** School Owner and Admin hold teacher-level authority over every classroom of their school. */
function canModerateAll(access: ClassroomAccessResult): boolean {
  return access.myRole === 'OWNER' || access.myRole === 'ADMIN';
}

interface RosterMember {
  userId: string;
  displayName: string;
}

const MENTION_WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * Resolves `@mention` tokens against the classroom roster only; unresolved text stays
 * plain text. At each `@`, the longest roster display name that matches case-insensitively
 * on word boundaries wins, and every member sharing that display name is mentioned.
 */
export function resolveMentionedUserIds(
  content: string,
  roster: readonly RosterMember[],
): string[] {
  const names = [...new Set(roster.map((member) => member.displayName))]
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  const userIdsByName = new Map<string, string[]>();
  for (const member of roster) {
    const key = member.displayName.toLowerCase();
    const known = userIdsByName.get(key) ?? [];
    if (!known.includes(member.userId)) known.push(member.userId);
    userIdsByName.set(key, known);
  }

  const resolved: string[] = [];
  let searchFrom = 0;
  while (searchFrom < content.length) {
    const at = content.indexOf('@', searchFrom);
    if (at === -1) break;
    searchFrom = at + 1;
    if (at > 0 && MENTION_WORD_CHAR.test(content[at - 1] ?? '')) continue;
    const rest = content.slice(at + 1);
    for (const name of names) {
      if (rest.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
      const afterIndex = at + 1 + name.length;
      if (afterIndex < content.length && MENTION_WORD_CHAR.test(content[afterIndex] ?? '')) {
        continue;
      }
      for (const userId of userIdsByName.get(name.toLowerCase())!) {
        if (!resolved.includes(userId)) resolved.push(userId);
      }
      searchFrom = afterIndex;
      break;
    }
  }
  return resolved;
}

function assertMentionBound(resolved: readonly string[]): void {
  if (resolved.length > ANNOUNCEMENT_LIMITS.maxMentions) {
    throw new RequestValidationException([
      {
        field: 'content',
        messages: [`content resolves to more than ${ANNOUNCEMENT_LIMITS.maxMentions} @mentions`],
      },
    ]);
  }
}

/**
 * Bulletin-board notices (HU-COM-001). Authorization and business rules live here; the
 * controller is a transport adapter only. Announcements are created/edited/removed by
 * teacher-level staff, listed chronologically by members, and never physically deleted.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly notifications: NotificationRecorder,
  ) {}

  /**
   * Publishes an announcement. The announcement, its Mention rows and one
   * `announcement`/`mention` notification request per recipient are recorded in the same
   * transaction, so in-app notifications exist only after the publication commits.
   */
  async create(
    actorId: string,
    classroomId: string,
    dto: CreateAnnouncementDto,
  ): Promise<AnnouncementDto> {
    await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'TEACHER',
    });

    let mentionedForDto: string[] = [];
    const row = await this.prisma.$transaction(async (tx) => {
      const roster = await this.access.listActiveMentionCandidates(classroomId, tx);
      const mentionedUserIds = resolveMentionedUserIds(dto.content, roster);
      assertMentionBound(mentionedUserIds);

      const created = await tx.announcement.create({
        data: {
          classroomId,
          authorId: actorId,
          title: dto.title,
          content: dto.content,
        },
        select: announcementSelect,
      });
      if (mentionedUserIds.length > 0) {
        await tx.mention.createMany({
          data: mentionedUserIds.map((mentionedUserId) => ({
            sourceType: ANNOUNCEMENT_SOURCE_TYPE,
            sourceId: created.id,
            mentionedUserId,
          })),
          skipDuplicates: true,
        });
      }

      await this.recordNotifications(tx, classroomId, created.id, mentionedUserIds, actorId);
      mentionedForDto = mentionedUserIds;
      return created;
    });
    return toDto(row, mentionedForDto);
  }

  /**
   * Chronological listing for members without edit rights. Linked parents have no
   * classroom-wide content access (visibility decision is open), so they get 403.
   */
  async list(
    actorId: string,
    classroomId: string,
    query: ListAnnouncementsQueryDto,
  ): Promise<Paginated<AnnouncementDto>> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId);
    if (access.myRole === 'PARENT') {
      throw new ForbiddenException('Announcement access denied');
    }
    const where: Prisma.AnnouncementWhereInput = { classroomId, deletedAt: null };
    const { total, rows, mentionRows } = await this.prisma.$transaction(
      async (tx) => {
        const [counted, items] = await Promise.all([
          tx.announcement.count({ where }),
          tx.announcement.findMany({
            where,
            select: announcementSelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            ...toSkipTake(query),
          }),
        ]);
        // Mentions are generic (PointTransaction-style source columns), so they are read back
        // inside the same snapshot instead of through a relation include.
        const mentions =
          items.length > 0
            ? await tx.mention.findMany({
                where: {
                  sourceType: ANNOUNCEMENT_SOURCE_TYPE,
                  sourceId: { in: items.map((row) => row.id) },
                },
                orderBy: [{ createdAt: 'asc' }, { mentionedUserId: 'asc' }],
                select: { sourceId: true, mentionedUserId: true },
              })
            : [];
        return { total: counted, rows: items, mentionRows: mentions };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const mentionedBySource = new Map<string, string[]>();
    for (const mention of mentionRows) {
      const known = mentionedBySource.get(mention.sourceId) ?? [];
      known.push(mention.mentionedUserId);
      mentionedBySource.set(mention.sourceId, known);
    }
    return paginated(
      rows.map((row) => toDto(row, mentionedBySource.get(row.id) ?? [])),
      total,
      query,
    );
  }

  /** Edits title/content. Authors may edit their own; school Owner/Admin may edit any. */
  async update(
    actorId: string,
    classroomId: string,
    announcementId: string,
    dto: UpdateAnnouncementDto,
  ): Promise<AnnouncementDto> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'TEACHER',
    });
    if (!UUID_PATTERN.test(announcementId)) throw this.notFound();

    let mentionedForDto: string[] = [];
    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM announcements
        WHERE id = ${announcementId}::uuid AND classroom_id = ${classroomId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE`;
      if (locked.length === 0) throw this.notFound();
      const existing = await tx.announcement.findFirstOrThrow({
        where: { id: announcementId, classroomId, deletedAt: null },
        select: { authorId: true, title: true, content: true },
      });
      if (!canModerateAll(access) && existing.authorId !== actorId) {
        throw new ForbiddenException('Announcement author authority required');
      }

      const title = dto.title ?? existing.title;
      const content = dto.content ?? existing.content;
      const roster = await this.access.listActiveMentionCandidates(classroomId, tx);
      const mentionedUserIds = resolveMentionedUserIds(content, roster);
      assertMentionBound(mentionedUserIds);

      const previous = await tx.mention.findMany({
        where: { sourceType: ANNOUNCEMENT_SOURCE_TYPE, sourceId: announcementId },
        select: { mentionedUserId: true },
      });
      const previousIds = new Set(previous.map((mention) => mention.mentionedUserId));
      const removedIds = [...previousIds].filter((id) => !mentionedUserIds.includes(id));
      if (removedIds.length > 0) {
        await tx.mention.deleteMany({
          where: {
            sourceType: ANNOUNCEMENT_SOURCE_TYPE,
            sourceId: announcementId,
            mentionedUserId: { in: removedIds },
          },
        });
      }
      const addedIds = mentionedUserIds.filter((id) => !previousIds.has(id));
      if (addedIds.length > 0) {
        await tx.mention.createMany({
          data: addedIds.map((mentionedUserId) => ({
            sourceType: ANNOUNCEMENT_SOURCE_TYPE,
            sourceId: announcementId,
            mentionedUserId,
          })),
          skipDuplicates: true,
        });
      }

      const updated = await tx.announcement.update({
        where: { id: announcementId },
        data: { title, content },
        select: announcementSelect,
      });

      if (addedIds.length > 0) {
        await this.recordNotifications(tx, classroomId, announcementId, addedIds, actorId, false);
      }
      mentionedForDto = mentionedUserIds;
      return updated;
    });
    return toDto(row, mentionedForDto);
  }

  /**
   * Logical removal (RN-18): the row and its mentions stay; the notice only stops being
   * listed. Authors may remove their own; school Owner/Admin may remove any.
   */
  async remove(actorId: string, classroomId: string, announcementId: string): Promise<void> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'TEACHER',
    });
    if (!UUID_PATTERN.test(announcementId)) throw this.notFound();

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; authorId: string }[]>`
        SELECT id, author_id AS "authorId" FROM announcements
        WHERE id = ${announcementId}::uuid AND classroom_id = ${classroomId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE`;
      if (locked.length === 0) throw this.notFound();
      if (!canModerateAll(access) && locked[0].authorId !== actorId) {
        throw new ForbiddenException('Announcement author authority required');
      }
      await tx.announcement.update({
        where: { id: announcementId },
        data: { deletedAt: new Date() },
        select: { id: true },
      });
    });
  }

  /**
   * Records notification requests inside the caller's transaction: one `announcement`
   * notice per active student (never the author) and one `mention` notice per mentioned
   * member. Delivery is decided after commit by the notification service, which re-checks
   * current access, so a recipient who lost access never receives the notice.
   */
  private async recordNotifications(
    tx: Prisma.TransactionClient,
    classroomId: string,
    announcementId: string,
    mentionedUserIds: readonly string[],
    authorId: string,
    published = true,
  ): Promise<void> {
    const recipients = published
      ? await this.access.listActiveStudentIds(classroomId, { excludeUserId: authorId, client: tx })
      : [];
    for (const recipientId of recipients) {
      await this.notifications.record(tx, {
        kind: 'announcement',
        classroomId,
        resourceId: announcementId,
        recipientId,
      });
    }
    for (const recipientId of mentionedUserIds) {
      await this.notifications.record(tx, {
        kind: 'mention',
        classroomId,
        resourceId: announcementId,
        recipientId,
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Announcement not found');
  }
}
