/** Roles allowed in a live room. Parents have no live access (rules/realtime-and-presence.md). */
export const CLASSROOM_ROLES = ['OWNER', 'ADMIN', 'TEACHER', 'STUDENT'] as const;
export type ClassroomRole = (typeof CLASSROOM_ROLES)[number];

/** Identity the API confirmed for a join: who, through which session, in which classroom. */
export interface VerifiedJoin {
  userId: string;
  sessionId: string;
  classroomId: string;
  role: ClassroomRole;
}

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
