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
}

export const toClassroomAuth = (identity: VerifiedJoin): ClassroomAuth => ({
  userId: identity.userId,
  authSessionId: identity.sessionId,
  classroomId: identity.classroomId,
  role: identity.role,
  displayName: identity.displayName,
});

/** Asks the authorization service whether a token may enter a classroom. */
export interface JoinVerifier {
  /** Resolves with the verified identity or rejects with {@link JoinDeniedError}. */
  verify(accessToken: string, classroomId: string): Promise<VerifiedJoin>;
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
