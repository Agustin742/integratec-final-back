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

/** The full set of room capabilities the internal routes use through the directory. */
export interface DirectoryRoom
  extends AppearanceApplicableRoom, DeskCountApplicableRoom, ClassroomRoomHandle {}

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

  register(classroomId: string, room: DirectoryRoom): void {
    const set = this.rooms.get(classroomId) ?? new Set<DirectoryRoom>();
    set.add(room);
    this.rooms.set(classroomId, set);
  }

  unregister(classroomId: string, room: DirectoryRoom): void {
    const set = this.rooms.get(classroomId);
    set?.delete(room);
    if (set?.size === 0) this.rooms.delete(classroomId);
  }

  /** Closes the matching connections and returns how many there were. */
  evict(filter: EvictionFilter): number {
    const { classroomId, ...roomFilter } = filter;
    const targets =
      classroomId === undefined
        ? [...this.rooms.values()].flatMap((set) => [...set])
        : [...(this.rooms.get(classroomId) ?? [])];
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
