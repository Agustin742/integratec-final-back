import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import type { JoinVerifier, VerifiedJoin } from '../join/join-verifier';
import { authenticateJoin, parseClassroomId } from './authenticate-join';
import { ClassroomState } from './classroom-state';

/** Room logic that does not depend on the verifier. */
export class ClassroomRoom extends Room<{ state: ClassroomState }> {
  classroomId = '';

  onCreate(options: unknown): void {
    const classroomId = parseClassroomId(options);
    if (classroomId === undefined) {
      throw new ServerError(400, 'Bad request');
    }
    this.classroomId = classroomId;
    this.state = new ClassroomState();
    this.state.classroomId = classroomId;
  }

  /**
   * `joinById` ignores `filterBy`, so a client verified for classroom A could name room B.
   * The identity verified for this exact room must match the room's own classroom.
   */
  onJoin(client: Client): void {
    const auth = client.auth as VerifiedJoin | undefined;
    if (auth?.classroomId !== this.classroomId) {
      throw new ServerError(401, 'Unauthorized');
    }
  }
}

/** Explicit shape so the anonymous class returned below stays declaration-emit friendly. */
export interface ClassroomRoomType {
  new (): ClassroomRoom;
  onAuth(token: string, options: unknown, context: AuthContext): Promise<VerifiedJoin>;
}

/**
 * Binds {@link ClassroomRoom} to a verifier. Colyseus calls the static `onAuth` detached from the
 * class (no `this`), so the verifier is closed over instead of being read from a static
 * property. This also keeps tests free of shared mutable module state.
 *
 * `onAuth` runs at matchmake time with the `Authorization` token; its result becomes `client.auth`.
 */
export function createClassroomRoom(verifier: JoinVerifier): ClassroomRoomType {
  return class extends ClassroomRoom {
    static override async onAuth(
      token: string,
      options: unknown,
      _context: AuthContext,
    ): Promise<VerifiedJoin> {
      return authenticateJoin(verifier, token, options);
    }
  };
}
