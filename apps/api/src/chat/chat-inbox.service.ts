import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessVerificationService, UUID_PATTERN } from '../access/access-verification.service';
import { PrismaService } from '../prisma/prisma.service';
import type { ChatInboxDto, ChatInboxItemDto } from './chat.dto';
import { CHAT_INBOX_MAX_CLASSROOMS, CHAT_INBOX_PREVIEW_MAX_LENGTH } from './chat-policy';

interface InboxRow {
  classroom_id: string;
  message_id: string | null;
  author_id: string | null;
  author_display_name: string | null;
  body: string | null;
  created_at: Date | null;
  unread_count: number;
}

function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  if (chars.length <= CHAT_INBOX_PREVIEW_MAX_LENGTH) return flat;
  return `${chars.slice(0, CHAT_INBOX_PREVIEW_MAX_LENGTH - 1).join('')}…`;
}

@Injectable()
export class ChatInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessVerificationService,
  ) {}

  /**
   * One summary per classroom where the caller currently is a student or staff member.
   * Classroom visibility comes from the same access derivation as chat history (parents
   * resolve to PARENT and are dropped, removed members resolve to nothing). At most
   * {@link CHAT_INBOX_MAX_CLASSROOMS} classrooms are considered, by name. Message data
   * comes from ONE statement (one snapshot, no per-classroom queries): hidden messages
   * never appear in the preview and never count, for any role.
   */
  async list(actorId: string): Promise<ChatInboxDto> {
    const { items: accessible } = await this.access.listAccessibleClassrooms(actorId, {
      skip: 0,
      take: CHAT_INBOX_MAX_CLASSROOMS,
      sort: { field: 'name', direction: 'asc' },
    });
    const rooms = accessible.filter((entry) => entry.myRole !== 'PARENT');
    if (rooms.length === 0) return { items: [] };

    const rows = await this.prisma.$queryRaw<InboxRow[]>`
      SELECT c.id AS classroom_id,
             lm.id AS message_id,
             lm.author_id,
             u.display_name AS author_display_name,
             lm.body,
             lm.created_at,
             COALESCE(un.unread_count, 0)::int AS unread_count
      FROM unnest(${rooms.map((entry) => entry.classroom.id)}::uuid[]) AS c(id)
      LEFT JOIN chat_read_markers mk
        ON mk.classroom_id = c.id AND mk.user_id = ${actorId}::uuid
      LEFT JOIN LATERAL (
        SELECT m.id, m.author_id, m.body, m.created_at
        FROM messages m
        WHERE m.classroom_id = c.id AND m.hidden_at IS NULL
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 1
      ) lm ON TRUE
      LEFT JOIN users u ON u.id = lm.author_id
      LEFT JOIN LATERAL (
        SELECT count(*) AS unread_count
        FROM messages m
        WHERE m.classroom_id = c.id
          AND m.hidden_at IS NULL
          AND m.author_id <> ${actorId}::uuid
          AND (mk.last_read_message_id IS NULL
               OR (m.created_at, m.id) > (mk.last_read_at, mk.last_read_message_id))
      ) un ON TRUE`;
    const byClassroom = new Map(rows.map((row) => [row.classroom_id, row]));

    const items = rooms.map(({ classroom }): ChatInboxItemDto => {
      const row = byClassroom.get(classroom.id);
      return {
        classroomId: classroom.id,
        classroomName: classroom.name,
        lastMessage:
          row?.message_id && row.created_at
            ? {
                id: row.message_id,
                authorId: row.author_id!,
                authorDisplayName: row.author_display_name ?? '',
                bodyPreview: previewOf(row.body ?? ''),
                createdAt: row.created_at.toISOString(),
              }
            : null,
        unreadCount: row?.unread_count ?? 0,
      };
    });
    // Latest activity first (id breaks instant ties); silent classrooms last, by name then id.
    const time = (item: ChatInboxItemDto) =>
      item.lastMessage ? new Date(item.lastMessage.createdAt).getTime() : null;
    return {
      items: items.sort((a, b) => {
        const [ta, tb] = [time(a), time(b)];
        if (ta !== null && tb !== null) {
          return tb - ta || (a.lastMessage!.id < b.lastMessage!.id ? 1 : -1);
        }
        if (ta !== null) return -1;
        if (tb !== null) return 1;
        return (
          a.classroomName.localeCompare(b.classroomName) || (a.classroomId < b.classroomId ? -1 : 1)
        );
      }),
    };
  }

  /**
   * Advances the caller's read marker. Same access as chat history (parents 403, outsiders
   * 404). The message must be a VISIBLE message of this classroom (anything else is 404, so
   * foreign or hidden ids never leak). The upsert is a single statement that only replaces
   * an existing marker when the new (createdAt, id) is strictly greater (the instant is copied in SQL from the message row, keeping microsecond precision), so repeating a
   * request or racing a newer one can never move the marker backwards.
   */
  async markRead(actorId: string, classroomId: string, messageId: string): Promise<void> {
    const access = await this.access.verifyClassroomAccess(actorId, classroomId, {
      requiredRole: 'ANY',
    });
    if (access.myRole === 'PARENT')
      throw new ForbiddenException('Parents cannot use classroom chat');
    if (!UUID_PATTERN.test(messageId)) throw new NotFoundException('Message not found');
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, classroomId: access.classroom.id, hiddenAt: null },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    await this.prisma.$executeRaw`
      INSERT INTO chat_read_markers
        (user_id, classroom_id, last_read_message_id, last_read_at, updated_at)
      SELECT ${actorId}::uuid, m.classroom_id, m.id, m.created_at, now()
      FROM messages m
      WHERE m.id = ${message.id}::uuid AND m.classroom_id = ${access.classroom.id}::uuid
      ON CONFLICT (user_id, classroom_id) DO UPDATE
        SET last_read_message_id = EXCLUDED.last_read_message_id,
            last_read_at = EXCLUDED.last_read_at,
            updated_at = EXCLUDED.updated_at
        WHERE (chat_read_markers.last_read_at, chat_read_markers.last_read_message_id)
              < (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)`;
  }
}
