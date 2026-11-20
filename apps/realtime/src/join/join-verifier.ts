import type { MemberAppearance } from '@aula/contracts';

/** Roles allowed in a live room. Parents have no live access (rules/realtime-and-presence.md). */
export const CLASSROOM_ROLES = ['OWNER', 'ADMIN', 'TEACHER', 'STUDENT'] as const;
export type ClassroomRole = (typeof CLASSROOM_ROLES)[number];

/** Identity the API confirmed for a join: who, through which session, in which classroom. */
export interface VerifiedJoin {
  userId: string;
  sessionId: string;
  classroomId: string;
  role: ClassroomRole;
  /** Name shown on the avatar; it comes from the API, never from the client. */
  displayName: string;
  /** Public appearance of the member in this classroom (#114): base avatar + equipped items. */
  appearance: MemberAppearance;
  /** Monotonic per-user appearance version for rejecting delayed outbox deliveries. */
  appearanceRevision: number;
}

/**
 * What a connection carries as `client.auth`. The account session id is deliberately named
 * `authSessionId`: Colyseus adopts `auth.sessionId` as the id of the connection itself, so a key
 * with that name would give every connection of one account the same id.
 */
export interface ClassroomAuth {
  userId: string;
  authSessionId: string;
  classroomId: string;
  role: ClassroomRole;
  displayName: string;
  /** Public appearance confirmed by the API; refreshed on admission and reconnection (#114). */
  appearance: MemberAppearance;
  appearanceRevision: number;
}

export const toClassroomAuth = (identity: VerifiedJoin): ClassroomAuth => ({
  userId: identity.userId,
  authSessionId: identity.sessionId,
  classroomId: identity.classroomId,
  role: identity.role,
  displayName: identity.displayName,
  appearance: identity.appearance,
  appearanceRevision: identity.appearanceRevision,
});

/** A connection that was verified at join and now asks to come back. */
export interface ReverifyRequest {
  userId: string;
  authSessionId: string;
  classroomId: string;
}

/** Asks the authorization service whether a token may enter a classroom. */
export interface JoinVerifier {
  /** Resolves with the verified identity or rejects with {@link JoinDeniedError}. */
  verify(accessToken: string, classroomId: string): Promise<VerifiedJoin>;
  /**
   * Repeats the access check for a user already verified at join, with no token: the token may
   * have expired during the session, while the verified user and session are still checked
   * against current persisted state. Rejects with {@link JoinDeniedError} when access was lost,
   * and with {@link JoinVerificationUnavailableError} when the answer could not be obtained.
   */
  reverify(request: ReverifyRequest): Promise<VerifiedJoin>;
}

/**
 * The join was not authorized. The message is deliberately generic and the error carries no
 * cause: the reason (bad token, no access, API down) must never reach the client or the logs.
 */
export class JoinDeniedError extends Error {
  constructor() {
    super('Join denied');
    this.name = 'JoinDeniedError';
  }
}

/**
 * The access check could not be completed (network error, timeout, 5xx, throttling). It says
 * nothing about the user's access, which is why it is a different failure from
 * {@link JoinDeniedError}: callers fail closed either way but tell the client it may retry. Like
 * the denial, it carries no cause so nothing sensitive can leak.
 */
export class JoinVerificationUnavailableError extends Error {
  constructor() {
    super('Join verification unavailable');
    this.name = 'JoinVerificationUnavailableError';
  }
}
