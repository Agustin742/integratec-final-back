import {
  CLASSROOM_LAYOUT,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_REASON_TOO_MANY_CONNECTIONS,
  MAX_CONNECTIONS_PER_USER,
} from '@aula/contracts';
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import type { ClassroomAuth, JoinVerifier } from '../join/join-verifier';
import { PresenceRegistry } from '../presence/presence-registry';
import { pickSpawnPoint } from '../presence/spawn';
import { authenticateJoin, parseClassroomId } from './authenticate-join';
import { Avatar, ClassroomState } from './classroom-state';

/** Room logic that does not depend on the verifier. */
export class ClassroomRoom extends Room<{ state: ClassroomState }> {
  classroomId = '';
  /** Not named `presence`: Colyseus already owns `room.presence`. */
  private readonly userConnections = new PresenceRegistry(MAX_CONNECTIONS_PER_USER);

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
   *
   * A user has one avatar however many connections they hold: the first connection creates it and
   * the last one to leave removes it. Over the cap the connection is refused with `4002`.
   */
  onJoin(client: Client): void {
    const auth = client.auth as ClassroomAuth | undefined;
    if (auth?.classroomId !== this.classroomId) {
      throw new ServerError(401, 'Unauthorized');
    }
    const attached = this.userConnections.attach(auth.userId, client.sessionId);
    if (attached.result === 'full') {
      throw new ServerError(CLOSE_CODE_TOO_MANY_CONNECTIONS, CLOSE_REASON_TOO_MANY_CONNECTIONS);
    }
    if (attached.first) this.addAvatar(auth);
  }

  onLeave(client: Client): void {
    const detached = this.userConnections.detach(client.sessionId);
    if (detached?.userGone) this.state.avatars.delete(detached.userId);
  }

  private addAvatar(identity: ClassroomAuth): void {
    const spawn = pickSpawnPoint(CLASSROOM_LAYOUT, [...this.state.avatars.values()]);
    const avatar = new Avatar();
    avatar.userId = identity.userId;
    avatar.displayName = identity.displayName;
    avatar.role = identity.role;
    avatar.x = spawn.x;
    avatar.z = spawn.z;
    this.state.avatars.set(identity.userId, avatar);
  }
}

/** Explicit shape so the anonymous class returned below stays declaration-emit friendly. */
export interface ClassroomRoomType {
  new (): ClassroomRoom;
  onAuth(token: string, options: unknown, context: AuthContext): Promise<ClassroomAuth>;
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
    ): Promise<ClassroomAuth> {
      return authenticateJoin(verifier, token, options);
    }
  };
}
