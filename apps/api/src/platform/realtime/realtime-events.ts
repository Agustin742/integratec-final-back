/**
 * Outbox events that tell the realtime server a user lost live access (decision D14). They are
 * recorded in the same transaction as the change that caused them and delivered at least once, so
 * their handler must be idempotent (closing the same connections twice is harmless).
 */

/**
 * A user's access to one classroom ended (membership deactivated or removed).
 * Payload: `{ userId, classroomId }`.
 */
export const REALTIME_CLASSROOM_ACCESS_REVOKED_EVENT = 'realtime.classroom-access-revoked';

/**
 * One session, or every session of a user, was revoked (logout, refresh token reuse, password
 * reset). Payload: `{ userId, sessionId }` for one session, `{ userId }` for all of them.
 */
export const REALTIME_SESSIONS_REVOKED_EVENT = 'realtime.sessions-revoked';

export interface ClassroomAccessRevokedPayload {
  userId: string;
  classroomId: string;
}

export interface SessionsRevokedPayload {
  userId: string;
  sessionId?: string;
}
