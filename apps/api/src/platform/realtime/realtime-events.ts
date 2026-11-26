/**
 * Realtime event types written through the transactional outbox. Delivery is at least once, so
 * handlers must be idempotent.
 */

import type { MemberAppearance, TutorBotSkin } from '@aula/contracts';

/**
 * A user's access to one classroom ended (membership deactivated or removed).
 * Payload: `{ userId, classroomId }`.
 */
export const REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT = 'realtime.classroom-access-revoked';

/**
 * A teacher removed a student from a classroom (written by `ClassroomRemovalService`, #23). The
 * eviction handler subscribes to it directly, so removal needs no second event: the same row that
 * records the removal evicts the student's live connections in that classroom.
 * Payload: `{ classroomId, membershipId, userId }`.
 */
export const CLASSROOM_MEMBERSHIP_REMOVED_EVENT = 'classroom.membership.removed';

/**
 * One session, or every session of a user, was revoked (logout, refresh token reuse, password
 * reset). Payload: `{ userId, sessionId }` for one session, `{ userId }` for all of them.
 */
export const REALTIME_SESSIONS_REVOKED_EVENT = 'realtime.sessions-revoked';

/**
 * A member's appearance in one classroom changed (base avatar patch or equip/unequip, #114).
 * Payload: `{ classroomId, userId, appearanceRevision, appearance }`, where `appearance` is the
 * full per-classroom public snapshot built by `memberAppearanceFor`. The revision is monotonic per
 * user. The base avatar is global, so an avatar patch records one event per classroom with live
 * access; equipment is classroom-scoped, so an equip or unequip records one event for its own
 * classroom.
 */
export const REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT = 'realtime.classroom-appearance-changed';

/**
 * Desks were added to a classroom by auto-expansion (#79). Payload: `{ classroomId, deskCount }`,
 * where `deskCount` is the classroom's desk count after the insert, counted in the same
 * transaction. Desks are never deleted, so realtime only ever grows a room's layout from it.
 */
export const REALTIME_CLASSROOM_LAYOUT_CHANGED_EVENT = 'realtime.classroom-layout-changed';

/**
 * Classroom staff changed the tutor bot skin (#154). Payload:
 * `{ classroomId, tutorBotSkin, tutorBotSkinRevision }`. The skin can change back and forth, so the
 * revision (monotonic per classroom) lets realtime discard stale at-least-once deliveries.
 */
export const REALTIME_CLASSROOM_TUTOR_BOT_SKIN_CHANGED_EVENT =
  'realtime.classroom-tutor-bot-skin-changed';

export interface ClassroomTutorBotSkinChangedPayload {
  classroomId: string;
  tutorBotSkin: TutorBotSkin;
  tutorBotSkinRevision: number;
}

export interface ClassroomLayoutChangedPayload {
  classroomId: string;
  deskCount: number;
}

export interface ClassroomAccessRevokedPayload {
  userId: string;
  classroomId: string;
}

/** A committed message ID to resolve from PostgreSQL before it is sent to Colyseus. */
export const REALTIME_CHAT_MESSAGE_CREATED_EVENT = 'realtime.chat-message-created';
export interface RealtimeChatMessageCreatedPayload {
  classroomId: string;
  messageId: string;
}

/** A committed logical moderation change. */
export const REALTIME_CHAT_MESSAGE_HIDDEN_EVENT = 'realtime.chat-message-hidden';
export interface RealtimeChatMessageHiddenPayload {
  classroomId: string;
  messageId: string;
  hiddenAt: string;
}

export interface SessionsRevokedPayload {
  userId: string;
  sessionId?: string;
}

export interface ClassroomAppearanceChangedPayload {
  classroomId: string;
  userId: string;
  /** Monotonically increasing per user, so realtime can discard stale at-least-once deliveries. */
  appearanceRevision: number;
  /** Public fields only (#114): base avatar plus equipped items, validated by `memberAppearanceSchema`. */
  appearance: MemberAppearance;
}
