import {
  AVATAR_INPUT_MESSAGE,
  CALL_DECLINE_MESSAGE,
  CHAT_MESSAGE_EVENT,
  CHAT_MESSAGE_HIDDEN_EVENT,
  buildClassroomLayout,
  deriveNpcHomes,
  MIN_CLASSROOM_DESKS,
  NPC_IDS,
  NPC_INTERACT_COOLDOWN_MS,
  NPC_INTERACT_MAX_DISTANCE,
  NPC_INTERACT_MESSAGE,
  TUTOR_BOT_PHRASES,
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
  callDeclineSchema,
  npcInteractSchema,
  type AvatarInput,
  type CallDecline,
  type ClassroomLayout,
  type MemberAppearance,
  type NpcHome,
  type NpcId,
  type NpcInteract,
  type ChatMessageHiddenPayload,
  type ChatMessagePayload,
} from '@aula/contracts';
import {
  ClientState,
  CloseCode,
  Room,
  ServerError,
  validate,
  type AuthContext,
  type Client,
  type Deferred,
} from '@colyseus/core';
import { JoinDeniedError, type ClassroomAuth, type JoinVerifier } from '../join/join-verifier';
import { RateLimiter } from '../movement/rate-limiter';
import {
  createNpcRuntime,
  interruptNpc,
  NPC_EMOTE_DURATION_S,
  stepNpc,
  type NpcRuntime,
} from '../npc/npc-routine';
import { isWalkable, stepAvatar } from '../movement/step-avatar';
import { PresenceRegistry } from '../presence/presence-registry';
import { pickSpawnPoint } from '../presence/spawn';
import {
  noopConnectedTimeReporter,
  type ConnectedTimeReporter,
} from '../time/api-connected-time-reporter';
import { ConnectedTimeTracker } from '../time/connected-time-tracker';
import { authenticateJoin, parseClassroomId } from './authenticate-join';
import { applyAppearanceToState } from './appearance-state';
import { Avatar, ClassroomState, Npc } from './classroom-state';
import type { ClassCallStatus, DirectoryRoom, RoomDirectory } from './room-directory';

/** Role whose movement focus mode freezes. */
const STUDENT_ROLE = 'STUDENT';

function applyAppearanceToAvatar(avatar: Avatar, appearance: MemberAppearance): void {
  applyAppearanceToState(avatar.appearance, appearance);
}

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
  /** Uniform random source in [0, 1) for the NPC routines. Default `Math.random`; seeded in tests. */
  random?: () => number;
}

const DEFAULT_RECONNECTION_WINDOW_SECONDS = 20;

/** Pet reactions and the clip each one plays (the front maps the reaction to the clip). */
const PET_REACTIONS = [
  { reaction: 'greet', clip: 'Meow' },
  { reaction: 'askForPets', clip: 'AskForPets' },
] as const;
/** Extra seconds on top of the clip, so the reaction does not cut the animation short. */
const REACTION_CLIP_MARGIN_S = 0.5;
/** How long the tutor bot holds its speech bubble and Talk clip. */
const TUTOR_BOT_REACTION_S = 5;

/**
 * Largest `connectedSeconds` the API accepts in one report (`MAX_CONNECTED_SECONDS_PER_REPORT` in
 * its connected-time DTO, seven days). A longer presence session is reported at this value instead
 * of being rejected, and not retried, for exceeding it.
 */
const MAX_CONNECTED_SECONDS_PER_REPORT = 7 * 24 * 3600;

interface Intent extends AvatarInput {
  /** Connection that sent it: when it leaves, the avatar stops. */
  owner: string;
}

/** A join whose access is being verified: not attached yet, but already revocable. */
interface PendingAdmission {
  userId: string;
  authSessionId: string;
  revoked: boolean;
  appearance: MemberAppearance;
  appearanceRevision: number;
}

/** Room logic that does not depend on the verifier. */
export class ClassroomRoom extends Room<{ state: ClassroomState }> implements DirectoryRoom {
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
  /** Joins still waiting for the access check, by connection id: an eviction must reach them too. */
  private readonly pendingAdmissions = new Map<string, PendingAdmission>();
  /** Walkable surface of this classroom; only {@link applyDeskCount} replaces it (#79). */
  private layout: ClassroomLayout = buildClassroomLayout(MIN_CLASSROOM_DESKS);
  /** Where the NPCs rest; follows the layout props, so it is refreshed with the layout. */
  private npcHomes: Record<NpcId, NpcHome> = deriveNpcHomes(this.layout);
  /** Routine state of each NPC (timers, targets). Server-only: never part of the schema. */
  private readonly npcRuntimes = new Map<NpcId, NpcRuntime>();
  /** When each member last made each NPC react (`userId:npcId`), for the per-member cooldown. */
  private readonly npcInteractedAt = new Map<string, number>();
  /** Last phrase the tutor bot said, so it never repeats it back to back. */
  private lastPhraseId = -1;
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
    [CALL_DECLINE_MESSAGE]: validate(callDeclineSchema, (client, decline) =>
      this.onCallDecline(client, decline),
    ),
    [NPC_INTERACT_MESSAGE]: validate(npcInteractSchema, (client, input) =>
      this.onNpcInteract(client, input),
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
    this.state.deskCount = MIN_CLASSROOM_DESKS;
    this.seedNpcs();
    this.patchRate = 1000 / PATCH_RATE_HZ;
    this.setFixedTimestep(({ dt }) => this.tick(dt), SIMULATION_TICK_RATE_HZ);
    this.options.directory?.register(classroomId, this);
  }

  /**
   * `joinById` ignores `filterBy`, so a client verified for classroom A could name room B.
   * The identity verified for this exact room must match the room's own classroom.
   *
   * The identity in `client.auth` was checked when the seat was reserved, and Colyseus replays it
   * unchanged when the seat is consumed (up to the reservation time later). Access is therefore
   * verified again here, against current persisted state, before anything is attached: `4001` when
   * it was lost, `4100` when it could not be verified (the client may retry). While that check is
   * in flight the admission is registered in `pendingAdmissions`, so an eviction that arrives
   * meanwhile still reaches it. A socket that closes meanwhile is not revoked through `onLeave`
   * (Colyseus defers it until this join settles, only marking the client `LEAVING`): the check
   * after the await refuses it, so nothing is attached for a client that is already gone.
   *
   * A user has one avatar however many connections they hold: the first connection creates it and
   * the last one to leave removes it. Over the cap the connection is refused with `4002`.
   */
  async onJoin(client: Client): Promise<void> {
    const auth = client.auth as ClassroomAuth | undefined;
    if (auth?.classroomId !== this.classroomId) {
      throw new ServerError(401, 'Unauthorized');
    }
    const admission: PendingAdmission = {
      userId: auth.userId,
      authSessionId: auth.authSessionId,
      revoked: false,
      appearance: auth.appearance,
      appearanceRevision: auth.appearanceRevision,
    };
    this.pendingAdmissions.set(client.sessionId, admission);
    try {
      const current = await this.verifier.reverify(auth);
      // Evicted or disposed while the API was answering: nothing is attached.
      if (admission.revoked) {
        throw new ServerError(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
      }
      // The socket closed meanwhile: Colyseus only marks the client LEAVING and calls `onLeave`
      // after this join settles, so it is checked here. The client is gone and will not read the
      // code; it is the framework's own "consented leave" one.
      if (client.state === ClientState.LEAVING) {
        throw new ServerError(CloseCode.CONSENTED, 'left during admission');
      }
      auth.role = current.role;
      auth.displayName = current.displayName;
      auth.deskCount = current.deskCount;
      if (current.appearanceRevision >= admission.appearanceRevision) {
        admission.appearance = current.appearance;
        admission.appearanceRevision = current.appearanceRevision;
      }
      auth.appearance = admission.appearance;
      auth.appearanceRevision = admission.appearanceRevision;
    } catch (error) {
      if (error instanceof ServerError) throw error;
      if (admission.revoked || error instanceof JoinDeniedError) {
        throw new ServerError(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
      }
      // The API was unreachable or failing: access is unknown, not revoked. No identifiers logged.
      console.warn('realtime: join access verification unavailable');
      throw new ServerError(
        CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      );
    } finally {
      this.pendingAdmissions.delete(client.sessionId);
    }
    const attached = this.userConnections.attach(auth.userId, client.sessionId);
    if (attached.result === 'full') {
      throw new ServerError(CLOSE_CODE_TOO_MANY_CONNECTIONS, CLOSE_REASON_TOO_MANY_CONNECTIONS);
    }
    this.limiters.set(client.sessionId, new RateLimiter(INPUT_RATE_LIMIT_PER_SECOND));
    this.authByConnection.set(client.sessionId, auth);
    // Before the avatar is placed, so a newcomer spawns in the layout the classroom has now.
    this.applyDeskCount(auth.deskCount);
    if (attached.first) {
      this.addAvatar(auth);
    } else {
      // The avatar exists because another connection of the user is live or held: show who they
      // are now and that they are back, rather than leaving a `reconnecting` status until the held
      // connection expires.
      const avatar = this.state.avatars.get(auth.userId);
      if (avatar) {
        avatar.displayName = auth.displayName;
        avatar.role = auth.role;
        if (auth.appearanceRevision >= avatar.appearanceRevision) {
          avatar.appearanceRevision = auth.appearanceRevision;
          applyAppearanceToAvatar(avatar, auth.appearance);
        }
      }
      this.refreshStatus(auth.userId);
    }
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
      // The connection may have been released while the API was answering (evicted, or its socket
      // closed): the release already closed it and reported its time, so nothing resumes.
      if (!this.userConnections.has(client.sessionId)) return;
      auth.role = current.role;
      auth.displayName = current.displayName;
      auth.deskCount = current.deskCount;
      this.applyDeskCount(current.deskCount);
      auth.appearance = current.appearance;
      auth.appearanceRevision = current.appearanceRevision;
      const avatar = this.state.avatars.get(userId);
      if (avatar && current.appearanceRevision >= avatar.appearanceRevision) {
        avatar.appearanceRevision = current.appearanceRevision;
        avatar.role = current.role;
        avatar.displayName = current.displayName;
        applyAppearanceToAvatar(avatar, current.appearance);
      }
      this.userConnections.resume(client.sessionId);
      this.refreshStatus(userId);
      this.syncConnectedTime(userId);
    } catch (error) {
      if (!this.userConnections.has(client.sessionId)) return; // released meanwhile, see above
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
   * Applies an API-verified appearance update to the user's avatar (#114). Reached only through
   * the room directory from the internal route, never from a client message. The monotonic
   * revision makes at-least-once outbox replays and out-of-order deliveries harmless. Pending
   * admissions retain the newest update so a join verification cannot overwrite it with an older
   * snapshot.
   */
  applyAppearance(
    userId: string,
    appearanceRevision: number,
    appearance: MemberAppearance,
  ): boolean {
    const avatar = this.state.avatars.get(userId);
    let found = avatar !== undefined;
    if (avatar && appearanceRevision > avatar.appearanceRevision) {
      avatar.appearanceRevision = appearanceRevision;
      applyAppearanceToAvatar(avatar, appearance);
    }
    for (const admission of this.pendingAdmissions.values()) {
      if (admission.userId !== userId) continue;
      found = true;
      if (appearanceRevision > admission.appearanceRevision) {
        admission.appearanceRevision = appearanceRevision;
        admission.appearance = appearance;
      }
    }
    return found;
  }

  /**
   * Closes the connections of a user that lost access (membership removed or session ended) with
   * `4001`, including those held for reconnection, and returns how many there were. The state is
   * cleaned up right away and the pending reconnection is rejected, so nothing about the old
   * connection can come back; a fresh join still goes through the API check. `sessionId` narrows it
   * to the connections made with that account session.
   *
   * Joins still being verified (a seat reserved earlier, consumed just now) are revoked too and
   * counted: the eviction acted on them, and they are refused with `4001` once their check ends.
   */
  evict(filter: { userId: string; sessionId?: string }): number {
    let evicted = 0;
    for (const admission of this.pendingAdmissions.values()) {
      if (
        admission.revoked ||
        admission.userId !== filter.userId ||
        (filter.sessionId !== undefined && admission.authSessionId !== filter.sessionId)
      ) {
        continue;
      }
      admission.revoked = true;
      evicted += 1;
    }
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
   * Grows the classroom layout to the one built for `deskCount` desks (#79). It is the only place
   * the layout changes: called with each verified identity (admission, reconnection) and from the
   * API push after a desk expansion through the room directory. It is monotonic: desks are never
   * deleted, so a count whose effective layout is not larger than the current one (counts below the
   * minimum or not finite build the minimum layout) can only be stale, such as a re-verification
   * answered before an expansion that arrives after its push, and is ignored. Avatars left on a
   * point that is no longer walkable, such as the spot a new desk now occupies, move to a free
   * spawn point; the others stay where they are.
   */
  applyDeskCount(deskCount: number): void {
    const layout = buildClassroomLayout(deskCount);
    const effectiveCount = layout.obstacles.length - 1; // every obstacle but the teacher desk
    if (effectiveCount <= this.state.deskCount) return;
    const previousHomes = this.npcHomes;
    this.layout = layout;
    this.npcHomes = deriveNpcHomes(layout);
    this.state.deskCount = effectiveCount;
    this.rehomeIdleNpcs(previousHomes);
    const avatars = [...this.state.avatars.values()];
    const placed = avatars.filter((avatar) => isWalkable(layout, avatar.x, avatar.z));
    for (const avatar of avatars) {
      if (placed.includes(avatar)) continue;
      const spawn = pickSpawnPoint(layout, placed);
      avatar.x = spawn.x;
      avatar.z = spawn.z;
      placed.push(avatar);
    }
  }

  /**
   * Mirrors the class voice call into the synchronized state (#149). While focus mode is on, avatar
   * input from students is ignored (see {@link onAvatarInput}); students already walking when it
   * starts are stopped so they do not keep drifting. Moderators are never affected.
   */
  applyCallStatus(status: ClassCallStatus): void {
    this.state.classCallActive = status.active;
    this.state.focusMode = status.focusMode;
    if (!status.focusMode) return;
    for (const userId of [...this.intents.keys()]) {
      if (this.state.avatars.get(userId)?.role === STUDENT_ROLE) this.intents.delete(userId);
    }
  }

  /** Sends to every live (not held) connection of the user; returns how many received it. */
  sendToUser(userId: string, type: string, payload: unknown): number {
    let sent = 0;
    for (const connectionId of this.userConnections.connectionIds(userId)) {
      if (!this.userConnections.isLive(connectionId)) continue;
      const client = this.clients.getById(connectionId);
      if (client === undefined) continue;
      client.send(type, payload);
      sent += 1;
    }
    return sent;
  }

  /** Puts the pet and the tutor bot idle at the homes of the current layout (#147). */
  private seedNpcs(): void {
    const homes = this.npcHomes;
    const random = this.options.random ?? Math.random;
    for (const id of NPC_IDS) {
      this.npcRuntimes.set(id, createNpcRuntime(id, homes[id], random));
      const npc = new Npc();
      npc.id = id;
      npc.x = homes[id].x;
      npc.z = homes[id].z;
      npc.rotation = homes[id].rotation;
      this.state.npcs.set(id, npc);
    }
  }

  /**
   * The homes follow the layout props, which move when desks are added. An NPC resting idle at its
   * previous home moves to the new one; any other keeps its position (the routine owns it).
   */
  private rehomeIdleNpcs(previousHomes: ReturnType<typeof deriveNpcHomes>): void {
    const homes = this.npcHomes;
    for (const id of NPC_IDS) {
      const npc = this.state.npcs.get(id);
      const runtime = this.npcRuntimes.get(id);
      if (!npc || !runtime || npc.state !== 'idle') continue;
      const previous = previousHomes[id];
      if (npc.x !== previous.x || npc.z !== previous.z) continue;
      npc.x = runtime.x = homes[id].x;
      npc.z = runtime.z = homes[id].z;
      npc.rotation = runtime.rotation = homes[id].rotation;
    }
  }

  broadcastChatMessage(payload: ChatMessagePayload): void {
    this.broadcast(CHAT_MESSAGE_EVENT, payload);
  }

  broadcastChatMessageHidden(payload: ChatMessageHiddenPayload): void {
    this.broadcast(CHAT_MESSAGE_HIDDEN_EVENT, payload);
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
      this.forgetNpcCooldowns(userId);
      this.reportConnectedTime(userId, this.connectedTime.complete(userId, this.now()));
    } else {
      this.refreshStatus(userId);
      this.syncConnectedTime(userId);
    }
  }

  /**
   * Drops the per-NPC interaction cooldowns of a member who left for good. A rejoining member
   * starts with a clean cooldown, and no entry outlives the member it belongs to.
   */
  private forgetNpcCooldowns(userId: string): void {
    for (const key of this.npcInteractedAt.keys()) {
      if (key.startsWith(`${userId}:`)) this.npcInteractedAt.delete(key);
    }
  }

  /** Reports whoever is still tracked, then waits for every report in flight. */
  async onDispose(): Promise<void> {
    for (const [userId, milliseconds] of this.connectedTime.drain(this.now())) {
      this.reportConnectedTime(userId, milliseconds);
    }
    this.pendingReconnections.clear();
    for (const admission of this.pendingAdmissions.values()) admission.revoked = true;
    this.options.directory?.unregister(this.classroomId, this);
    await Promise.allSettled([...this.inFlightReports]);
  }

  /**
   * One fixed simulation step: every moving avatar advances, clamped by the classroom layout, and
   * the NPCs follow their routine, but only while someone is in the room (an empty room does no work).
   */
  tick(dtSeconds: number): void {
    for (const [userId, intent] of this.intents) {
      const avatar = this.state.avatars.get(userId);
      if (!avatar) continue;
      const next = stepAvatar(this.layout, avatar, intent, dtSeconds);
      // Only touched fields are patched, so a blocked avatar costs no bandwidth.
      if (next.x !== avatar.x) avatar.x = next.x;
      if (next.z !== avatar.z) avatar.z = next.z;
      if (next.rotation !== avatar.rotation) avatar.rotation = next.rotation;
    }
    if (this.state.avatars.size > 0) this.stepNpcs(dtSeconds);
  }

  /** Advances each NPC routine and publishes only the fields that changed, like the avatars. */
  private stepNpcs(dtSeconds: number): void {
    const ctx = {
      layout: this.layout,
      homes: this.npcHomes,
      random: this.options.random ?? Math.random,
    };
    for (const id of NPC_IDS) {
      const runtime = this.npcRuntimes.get(id);
      const npc = this.state.npcs.get(id);
      if (!runtime || !npc) continue;
      stepNpc(runtime, dtSeconds, ctx);
      this.publishNpc(npc, runtime);
      // The routine left `reacting` by itself: the reaction is over.
      if (runtime.state !== 'reacting' && npc.reaction !== '') {
        npc.reaction = '';
        if (npc.phraseId !== -1) npc.phraseId = -1;
        if (npc.reactingSessionId !== '') npc.reactingSessionId = '';
      }
    }
  }

  /** Copies the routine fields into the synchronized state, touching only what changed. */
  private publishNpc(npc: Npc, runtime: NpcRuntime): void {
    if (npc.x !== runtime.x) npc.x = runtime.x;
    if (npc.z !== runtime.z) npc.z = runtime.z;
    if (npc.rotation !== runtime.rotation) npc.rotation = runtime.rotation;
    if (npc.state !== runtime.state) npc.state = runtime.state;
    if (npc.emote !== runtime.emote) npc.emote = runtime.emote;
  }

  /**
   * A member pressed E on an NPC. Ignored unless the connection is live and within the
   * connection's message budget, the avatar is close enough, the member is out of cooldown
   * and the NPC is not already reacting. A sleeping pet wakes up and reacts. The reaction is
   * plain synchronized state, so the whole room sees it.
   */
  private onNpcInteract(client: Pick<Client, 'sessionId'>, input: NpcInteract): void {
    const limiter = this.limiters.get(client.sessionId);
    const userId = this.userConnections.userOf(client.sessionId);
    if (limiter === undefined || userId === undefined) return;
    // A held connection (dropped, or reconnected but not yet re-verified) cannot interact.
    if (!this.userConnections.isLive(client.sessionId)) return;
    // Over the limit: dropped silently, with no effect on the NPC. The budget is shared
    // with avatar:input, so one connection cannot exceed 30 messages per second in total.
    if (!limiter.tryConsume(this.now())) return;
    const npcId = input.npcId;
    const avatar = this.state.avatars.get(userId);
    const runtime = this.npcRuntimes.get(npcId);
    const npc = this.state.npcs.get(npcId);
    if (!avatar || !runtime || !npc) return;
    if (runtime.state === 'reacting') return;
    if (Math.hypot(avatar.x - runtime.x, avatar.z - runtime.z) > NPC_INTERACT_MAX_DISTANCE) return;
    const now = this.now();
    const cooldownKey = `${userId}:${npcId}`;
    const last = this.npcInteractedAt.get(cooldownKey);
    if (last !== undefined && now - last < NPC_INTERACT_COOLDOWN_MS) return;
    this.npcInteractedAt.set(cooldownKey, now);

    const random = this.options.random ?? Math.random;
    let durationSeconds = TUTOR_BOT_REACTION_S;
    if (npcId === 'pet') {
      const pick = PET_REACTIONS[random() < 0.5 ? 0 : 1];
      npc.reaction = pick.reaction;
      durationSeconds = (NPC_EMOTE_DURATION_S[pick.clip] ?? 2) + REACTION_CLIP_MARGIN_S;
    } else {
      npc.reaction = 'phrase';
      npc.phraseId = this.pickPhrase(random);
    }
    npc.reactionSeq += 1;
    npc.reactingSessionId = client.sessionId;
    runtime.rotation = Math.atan2(avatar.x - runtime.x, avatar.z - runtime.z);
    interruptNpc(runtime, durationSeconds);
    this.publishNpc(npc, runtime);
  }

  /** A random phrase index that differs from the previous one. */
  private pickPhrase(random: () => number): number {
    const count = TUTOR_BOT_PHRASES.length;
    let index: number;
    if (this.lastPhraseId < 0) {
      index = Math.min(count - 1, Math.floor(random() * count));
    } else {
      // Roll among the other phrases, then step over the previous one.
      index = Math.min(count - 2, Math.floor(random() * (count - 1)));
      if (index >= this.lastPhraseId) index += 1;
    }
    this.lastPhraseId = index;
    return index;
  }

  private onAvatarInput(client: Client, input: AvatarInput): void {
    const limiter = this.limiters.get(client.sessionId);
    const userId = this.userConnections.userOf(client.sessionId);
    if (limiter === undefined || userId === undefined) return;
    // A held connection (dropped, or reconnected but not yet re-verified) cannot steer the avatar.
    if (!this.userConnections.isLive(client.sessionId)) return;
    // Over the limit: dropped silently, with no effect on the avatar.
    if (!limiter.tryConsume(this.now())) return;
    // Focus mode (teacher class call): students stay put; the role is the verified one.
    if (
      this.state.focusMode &&
      this.authByConnection.get(client.sessionId)?.role === STUDENT_ROLE
    ) {
      return;
    }
    if (input.x === 0 && input.z === 0) {
      this.intents.delete(userId);
    } else {
      this.intents.set(userId, { x: input.x, z: input.z, owner: client.sessionId });
    }
  }

  /**
   * The callee declines a ringing direct call (#149). Same gates as avatar input: a live connection
   * within the rate limit. The sender is the connection's verified user, never the payload, so only
   * the callee of an existing ringing call (this classroom, `callerUserId`, this user) has any effect.
   */
  private onCallDecline(client: Client, decline: CallDecline): void {
    const limiter = this.limiters.get(client.sessionId);
    const userId = this.userConnections.userOf(client.sessionId);
    if (limiter === undefined || userId === undefined) return;
    if (!this.userConnections.isLive(client.sessionId)) return;
    if (!limiter.tryConsume(this.now())) return;
    this.options.directory?.declineRing(
      this.classroomId,
      decline.callerUserId.toLowerCase(),
      userId.toLowerCase(),
    );
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
    const connectedSeconds = Math.min(
      Math.round(milliseconds / 1000),
      MAX_CONNECTED_SECONDS_PER_REPORT,
    );
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

  /**
   * Refuses a reconnection: a definitive denial reads as revoked access, an outage as retryable.
   * The connection is released here rather than left to the socket's close event, so the room's
   * state does not depend on the transport; the release is idempotent when that event follows.
   */
  private closeReconnection(client: Client, cause: 'denied' | 'unavailable'): void {
    this.releaseConnection(client.sessionId);
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
    const spawn = pickSpawnPoint(this.layout, [...this.state.avatars.values()]);
    const avatar = new Avatar();
    avatar.userId = identity.userId;
    avatar.displayName = identity.displayName;
    avatar.role = identity.role;
    avatar.appearanceRevision = identity.appearanceRevision;
    applyAppearanceToAvatar(avatar, identity.appearance);
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
