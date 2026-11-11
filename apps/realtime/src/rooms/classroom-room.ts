import {
  AVATAR_INPUT_MESSAGE,
  CLASSROOM_LAYOUT,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_TOO_MANY_CONNECTIONS,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_ACCESS_REVOKED,
  CLOSE_REASON_TOO_MANY_CONNECTIONS,
  CLOSE_REASON_VERIFICATION_UNAVAILABLE,
  INPUT_RATE_LIMIT_PER_SECOND,
  MAX_CONNECTIONS_PER_USER,
  PATCH_RATE_HZ,
  SIMULATION_TICK_RATE_HZ,
  avatarInputSchema,
  type AvatarInput,
} from '@aula/contracts';
import {
  Room,
  ServerError,
  validate,
  type AuthContext,
  type Client,
  type Deferred,
} from '@colyseus/core';
import { JoinDeniedError, type ClassroomAuth, type JoinVerifier } from '../join/join-verifier';
import { RateLimiter } from '../movement/rate-limiter';
import { stepAvatar } from '../movement/step-avatar';
import { PresenceRegistry } from '../presence/presence-registry';
import { pickSpawnPoint } from '../presence/spawn';
import {
  noopConnectedTimeReporter,
  type ConnectedTimeReporter,
} from '../time/api-connected-time-reporter';
import { ConnectedTimeTracker } from '../time/connected-time-tracker';
import { authenticateJoin, parseClassroomId } from './authenticate-join';
import { Avatar, ClassroomState } from './classroom-state';
import type { EvictableRoom, RoomDirectory } from './room-directory';

/** Collaborators and settings a room receives from the server bootstrap. */
export interface ClassroomRoomOptions {
  /** Milliseconds clock shared by rate limiting and time tracking; injectable for tests. */
  now?: () => number;
  /** Seconds a dropped connection is held for before its avatar is removed. Default 20. */
  reconnectionWindowSeconds?: number;
  /** Receives one connected-time aggregate per user presence session. Default: discards them. */
  reporter?: ConnectedTimeReporter;
  /** Where the room announces itself so live evictions can find it. */
  directory?: RoomDirectory;
}

const DEFAULT_RECONNECTION_WINDOW_SECONDS = 20;

interface Intent extends AvatarInput {
  /** Connection that sent it: when it leaves, the avatar stops. */
  owner: string;
}

/** Room logic that does not depend on the verifier. */
export class ClassroomRoom extends Room<{ state: ClassroomState }> implements EvictableRoom {
  classroomId = '';
  protected options: ClassroomRoomOptions = {};
  protected verifier!: JoinVerifier;
  /** Not named `presence`: Colyseus already owns `room.presence`. */
  private readonly userConnections = new PresenceRegistry(MAX_CONNECTIONS_PER_USER);
  private readonly limiters = new Map<string, RateLimiter>();
  /** Latest direction per user, shared by all of their connections (the last input wins). */
  private readonly intents = new Map<string, Intent>();
  /** Reconnections the room is waiting for, by connection id. */
  private readonly pendingReconnections = new Map<string, Deferred<Client>>();
  /** Who each connection is, kept for connections that are held and so have no client in the room. */
  private readonly authByConnection = new Map<string, ClassroomAuth>();
  private readonly connectedTime = new ConnectedTimeTracker();
  /** Reports still being delivered, awaited on dispose so none is cut short. */
  private readonly inFlightReports = new Set<Promise<void>>();

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
    this.options.directory?.register(classroomId, this);
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
    this.authByConnection.set(client.sessionId, auth);
    if (attached.first) this.addAvatar(auth);
    this.syncConnectedTime(auth.userId);
  }

  /**
   * A non-consented drop (network loss, closed lid). The connection is held for the reconnection
   * window; while the user has no live connection their avatar shows as `reconnecting`. A consented
   * leave never reaches here, it goes straight to {@link onLeave}.
   */
  onDrop(client: Client): void {
    const userId = this.userConnections.userOf(client.sessionId);
    if (userId === undefined) return; // a refused join: nothing to hold
    this.userConnections.hold(client.sessionId);
    this.releaseIntent(userId, client.sessionId);
    this.refreshStatus(userId);
    this.syncConnectedTime(userId);
    try {
      const pending = this.allowReconnection(client, this.reconnectionWindowSeconds());
      this.pendingReconnections.set(client.sessionId, pending);
      pending.catch(() => undefined); // expiry or rejection ends in onLeave
    } catch {
      // The room is closing: onLeave runs next and cleans up.
    }
  }

  /**
   * The client came back inside the window. Access is checked again against current persisted
   * state before anything resumes: until then the connection stays held, so its input is ignored,
   * the avatar stays `reconnecting` and no connected time accrues. Anything but a clear yes closes
   * the connection: `4001` when access is definitively denied, `4100` when it could not be
   * verified (so the client may retry).
   */
  async onReconnect(client: Client): Promise<void> {
    this.pendingReconnections.delete(client.sessionId);
    const auth = client.auth as ClassroomAuth | undefined;
    const userId = this.userConnections.userOf(client.sessionId);
    if (auth === undefined || userId === undefined) {
      this.closeReconnection(client, 'denied');
      return;
    }
    try {
      const current = await this.verifier.reverify(auth);
      // The connection may have been evicted while the API was answering.
      if (!this.userConnections.has(client.sessionId)) {
        this.closeReconnection(client, 'denied');
        return;
      }
      auth.role = current.role;
      auth.displayName = current.displayName;
      const avatar = this.state.avatars.get(userId);
      if (avatar) {
        avatar.role = current.role;
        avatar.displayName = current.displayName;
      }
      this.userConnections.resume(client.sessionId);
      this.refreshStatus(userId);
      this.syncConnectedTime(userId);
    } catch (error) {
      if (error instanceof JoinDeniedError) {
        this.closeReconnection(client, 'denied');
      } else {
        // The API was unreachable or failing: access is unknown, not revoked. No identifiers logged.
        console.warn('realtime: reconnection access verification unavailable');
        this.closeReconnection(client, 'unavailable');
      }
    }
  }

  onLeave(client: Client): void {
    this.releaseConnection(client.sessionId);
  }

  /**
   * Closes the connections of a user that lost access (membership removed or session ended) with
   * `4001`, including those held for reconnection, and returns how many there were. The state is
   * cleaned up right away and the pending reconnection is rejected, so nothing about the old
   * connection can come back; a fresh join still goes through the API check. `sessionId` narrows it
   * to the connections made with that account session.
   */
  evict(filter: { userId: string; sessionId?: string }): number {
    let evicted = 0;
    for (const connectionId of this.userConnections.connectionIds(filter.userId)) {
      if (
        filter.sessionId !== undefined &&
        this.authByConnection.get(connectionId)?.authSessionId !== filter.sessionId
      ) {
        continue;
      }
      const client = this.clients.getById(connectionId);
      const pending = this.pendingReconnections.get(connectionId);
      this.releaseConnection(connectionId);
      pending?.reject(false);
      client?.leave(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
      evicted += 1;
    }
    return evicted;
  }

  /**
   * Forgets a connection for good. Idempotent, because a connection can be released twice (for
   * example by an eviction and then by the framework's own leave): the second call finds nothing.
   */
  private releaseConnection(connectionId: string): void {
    this.limiters.delete(connectionId);
    this.pendingReconnections.delete(connectionId);
    this.authByConnection.delete(connectionId);
    const userId = this.userConnections.userOf(connectionId);
    const detached = this.userConnections.detach(connectionId);
    if (userId === undefined) return;
    this.releaseIntent(userId, connectionId);
    if (detached?.userGone) {
      this.state.avatars.delete(userId);
      this.reportConnectedTime(userId, this.connectedTime.complete(userId, this.now()));
    } else {
      this.refreshStatus(userId);
      this.syncConnectedTime(userId);
    }
  }

  /** Reports whoever is still tracked, then waits for every report in flight. */
  async onDispose(): Promise<void> {
    for (const [userId, milliseconds] of this.connectedTime.drain(this.now())) {
      this.reportConnectedTime(userId, milliseconds);
    }
    this.pendingReconnections.clear();
    this.options.directory?.unregister(this.classroomId, this);
    await Promise.allSettled([...this.inFlightReports]);
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
    // A held connection (dropped, or reconnected but not yet re-verified) cannot steer the avatar.
    if (!this.userConnections.isLive(client.sessionId)) return;
    // Over the limit: dropped silently, with no effect on the avatar.
    if (!limiter.tryConsume(this.now())) return;
    if (input.x === 0 && input.z === 0) {
      this.intents.delete(userId);
    } else {
      this.intents.set(userId, { x: input.x, z: input.z, owner: client.sessionId });
    }
  }

  /** Tells the time tracker whether the user has any live connection right now. */
  private syncConnectedTime(userId: string): void {
    this.connectedTime.setLive(userId, this.userConnections.liveCount(userId) > 0, this.now());
  }

  /**
   * Sends one aggregate for a finished presence session. A failure is logged without any
   * identifier and not retried: connected time is a coarse metric, never worth blocking the room.
   */
  private reportConnectedTime(userId: string, milliseconds: number): void {
    const connectedSeconds = Math.round(milliseconds / 1000);
    if (connectedSeconds < 1) return;
    const reporter = this.options.reporter ?? noopConnectedTimeReporter;
    const delivery = reporter
      .report({
        userId,
        classroomId: this.classroomId,
        connectedSeconds,
        endedAt: new Date(this.now()).toISOString(),
      })
      .catch(() => console.warn('realtime: connected time report failed'))
      .finally(() => this.inFlightReports.delete(delivery));
    this.inFlightReports.add(delivery);
  }

  /** Refuses a reconnection: a definitive denial reads as revoked access, an outage as retryable. */
  private closeReconnection(client: Client, cause: 'denied' | 'unavailable'): void {
    if (cause === 'denied') {
      client.leave(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
    } else {
      client.leave(CLOSE_CODE_VERIFICATION_UNAVAILABLE, CLOSE_REASON_VERIFICATION_UNAVAILABLE);
    }
  }

  /** Stops the avatar when the connection that was steering it goes away. */
  private releaseIntent(userId: string, connectionId: string): void {
    if (this.intents.get(userId)?.owner === connectionId) this.intents.delete(userId);
  }

  /** `online` while any connection of the user is live, `reconnecting` while all are held. */
  private refreshStatus(userId: string): void {
    const avatar = this.state.avatars.get(userId);
    if (!avatar) return;
    const status = this.userConnections.liveCount(userId) > 0 ? 'online' : 'reconnecting';
    if (avatar.status !== status) avatar.status = status;
  }

  private reconnectionWindowSeconds(): number {
    return this.options.reconnectionWindowSeconds ?? DEFAULT_RECONNECTION_WINDOW_SECONDS;
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
    protected override verifier = verifier;

    static override async onAuth(
      token: string,
      joinOptions: unknown,
      _context: AuthContext,
    ): Promise<ClassroomAuth> {
      return authenticateJoin(verifier, token, joinOptions);
    }
  };
}
