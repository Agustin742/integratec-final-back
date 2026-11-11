import {
  AVATAR_INPUT_MESSAGE,
  CLASSROOM_LAYOUT,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_REASON_TOO_MANY_CONNECTIONS,
  INPUT_RATE_LIMIT_PER_SECOND,
  MAX_CONNECTIONS_PER_USER,
  PATCH_RATE_HZ,
  SIMULATION_TICK_RATE_HZ,
  avatarInputSchema,
  type AvatarInput,
} from '@aula/contracts';
import { Room, ServerError, validate, type AuthContext, type Client } from '@colyseus/core';
import type { ClassroomAuth, JoinVerifier } from '../join/join-verifier';
import { RateLimiter } from '../movement/rate-limiter';
import { stepAvatar } from '../movement/step-avatar';
import { PresenceRegistry } from '../presence/presence-registry';
import { pickSpawnPoint } from '../presence/spawn';
import { authenticateJoin, parseClassroomId } from './authenticate-join';
import { Avatar, ClassroomState } from './classroom-state';

/** Collaborators and settings a room receives from the server bootstrap. */
export interface ClassroomRoomOptions {
  /** Milliseconds clock shared by rate limiting and time tracking; injectable for tests. */
  now?: () => number;
}

interface Intent extends AvatarInput {
  /** Connection that sent it: when it leaves, the avatar stops. */
  owner: string;
}

/** Room logic that does not depend on the verifier. */
export class ClassroomRoom extends Room<{ state: ClassroomState }> {
  classroomId = '';
  protected options: ClassroomRoomOptions = {};
  /** Not named `presence`: Colyseus already owns `room.presence`. */
  private readonly userConnections = new PresenceRegistry(MAX_CONNECTIONS_PER_USER);
  private readonly limiters = new Map<string, RateLimiter>();
  /** Latest direction per user, shared by all of their connections (the last input wins). */
  private readonly intents = new Map<string, Intent>();

  /**
   * Client intents. Payloads are validated by Colyseus against the shared contract schema; a
   * payload that fails it closes the connection (the framework rule) before any handler runs.
   */
  messages = {
    [AVATAR_INPUT_MESSAGE]: validate(avatarInputSchema, (client, input) =>
      this.onAvatarInput(client, input),
    ),
  };

  onCreate(options: unknown): void {
    const classroomId = parseClassroomId(options);
    if (classroomId === undefined) {
      throw new ServerError(400, 'Bad request');
    }
    this.classroomId = classroomId;
    this.state = new ClassroomState();
    this.state.classroomId = classroomId;
    this.patchRate = 1000 / PATCH_RATE_HZ;
    this.setFixedTimestep(({ dt }) => this.tick(dt), SIMULATION_TICK_RATE_HZ);
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
    this.limiters.set(client.sessionId, new RateLimiter(INPUT_RATE_LIMIT_PER_SECOND));
    if (attached.first) this.addAvatar(auth);
  }

  onLeave(client: Client): void {
    this.limiters.delete(client.sessionId);
    const userId = this.userConnections.userOf(client.sessionId);
    const detached = this.userConnections.detach(client.sessionId);
    if (userId !== undefined && this.intents.get(userId)?.owner === client.sessionId) {
      this.intents.delete(userId);
    }
    if (detached?.userGone) this.state.avatars.delete(detached.userId);
  }

  /** One fixed simulation step: every moving avatar advances, clamped by the classroom layout. */
  tick(dtSeconds: number): void {
    for (const [userId, intent] of this.intents) {
      const avatar = this.state.avatars.get(userId);
      if (!avatar) continue;
      const next = stepAvatar(CLASSROOM_LAYOUT, avatar, intent, dtSeconds);
      // Only touched fields are patched, so a blocked avatar costs no bandwidth.
      if (next.x !== avatar.x) avatar.x = next.x;
      if (next.z !== avatar.z) avatar.z = next.z;
      if (next.rotation !== avatar.rotation) avatar.rotation = next.rotation;
    }
  }

  private onAvatarInput(client: Client, input: AvatarInput): void {
    const limiter = this.limiters.get(client.sessionId);
    const userId = this.userConnections.userOf(client.sessionId);
    if (limiter === undefined || userId === undefined) return;
    // Over the limit: dropped silently, with no effect on the avatar.
    if (!limiter.tryConsume(this.now())) return;
    if (input.x === 0 && input.z === 0) {
      this.intents.delete(userId);
    } else {
      this.intents.set(userId, { x: input.x, z: input.z, owner: client.sessionId });
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
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
export function createClassroomRoom(
  verifier: JoinVerifier,
  options: ClassroomRoomOptions = {},
): ClassroomRoomType {
  return class extends ClassroomRoom {
    protected override options = options;

    static override async onAuth(
      token: string,
      joinOptions: unknown,
      _context: AuthContext,
    ): Promise<ClassroomAuth> {
      return authenticateJoin(verifier, token, joinOptions);
    }
  };
}
