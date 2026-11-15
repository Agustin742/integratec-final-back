import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityState, type Prisma } from '@prisma/client';
import { UUID_PATTERN } from '../../access/access-verification.service';
import {
  AccessVerificationService,
  type ClassroomAccessResult,
} from '../../access/access-verification.service';
import type { Paginated } from '../../http/pagination/paginated';
import { RequestValidationException } from '../../http/validation';
import { paginated, toSkipTake } from '../../http/pagination/paginated';
import { parseSort } from '../../http/pagination/sort';
import {
  FORUM_POST_BODY_MAX_LENGTH,
  FORUM_POST_SORT_OPTIONS,
  FORUM_THREAD_SORT_OPTIONS,
  type CreateForumPostDto,
  type CreateForumThreadDto,
  type ForumPostDto,
  type ForumThreadDetailDto,
  type ForumThreadSummaryDto,
  type ListForumPostsQueryDto,
  type ListForumThreadsQueryDto,
} from './activity-forum.dto';
import { NotificationRecorder } from '../../notifications/notification-recorder.service';
import { PrismaService } from '../../prisma/prisma.service';

const THREAD_FIRST_POST_SELECT: Prisma.ActivityForumThread$postsArgs = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  take: 1,
  select: { body: true },
};

function toPostDto(row: {
  id: string;
  threadId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}): ForumPostDto {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Per-activity query forum (HU-COM-003, MVP Core). Enrolled students and the
 * classroom's teaching staff create threads (the first post is the question), reply,
 * and read paginated lists. It uses its own entities instead of `Message`, which
 * `rules/data.md` pins to the classroom channel or a parent conversation. Parents have
 * no forum access; resources outside the actor's scope respond 404.
 */
@Injectable()
export class ActivityForumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly notifications: NotificationRecorder,
  ) {}

  /**
   * Creates a thread with its first post (the question). The row lock serializes the
   * publish-independent activity checks; the access check runs first so a stranger
   * never reaches the activity row.
   */
  async createThread(
    actorId: string,
    classroomId: string,
    activityId: string,
    dto: CreateForumThreadDto,
  ): Promise<ForumThreadDetailDto> {
    const access = await this.verifyForumAccess(actorId, classroomId);
    const activity = await this.loadActivity(activityId, classroomId, access);
    const body = this.validateBody(dto.body);

    const thread = await this.prisma.activityForumThread.create({
      data: {
        activityId: activity.id,
        authorId: actorId,
        posts: { create: { authorId: actorId, body } },
      },
      select: {
        id: true,
        activityId: true,
        authorId: true,
        createdAt: true,
        posts: {
          select: { id: true, threadId: true, authorId: true, body: true, createdAt: true },
        },
      },
    });
    return toThreadDetail(thread);
  }

  /** Replies inside one thread; a staff reply notifies the thread author after commit. */
  async createPost(
    actorId: string,
    classroomId: string,
    activityId: string,
    threadId: string,
    dto: CreateForumPostDto,
  ): Promise<ForumPostDto> {
    const access = await this.verifyForumAccess(actorId, classroomId);
    await this.loadActivity(activityId, classroomId, access);
    if (!UUID_PATTERN.test(threadId)) throw this.notFound();
    const body = this.validateBody(dto.body);

    const row = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; authorId: string }[]>`
        SELECT id, author_id AS "authorId" FROM activity_forum_threads
        WHERE id = ${threadId}::uuid AND activity_id = ${activityId}::uuid
        FOR UPDATE`;
      if (locked.length === 0) throw this.notFound();
      const created = await tx.activityForumPost.create({
        data: { threadId, authorId: actorId, body },
        select: { id: true, threadId: true, authorId: true, body: true, createdAt: true },
      });
      // Teacher-level staff replying in someone else's thread notifies the author (the
      // student asked for exactly this, S2). The outbox materialization re-checks the
      // recipient's current access, so a member who lost access never receives it.
      const [thread] = locked;
      const isStaff =
        access.myRole === 'OWNER' || access.myRole === 'ADMIN' || access.myRole === 'TEACHER';
      if (isStaff && thread.authorId !== actorId) {
        await this.notifications.record(tx, {
          kind: 'activity_forum_reply',
          classroomId,
          resourceId: threadId,
          recipientId: thread.authorId,
        });
      }
      return created;
    });
    return toPostDto(row);
  }

  async listThreads(
    actorId: string,
    classroomId: string,
    activityId: string,
    query: ListForumThreadsQueryDto,
  ): Promise<Paginated<ForumThreadSummaryDto>> {
    const access = await this.verifyForumAccess(actorId, classroomId);
    const activity = await this.loadActivity(activityId, classroomId, access);
    const sort = parseSort(query.sort, FORUM_THREAD_SORT_OPTIONS);
    const where: Prisma.ActivityForumThreadWhereInput = { activityId: activity.id };
    const [rows, total] = await Promise.all([
      this.prisma.activityForumThread.findMany({
        where,
        ...toSkipTake(query),
        orderBy: [{ [sort.field]: sort.direction }, { id: 'asc' }],
        select: {
          id: true,
          activityId: true,
          authorId: true,
          createdAt: true,
          posts: THREAD_FIRST_POST_SELECT,
          _count: { select: { posts: true } },
        },
      }),
      this.prisma.activityForumThread.count({ where }),
    ]);
    const items = rows.map(toThreadSummary);
    return paginated(items, total, query);
  }

  async listPosts(
    actorId: string,
    classroomId: string,
    activityId: string,
    threadId: string,
    query: ListForumPostsQueryDto,
  ): Promise<Paginated<ForumPostDto>> {
    const access = await this.verifyForumAccess(actorId, classroomId);
    await this.loadActivity(activityId, classroomId, access);
    if (!UUID_PATTERN.test(threadId)) throw this.notFound();
    const thread = await this.prisma.activityForumThread.findFirst({
      where: { id: threadId, activityId },
      select: { id: true },
    });
    if (!thread) throw this.notFound();
    const sort = parseSort(query.sort, FORUM_POST_SORT_OPTIONS);
    const where: Prisma.ActivityForumPostWhereInput = { threadId };
    const [rows, total] = await Promise.all([
      this.prisma.activityForumPost.findMany({
        where,
        ...toSkipTake(query),
        orderBy: [{ [sort.field]: sort.direction }, { id: 'asc' }],
        select: { id: true, threadId: true, authorId: true, body: true, createdAt: true },
      }),
      this.prisma.activityForumPost.count({ where }),
    ]);
    return paginated(rows.map(toPostDto), total, query);
  }

  /**
   * Enrolled students and teaching staff use the forum; parents do not (the matrix
   * reserves the classroom forum for students and staff). A visible-but-not-allowed
   * parent gets 403, mirroring the activities module.
   */
  private async verifyForumAccess(
    actorId: string,
    classroomId: string,
  ): Promise<ClassroomAccessResult> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'ANY',
    });
    if (access.myRole === 'PARENT') {
      throw new ForbiddenException('Parents cannot use the activity forum');
    }
    return access;
  }

  /**
   * Resolves the activity inside the classroom and hides drafts from students (404),
   * mirroring the activities module read rules. Staff also see drafts.
   */
  private async loadActivity(
    activityId: string,
    classroomId: string,
    access: ClassroomAccessResult,
  ): Promise<{ id: string }> {
    if (!UUID_PATTERN.test(activityId)) throw this.notFound();
    const isStaff =
      access.myRole === 'OWNER' || access.myRole === 'ADMIN' || access.myRole === 'TEACHER';
    const row = await this.prisma.activity.findFirst({
      where: {
        id: activityId,
        classroomId,
        deletedAt: null,
        ...(isStaff ? {} : { state: ActivityState.PUBLISHED }),
      },
      select: { id: true },
    });
    if (!row) throw this.notFound();
    return row;
  }

  /**
   * Bodies are non-empty after trimming and bounded server-side (the DTO validates the
   * same bound; the service enforces the invariant again inside the business layer).
   */
  private validateBody(raw: string): string {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > FORUM_POST_BODY_MAX_LENGTH) {
      throw new RequestValidationException([
        {
          field: 'body',
          messages: [`body must be 1-${FORUM_POST_BODY_MAX_LENGTH} characters after trimming`],
        },
      ]);
    }
    return trimmed;
  }

  private notFound(): NotFoundException {
    return new NotFoundException('Activity forum thread not found');
  }
}

function toThreadSummary(row: {
  id: string;
  activityId: string;
  authorId: string;
  createdAt: Date;
  posts: { body: string }[];
  _count: { posts: number };
}): ForumThreadSummaryDto {
  return {
    id: row.id,
    activityId: row.activityId,
    authorId: row.authorId,
    firstPostBody: row.posts[0]?.body ?? '',
    replyCount: Math.max(0, row._count.posts - 1),
    createdAt: row.createdAt.toISOString(),
  };
}

function toThreadDetail(row: {
  id: string;
  activityId: string;
  authorId: string;
  createdAt: Date;
  posts: { id: string; threadId: string; authorId: string; body: string; createdAt: Date }[];
}): ForumThreadDetailDto {
  return {
    id: row.id,
    activityId: row.activityId,
    authorId: row.authorId,
    posts: row.posts.map(toPostDto),
    createdAt: row.createdAt.toISOString(),
  };
}
