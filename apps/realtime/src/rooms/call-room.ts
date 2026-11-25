import {
  CALL_DECLINED_EVENT,
  CALL_EMOTE_MESSAGE,
  CALL_END_MESSAGE,
  CALL_ENDED_EVENT,
  CALL_INCOMING_EVENT,
  CALL_MAX_PARTICIPANTS,
  CALL_MODERATE_MESSAGE,
  CALL_RING_CANCELED_EVENT,
  CALL_SELF_MESSAGE,
  CALL_SIGNAL_MESSAGE,
  CLOSE_CODE_ACCESS_REVOKED,
  CLOSE_CODE_CALL_ENDED,
  CLOSE_CODE_CALL_FULL,
  CLOSE_CODE_CALL_REPLACED,
  CLOSE_CODE_VERIFICATION_UNAVAILABLE,
  CLOSE_REASON_ACCESS_REVOKED,
  CLOSE_REASON_CALL_ENDED,
  CLOSE_REASON_CALL_FULL,
  CLOSE_REASON_CALL_NOT_STARTED,
  CLOSE_REASON_CALL_REPLACED,
  CLOSE_REASON_VERIFICATION_UNAVAILABLE,
  callEmoteSchema,
  callEndSchema,
  callModerateSchema,
  callSelfSchema,
  callSignalSchema,
  type CallDeclinedPayload,
  type CallEmoteMessage,
  type CallEndedPayload,
  type CallEndedReason,
  type CallIncomingPayload,
  type CallKind,
  type CallModerate,
  type CallRingCancelReason,
  type CallRingCanceledPayload,
  type CallSelf,
  type CallSignal,
  type CallSignalRelay,
  type MemberAppearance,
} from '@aula/contracts';
import {
  ClientState,
  CloseCode,
  Room,
  ServerError,
  validate,
  type AuthContext,
  type Client,
} from '@colyseus/core';
import { JoinDeniedError, type JoinVerifier } from '../join/join-verifier';
import { RateLimiter } from '../movement/rate-limiter';
import { applyAppearanceToState } from './appearance-state';
import { authenticateCallJoin, type CallAuth } from './authenticate-call-join';
import { callCapacity, isCallModerator } from './call-key';
import { applyCallModeration, hasCallModerator } from './call-moderation';
import { CallParticipant, CallState } from './call-state';
import type { EvictableRoom, RingableCall, RoomDirectory } from './room-directory';

/**
 * Per-connection limits, as token buckets with a burst of one second's worth. The general realtime
 * limit is 30 messages per second (rules/realtime-and-presence.md), but a call needs two budgets:
 * - signaling: joining a full mesh makes a peer send an offer plus a burst of ICE candidates to
 *   each of up to 11 others, so 150 per second absorbs that while still bounding a flood;
 * - state (`call:self`, `call:emote`): a few per second in practice (speaking toggles), 20 is ample.
 */
export const CALL_SIGNAL_RATE_LIMIT_PER_SECOND = 150;
export const CALL_STATE_RATE_LIMIT_PER_SECOND = 20;

/** How long a direct call rings before the caller is told nobody answered. */
export const DEFAULT_RING_TIMEOUT_MS = 30_000;

/** Collaborators and settings a call room receives from the server bootstrap. */
export interface CallRoomOptions {
  now?: () => number;
  /** Participants a classroom call admits; direct calls always admit 2. */
  maxParticipants?: number;
  /** Where the room announces itself so live evictions can find it, and reaches classroom rooms. */
  directory?: RoomDirectory;
  /** Milliseconds a direct call rings before it times out. */
  ringTimeoutMs?: number;
}

/** A direct call that is ringing its peer; see {@link CallRoom.startRinging}. */
interface Ring {
  callerUserId: string;
  calleeUserId: string;
  timer: { clear(): void };
}

/** A join whose access is being verified: not a participant yet, but already revocable. */
interface PendingAdmission {
  userId: string;
  authSessionId: string;
  revoked: boolean;
}

interface Limiters {
  signal: RateLimiter;
  state: RateLimiter;
}

/**
 * A voice call. Audio never touches the server: it only relays WebRTC signaling between
 * participants of this room and keeps their shared state (mute, speaking, emote, appearance).
 *
 * One call is one room (`callKey`, derived in `onAuth`, see {@link createCallRoom}). Who may start
 * it: a classroom call is created only by a moderator (OWNER, ADMIN, TEACHER); students can join
 * while that room exists and otherwise are refused at matchmaking with 403 `call_not_started`. A direct call is created by
 * whichever of the two members joins first, and only those two can derive its key.
 *
 * A dropped connection is not held: its participant is removed right away, since the peer
 * connections of the mesh would have to be renegotiated anyway; the client rejoins.
 */
export class CallRoom extends Room<{ state: CallState }> implements EvictableRoom, RingableCall {
  protected options: CallRoomOptions = {};
  protected verifier!: JoinVerifier;
  private callKey = '';
  private kind: CallKind = 'classroom';
  private classroomId = '';
  private readonly limiters = new Map<string, Limiters>();
  private readonly authBySession = new Map<string, CallAuth>();
  private readonly pendingAdmissions = new Map<string, PendingAdmission>();
  /** Set once the call is being closed on purpose, so the leaves it causes end nothing else. */
  private ending = false;
  /** Whether this room told the classroom rooms about its class call (and so must retract it). */
  private classStatusPublished = false;
  /** Set while a direct call rings its peer (the caller is in the room, the peer has not joined). */
  private ring: Ring | undefined;

  /** Payloads are validated by Colyseus against the shared contract schemas before any handler. */
  messages = {
    // Unknown message types are ignored: without a catch-all Colyseus closes the connection.
    _: (): void => undefined,
    [CALL_SIGNAL_MESSAGE]: validate(callSignalSchema, (client, signal) =>
      this.onSignal(client, signal),
    ),
    [CALL_SELF_MESSAGE]: validate(callSelfSchema, (client, self) => this.onSelf(client, self)),
    [CALL_EMOTE_MESSAGE]: validate(callEmoteSchema, (client, emote) => this.onEmote(client, emote)),
    [CALL_MODERATE_MESSAGE]: validate(callModerateSchema, (client, action) =>
      this.onModerate(client, action),
    ),
    [CALL_END_MESSAGE]: validate(callEndSchema, (client) => this.onEnd(client)),
  };

  /**
   * `options` carries the server-derived fields `onAuth` wrote (`callKey`, `canStart`,
   * `callerUserId`); the client cannot send them because the join options are strict.
   */
  onCreate(options: Record<string, unknown>): void {
    const { callKey, canStart, callerUserId, kind, classroomId } = options;
    if (
      typeof callKey !== 'string' ||
      typeof callerUserId !== 'string' ||
      typeof classroomId !== 'string' ||
      (kind !== 'classroom' && kind !== 'direct')
    ) {
      throw new ServerError(400, 'Bad request');
    }
    if (canStart !== true) {
      // A matchmaking error, so it is an HTTP status (not a close code): the room is never created.
      throw new ServerError(403, CLOSE_REASON_CALL_NOT_STARTED);
    }
    this.callKey = callKey;
    this.kind = kind;
    this.classroomId = classroomId;
    this.state = new CallState();
    this.state.kind = kind;
    this.state.classroomId = classroomId;
    this.state.hostUserId = callerUserId;
    this.state.allowSelfUnmute = true;
    this.options.directory?.registerCall(classroomId, this);
    if (kind === 'classroom') this.publishClassStatus();
  }

  /**
   * `joinById` ignores `filterBy`, so the identity verified for this exact call must match the
   * room's key. Access is verified again against current persisted state before anything is
   * attached (the identity in `client.auth` may be up to the seat reservation time old). The
   * checks and the insertion after the await are synchronous, so the cap cannot be raced.
   */
  async onJoin(client: Client): Promise<void> {
    const auth = client.auth as CallAuth | undefined;
    if (auth === undefined || auth.callKey !== this.callKey) {
      throw new ServerError(401, 'Unauthorized');
    }
    const admission: PendingAdmission = {
      userId: auth.userId,
      authSessionId: auth.authSessionId,
      revoked: false,
    };
    this.pendingAdmissions.set(client.sessionId, admission);
    let current;
    try {
      current = await this.verifier.reverify(auth);
      if (admission.revoked) {
        throw new ServerError(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
      }
      if (client.state === ClientState.LEAVING) {
        throw new ServerError(CloseCode.CONSENTED, 'left during admission');
      }
    } catch (error) {
      if (error instanceof ServerError) throw error;
      if (admission.revoked || error instanceof JoinDeniedError) {
        throw new ServerError(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
      }
      // No identifiers logged: access is unknown, not revoked.
      console.warn('realtime: call join access verification unavailable');
      throw new ServerError(
        CLOSE_CODE_VERIFICATION_UNAVAILABLE,
        CLOSE_REASON_VERIFICATION_UNAVAILABLE,
      );
    } finally {
      this.pendingAdmissions.delete(client.sessionId);
    }

    const previous = this.sessionOf(auth.userId);
    const occupied = this.state.participants.size - (previous === undefined ? 0 : 1);
    if (
      occupied >= callCapacity(this.kind, this.options.maxParticipants ?? CALL_MAX_PARTICIPANTS)
    ) {
      throw new ServerError(CLOSE_CODE_CALL_FULL, CLOSE_REASON_CALL_FULL);
    }
    // One connection per user: the newer one replaces the older.
    if (previous !== undefined) {
      this.removeParticipant(previous);
      this.clients.getById(previous)?.leave(CLOSE_CODE_CALL_REPLACED, CLOSE_REASON_CALL_REPLACED);
    }
    auth.role = current.role;
    auth.displayName = current.displayName;
    auth.appearance = current.appearance;
    auth.appearanceRevision = current.appearanceRevision;
    this.authBySession.set(client.sessionId, auth);
    this.limiters.set(client.sessionId, {
      signal: new RateLimiter(CALL_SIGNAL_RATE_LIMIT_PER_SECOND),
      state: new RateLimiter(CALL_STATE_RATE_LIMIT_PER_SECOND),
    });
    this.state.participants.set(client.sessionId, this.newParticipant(auth, current.appearance));
    if (this.kind === 'direct') this.updateRinging(auth);
  }

  /**
   * A participant left. Connections replaced or evicted were already removed, so only a leave of
   * someone still in the room counts as a departure (see {@link afterDeparture}).
   */
  onLeave(client: Client): void {
    if (this.ending) return;
    const departed = this.state.participants.get(client.sessionId);
    this.removeParticipant(client.sessionId);
    if (departed !== undefined) this.afterDeparture(departed.role);
  }

  /**
   * Closes the connections of a user that lost access with `4001` and returns how many there
   * were, counting joins still being verified (refused once their check ends). `sessionId` narrows
   * it to the connections made with that account session.
   */
  evict(filter: { userId: string; sessionId?: string }): number {
    let evicted = 0;
    const matches = (userId: string, authSessionId: string | undefined) =>
      userId === filter.userId &&
      (filter.sessionId === undefined || authSessionId === filter.sessionId);
    for (const admission of this.pendingAdmissions.values()) {
      if (admission.revoked || !matches(admission.userId, admission.authSessionId)) continue;
      admission.revoked = true;
      evicted += 1;
    }
    for (const [connectionId, auth] of [...this.authBySession]) {
      if (!matches(auth.userId, auth.authSessionId)) continue;
      const client = this.clients.getById(connectionId);
      const departed = this.state.participants.get(connectionId);
      this.removeParticipant(connectionId);
      client?.leave(CLOSE_CODE_ACCESS_REVOKED, CLOSE_REASON_ACCESS_REVOKED);
      if (departed !== undefined) this.afterDeparture(departed.role);
      evicted += 1;
    }
    return evicted;
  }

  onDispose(): void {
    for (const admission of this.pendingAdmissions.values()) admission.revoked = true;
    this.stopRinging('caller_left');
    this.options.directory?.unregisterCall(this.classroomId, this);
    if (this.classStatusPublished) {
      this.classStatusPublished = false;
      this.options.directory?.clearClassCallStatus(this.classroomId, this);
    }
  }

  /**
   * Ringing (#149), direct calls only. The first participant is the caller: their peer is rung on
   * every live classroom connection (`call:incoming`) and has `ringTimeoutMs` to join. A peer with
   * no classroom connection cannot be rung, so the call ends at once as `unavailable`. The peer
   * joining is the answer; a caller replacing their own connection while it rings changes nothing.
   * Without a directory (rooms built without one) nobody can be rung, so there is no ringing.
   */
  private updateRinging(auth: CallAuth): void {
    if (this.state.participants.size > 1) {
      this.stopRinging('answered');
      return;
    }
    const directory = this.options.directory;
    if (this.ring !== undefined || directory === undefined || auth.peerUserId === undefined) return;
    const ring = {
      callerUserId: auth.userId.toLowerCase(),
      calleeUserId: auth.peerUserId.toLowerCase(),
    };
    const incoming: CallIncomingPayload = {
      classroomId: this.classroomId,
      callerUserId: auth.userId,
      callerDisplayName: auth.displayName,
    };
    if (
      directory.sendToUser(this.classroomId, ring.calleeUserId, CALL_INCOMING_EVENT, incoming) === 0
    ) {
      // Deferred: the caller's join is still completing, and a message sent now could be lost.
      this.clock.setTimeout(() => this.endCall('unavailable'), 0);
      return;
    }
    const timer = this.clock.setTimeout(() => {
      this.stopRinging('timeout');
      this.endCall('timeout');
    }, this.options.ringTimeoutMs ?? DEFAULT_RING_TIMEOUT_MS);
    this.ring = { ...ring, timer };
    directory.registerRing(this.classroomId, ring.callerUserId, ring.calleeUserId, this);
  }

  /** The callee declined (called by the directory, which checked classroom, caller and callee). */
  declineRing(): void {
    const ring = this.ring;
    if (ring === undefined || this.ending) return;
    this.stopRinging('declined');
    const declined: CallDeclinedPayload = { byUserId: ring.calleeUserId };
    this.options.directory?.sendToUser(
      this.classroomId,
      ring.callerUserId,
      CALL_DECLINED_EVENT,
      declined,
    );
    this.endCall('declined');
  }

  /** Stops ringing and tells every classroom connection of the callee to drop the prompt. */
  private stopRinging(reason: CallRingCancelReason): void {
    const ring = this.ring;
    if (ring === undefined) return;
    this.ring = undefined;
    ring.timer.clear();
    const directory = this.options.directory;
    directory?.unregisterRing(this.classroomId, ring.callerUserId, ring.calleeUserId, this);
    const canceled: CallRingCanceledPayload = { callerUserId: ring.callerUserId, reason };
    directory?.sendToUser(this.classroomId, ring.calleeUserId, CALL_RING_CANCELED_EVENT, canceled);
  }

  /**
   * Tells the classroom rooms that this class call exists and whether focus mode is on. Silent
   * when there is no directory (rooms built without one, as in unit tests).
   */
  private publishClassStatus(): void {
    if (this.options.directory === undefined) return;
    this.classStatusPublished = true;
    this.options.directory.setClassCallStatus(this.classroomId, this, {
      active: true,
      focusMode: this.state.focusMode,
    });
  }

  /**
   * What a departure changes. A direct call is a pair, so the other peer is told `peer_left` and the
   * call closes. A classroom call survives anyone leaving, including its host (`hostUserId` only
   * records who started it), but when the last moderator is gone nobody can lift focus mode, so it is
   * cleared rather than leaving students locked out of the world.
   */
  private afterDeparture(role: string): void {
    if (this.kind === 'direct') {
      if (this.state.participants.size > 0) this.endCall('peer_left');
      else this.stopRinging('caller_left');
      return;
    }
    if (this.state.focusMode && isCallModerator(role) && !hasCallModerator(this.state)) {
      this.state.focusMode = false;
      this.publishClassStatus();
    }
  }

  /**
   * Announces the end to everyone and closes the room: `call:ended` first, then every connection
   * is closed with 4102 so a client can tell this from a network drop.
   */
  private endCall(reason: CallEndedReason): void {
    if (this.ending) return;
    this.ending = true;
    const payload: CallEndedPayload = { reason };
    this.broadcast(CALL_ENDED_EVENT, payload);
    for (const client of [...this.clients]) {
      client.leave(CLOSE_CODE_CALL_ENDED, CLOSE_REASON_CALL_ENDED);
    }
    void this.disconnect();
  }

  /** The verified role of a connection that is a participant; undefined otherwise. */
  private moderatorOf(client: Client): boolean {
    return (
      this.state.participants.has(client.sessionId) &&
      isCallModerator(this.authBySession.get(client.sessionId)?.role ?? '')
    );
  }

  /** Classroom calls only, moderators only; anything else is dropped without a reply. */
  private onModerate(client: Client, action: CallModerate): void {
    if (!this.allow(client, 'state') || this.kind !== 'classroom' || !this.moderatorOf(client)) {
      return;
    }
    applyCallModeration(this.state, action);
    if (action.action === 'focus-mode') this.publishClassStatus();
  }

  private onEnd(client: Client): void {
    if (!this.allow(client, 'state') || this.kind !== 'classroom' || !this.moderatorOf(client)) {
      return;
    }
    this.endCall('moderator_ended');
  }

  /**
   * Relays one signaling message to one other participant of this room. The sender is the
   * connection itself (never the payload); a target that is not a participant is dropped silently.
   * Payloads are never logged: they carry network addresses.
   */
  private onSignal(client: Client, signal: CallSignal): void {
    if (!this.allow(client, 'signal')) return;
    if (signal.to === client.sessionId || !this.state.participants.has(signal.to)) return;
    const relay: CallSignalRelay = { from: client.sessionId, payload: signal.payload };
    this.clients.getById(signal.to)?.send(CALL_SIGNAL_MESSAGE, relay);
  }

  private onSelf(client: Client, self: CallSelf): void {
    if (!this.allow(client, 'state')) return;
    const participant = this.state.participants.get(client.sessionId);
    if (participant === undefined) return;
    if (self.muted !== undefined) {
      // A forced mute holds unless the moderator allows self unmuting; when allowed, the student's
      // own unmute lifts it, so the forced flag never outlives the permission to open the mic.
      const blocked = !self.muted && participant.forcedMuted && !this.state.allowSelfUnmute;
      if (!blocked) {
        participant.selfMuted = self.muted;
        if (!self.muted) participant.forcedMuted = false;
      }
    }
    if (self.speaking !== undefined) {
      participant.speaking = self.speaking && !participant.selfMuted && !participant.forcedMuted;
    }
    if (participant.selfMuted || participant.forcedMuted) participant.speaking = false;
  }

  private onEmote(client: Client, message: CallEmoteMessage): void {
    if (!this.allow(client, 'state')) return;
    const participant = this.state.participants.get(client.sessionId);
    if (participant === undefined) return;
    participant.emote = message.emote;
    participant.emoteSeq += 1;
  }

  /** A connection that is not a participant (still admitting, or removed) cannot act. */
  private allow(client: Client, bucket: keyof Limiters): boolean {
    const limiters = this.limiters.get(client.sessionId);
    return limiters?.[bucket].tryConsume((this.options.now ?? Date.now)()) === true;
  }

  private sessionOf(userId: string): string | undefined {
    for (const [sessionId, participant] of this.state.participants) {
      if (participant.userId === userId) return sessionId;
    }
    return undefined;
  }

  private removeParticipant(sessionId: string): void {
    this.limiters.delete(sessionId);
    this.authBySession.delete(sessionId);
    this.state.participants.delete(sessionId);
  }

  private newParticipant(auth: CallAuth, appearance: MemberAppearance): CallParticipant {
    const participant = new CallParticipant();
    participant.userId = auth.userId;
    participant.displayName = auth.displayName;
    participant.role = auth.role;
    applyAppearanceToState(participant.appearance, appearance);
    return participant;
  }
}

/** Explicit shape so the anonymous class returned below stays declaration-emit friendly. */
export interface CallRoomType {
  new (): CallRoom;
  onAuth(token: string, options: unknown, context: AuthContext): Promise<CallAuth>;
}

/**
 * Binds {@link CallRoom} to a verifier (Colyseus calls the static `onAuth` detached, so it is
 * closed over). `onAuth` runs before matchmaking looks for a room and receives the very options
 * object used for `filterBy(['callKey'])` and for `onCreate`, so it writes the server-derived
 * fields there, overwriting nothing the client could have supplied (the strict join options reject
 * any extra key). This is how one call maps to one room without trusting the client.
 */
export function createCallRoom(
  verifier: JoinVerifier,
  options: CallRoomOptions = {},
): CallRoomType {
  return class extends CallRoom {
    protected override options = options;
    protected override verifier = verifier;

    static override async onAuth(
      token: string,
      joinOptions: unknown,
      _context: AuthContext,
    ): Promise<CallAuth> {
      const auth = await authenticateCallJoin(verifier, token, joinOptions);
      Object.assign(joinOptions as Record<string, unknown>, {
        callKey: auth.callKey,
        canStart: auth.canStart,
        callerUserId: auth.userId,
      });
      return auth;
    }
  };
}
