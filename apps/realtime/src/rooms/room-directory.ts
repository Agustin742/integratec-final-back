import {
  CHAT_MESSAGE_EVENT,
  type ChatMessageHiddenPayload,
  type MemberAppearance,
  type ChatMessagePayload,
  type ChatRealtimeBroadcast,
} from '@aula/contracts';

export interface EvictionFilter {
  userId: string;
  /** Limit the eviction to this classroom; omitted means every classroom. */
  classroomId?: string;
  /** Limit the eviction to the connections made with this account session. */
  sessionId?: string;
}

/** What a room offers to the directory: close the matching connections, report how many. */
export interface EvictableRoom {
  evict(filter: { userId: string; sessionId?: string }): number;
}

export interface ClassroomRoomHandle extends EvictableRoom {
  broadcastChatMessage(payload: ChatMessagePayload): void;
  broadcastChatMessageHidden(payload: ChatMessageHiddenPayload): void;
}

/**
 * What a room offers the directory for appearance updates (#114): apply an API-verified public
 * appearance to the user's avatar, reporting whether that avatar exists.
 */
export interface AppearanceApplicableRoom {
  applyAppearance(
    userId: string,
    appearanceRevision: number,
    appearance: MemberAppearance,
  ): boolean;
}

/** What a room offers the directory when its classroom gains desks (#79). */
export interface DeskCountApplicableRoom {
  applyDeskCount(deskCount: number): void;
}

/** Whether the classroom has a class voice call, and whether its teacher locked the world (#149). */
export interface ClassCallStatus {
  active: boolean;
  focusMode: boolean;
}

/** What a classroom room offers the directory when its class call starts, changes or ends. */
export interface CallStatusApplicableRoom {
  applyCallStatus(status: ClassCallStatus): void;
}

/** The full set of room capabilities the internal routes use through the directory. */
export interface DirectoryRoom
  extends
    AppearanceApplicableRoom,
    DeskCountApplicableRoom,
    CallStatusApplicableRoom,
    ClassroomRoomHandle {}

/** What the internal routes need from the directory: the `RoomDirectory` method surface. */
export interface RoomDirectoryLike {
  evict(filter: EvictionFilter): number;
  applyAppearance(
    classroomId: string,
    userId: string,
    appearanceRevision: number,
    appearance: MemberAppearance,
  ): number;
  applyDeskCount(classroomId: string, deskCount: number): void;
  broadcastChatEvent(event: ChatRealtimeBroadcast): void;
}

/**
 * The live rooms of this process, by classroom. The MVP runs a single Colyseus instance, so this
 * map is the complete picture; scaling out would need a shared registry (rules/realtime-and-presence.md).
 * Rooms register themselves when created and unregister when disposed.
 */
export class RoomDirectory {
  private readonly rooms = new Map<string, Set<DirectoryRoom>>();
  /** Voice call rooms by classroom; they only need to be evictable. */
  private readonly callRooms = new Map<string, Set<EvictableRoom>>();
  /** The running class call of each classroom, so a late classroom room can be told about it. */
  private readonly classCalls = new Map<string, { owner: object; status: ClassCallStatus }>();

  registerCall(classroomId: string, room: EvictableRoom): void {
    const set = this.callRooms.get(classroomId) ?? new Set<EvictableRoom>();
    set.add(room);
    this.callRooms.set(classroomId, set);
  }

  unregisterCall(classroomId: string, room: EvictableRoom): void {
    const set = this.callRooms.get(classroomId);
    set?.delete(room);
    if (set?.size === 0) this.callRooms.delete(classroomId);
  }

  register(classroomId: string, room: DirectoryRoom): void {
    const set = this.rooms.get(classroomId) ?? new Set<DirectoryRoom>();
    set.add(room);
    this.rooms.set(classroomId, set);
    // A room created while a class call is running (a second room, a restart of the room) joins it.
    const current = this.classCalls.get(classroomId);
    if (current !== undefined) room.applyCallStatus({ ...current.status });
  }

  /**
   * Publishes the class call of one classroom to its live classroom rooms and remembers it for
   * rooms registered later. Called by the call room (single process; see the class comment).
   */
  setClassCallStatus(classroomId: string, owner: object, status: ClassCallStatus): void {
    this.classCalls.set(classroomId, { owner, status: { ...status } });
    for (const room of this.rooms.get(classroomId) ?? []) room.applyCallStatus({ ...status });
  }

  /**
   * The class call ended: the classroom is no longer in a call and focus mode is off. A no-op unless
   * `owner` is the call room that published the current status, so a call room disposed late cannot
   * wipe the status of the call that replaced it.
   */
  clearClassCallStatus(classroomId: string, owner: object): void {
    if (this.classCalls.get(classroomId)?.owner !== owner) return;
    this.classCalls.delete(classroomId);
    for (const room of this.rooms.get(classroomId) ?? []) {
      room.applyCallStatus({ active: false, focusMode: false });
    }
  }

  unregister(classroomId: string, room: DirectoryRoom): void {
    const set = this.rooms.get(classroomId);
    set?.delete(room);
    if (set?.size === 0) this.rooms.delete(classroomId);
  }

  /** Closes the matching connections and returns how many there were. */
  evict(filter: EvictionFilter): number {
    const { classroomId, ...roomFilter } = filter;
    const targets: EvictableRoom[] =
      classroomId === undefined
        ? [...this.rooms.values(), ...this.callRooms.values()].flatMap((set) => [...set])
        : [...(this.rooms.get(classroomId) ?? []), ...(this.callRooms.get(classroomId) ?? [])];
    return targets.reduce((total, room) => total + room.evict(roomFilter), 0);
  }

  /**
   * Applies an appearance update to the rooms of one classroom and returns how many avatars it
   * reached (#114). An unknown classroom or a user with no avatar reaches nothing, which the
   * internal route reports as a bare success so an at-least-once replay stays harmless.
   */
  applyAppearance(
    classroomId: string,
    userId: string,
    appearanceRevision: number,
    appearance: MemberAppearance,
  ): number {
    const targets = [...(this.rooms.get(classroomId) ?? [])];
    return targets.reduce(
      (total, room) =>
        total + (room.applyAppearance(userId, appearanceRevision, appearance) ? 1 : 0),
      0,
    );
  }

  /**
   * Tells the live rooms of one classroom how many desks it now has (#79). An unknown classroom
   * reaches nothing, which the internal route reports as a bare success so an at-least-once replay
   * stays harmless.
   */
  applyDeskCount(classroomId: string, deskCount: number): void {
    for (const room of this.rooms.get(classroomId) ?? []) room.applyDeskCount(deskCount);
  }

  /** Delivers the event only to live rooms bound to the committed message's classroom. */
  broadcastChatEvent(event: ChatRealtimeBroadcast): void {
    for (const room of this.rooms.get(event.classroomId) ?? []) {
      if (event.event === CHAT_MESSAGE_EVENT) {
        room.broadcastChatMessage(event.payload);
      } else {
        room.broadcastChatMessageHidden(event.payload);
      }
    }
  }
}
