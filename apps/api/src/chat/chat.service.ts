import { createHash } from 'node:crypto';
import { ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { paginated, toSkipTake, type Paginated } from '../http/pagination/paginated';
import type { ChatHistoryMessageDto, ListMessagesQueryDto } from './chat.dto';
import { resolveMentionedUserIds } from '../announcements/announcements.service';
import { RequestValidationException } from '../http/validation';
import { MetricRecordingService } from '../metrics/metric-recording.service';
import { NotificationRecorder } from '../notifications/notification-recorder.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CHAT_MAX_BODY_LENGTH,
  CHAT_MAX_MENTIONED_USERS,
  CHAT_MENTION_SOURCE_TYPE,
  CHAT_RATE_LIMIT_MAX_MESSAGES,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from './chat-policy';

function invalidBody(message: string): never {
  throw new RequestValidationException([{ field: 'body', messages: [message] }]);
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
    private readonly notifications: NotificationRecorder,
    private readonly metrics: MetricRecordingService,
  ) {}

  async list(
    actorId: string,
    classroomId: string,
    query: ListMessagesQueryDto,
  ): Promise<Paginated<ChatHistoryMessageDto>> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'ANY',
    });
    if (access.myRole === 'PARENT')
      throw new ForbiddenException('Parents cannot use classroom chat');
    const where: Prisma.MessageWhereInput = {
      classroomId: access.classroom.id,
      ...(access.myRole === 'STUDENT' ? { hiddenAt: null } : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.message.count({ where });
        const rows = await tx.message.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
          select: {
            id: true,
            classroomId: true,
            authorId: true,
            body: true,
            createdAt: true,
            hiddenAt: true,
            hiddenById: true,
          },
        });
        const mentions = await tx.mention.findMany({
          where: {
            sourceType: CHAT_MENTION_SOURCE_TYPE,
            sourceId: { in: rows.map((row) => row.id) },
          },
          select: { sourceId: true, mentionedUserId: true },
          orderBy: { mentionedUserId: 'asc' },
        });
        const mentionedBySource = new Map<string, string[]>();
        for (const mention of mentions) {
          const users = mentionedBySource.get(mention.sourceId) ?? [];
          users.push(mention.mentionedUserId);
          mentionedBySource.set(mention.sourceId, users);
        }
        return paginated(
          rows.map((row) => ({
            id: row.id,
            classroomId: row.classroomId!,
            authorId: row.authorId,
            body: row.body,
            mentionedUserIds: mentionedBySource.get(row.id) ?? [],
            createdAt: row.createdAt.toISOString(),
            hiddenAt: row.hiddenAt?.toISOString() ?? null,
            hiddenById: row.hiddenById,
          })),
          total,
          query,
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10_000 },
    );
  }

  async send(actorId: string, classroomId: string, input: unknown) {
    if (typeof input !== 'string') invalidBody('body must be a string');
    const body = input.trim();
    // eslint-disable-next-line no-control-regex -- Allow tab/newline/CR, reject unsafe C0/C1 bytes.
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/u.test(input)) {
      invalidBody('body must not contain control characters');
    }
    if (!/[^\s\u200B-\u200D\uFEFF]/u.test(body) || body.length > CHAT_MAX_BODY_LENGTH) {
      invalidBody(`body must contain 1 to ${CHAT_MAX_BODY_LENGTH} characters of text`);
    }
    // UUID spelling must not split a pair's lock. Hash collisions only reject extra pairs (429).
    const key = createHash('sha256')
      .update(`chat:${classroomId.toLowerCase()}:${actorId.toLowerCase()}`)
      .digest()
      .readBigInt64BE(0);
    return this.prisma.$transaction(
      async (tx) => {
        // Non-blocking: a concurrent send for the same user/classroom is treated as exceeding
        // the send rate (429) instead of queueing, so bursts never pin pooled connections.
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${key}) AS locked`;
        if (!lock?.locked) throw new HttpException('Chat rate limit exceeded', 429);
        // Access uses current persisted state, not session claims.
        const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
          requiredRole: 'ANY',
          client: tx,
        });
        if (access.myRole === 'PARENT')
          throw new ForbiddenException('Parents cannot use classroom chat');
        classroomId = access.classroom.id;
        const [state] = await tx.$queryRaw<{ chat_muted: boolean }[]>`
        SELECT chat_muted FROM classrooms WHERE id = ${classroomId}::uuid AND deleted_at IS NULL FOR SHARE`;
        if (!state) throw new NotFoundException('Classroom not found');
        if (state.chat_muted && access.myRole === 'STUDENT')
          throw new ForbiddenException('Classroom chat is muted');
        const roster = await this.access.listActiveMentionCandidates(classroomId, tx);
        const mentionedUserIds = resolveMentionedUserIds(body, roster);
        if (mentionedUserIds.length > CHAT_MAX_MENTIONED_USERS)
          invalidBody(`body resolves to more than ${CHAT_MAX_MENTIONED_USERS} @mentions`);
        // Sample AFTER taking the admission lock, never transaction-start CURRENT_TIMESTAMP. Millisecond
        // precision matches Prisma Date and the explicitly persisted creation instant.
        const [clock] = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
        const now = clock!.now;
        const count = await tx.message.count({
          where: {
            classroomId,
            authorId: actorId,
            createdAt: { gt: new Date(now.getTime() - CHAT_RATE_LIMIT_WINDOW_MS) },
          },
        });
        if (count >= CHAT_RATE_LIMIT_MAX_MESSAGES)
          throw new HttpException('Chat rate limit exceeded', 429);
        const row = await tx.message.create({
          data: { classroomId, authorId: actorId, body, createdAt: now },
        });
        // Same transaction and instant as the row: the metric exists iff the message commits.
        await this.metrics.recordMessage(tx, {
          classroomId,
          userId: actorId,
          at: row.createdAt,
        });
        if (mentionedUserIds.length)
          await tx.mention.createMany({
            data: mentionedUserIds.map((mentionedUserId) => ({
              sourceType: CHAT_MENTION_SOURCE_TYPE,
              sourceId: row.id,
              mentionedUserId,
            })),
          });
        for (const recipientId of mentionedUserIds) {
          await this.notifications.record(tx, {
            kind: 'mention',
            classroomId,
            resourceId: row.id,
            recipientId,
          });
        }
        // Explicit application view, never a persistence entity exposed to consumers.
        return {
          id: row.id,
          classroomId,
          authorId: row.authorId,
          body: row.body,
          mentionedUserIds,
          createdAt: row.createdAt.toISOString(),
        };
      },
      { maxWait: 10_000, timeout: 15_000 },
    );
  }

  /**
   * Teacher moderation as a logical state change: the message row is never
   * deleted. Staff-only authorization first (students and parents get 403,
   * outsiders and unknown classrooms 404), then the message is resolved inside
   * this classroom so foreign or unknown identifiers never leak existence.
   * Moderation sets the audit pair atomically only while the row is still
   * visible, so repeating moderation cannot overwrite the original actor/time.
   */
  async hide(actorId: string, classroomId: string, messageId: string): Promise<void> {
    if (!UUID_PATTERN.test(messageId)) throw new NotFoundException('Message not found');
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'STAFF',
    });
    const row = await this.prisma.message.findFirst({
      where: { id: messageId, classroomId: access.classroom.id },
      select: { id: true, hiddenAt: true },
    });
    if (!row) throw new NotFoundException('Message not found');
    if (row.hiddenAt !== null) return; // First moderation wins; the audit pair is immutable.
    const [clock] = await this.prisma.$queryRaw<{ now: Date }[]>`
      SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
    await this.prisma.message.updateMany({
      where: { id: row.id, classroomId: access.classroom.id, hiddenAt: null },
      data: { hiddenAt: clock!.now, hiddenById: actorId },
    });
  }
}
