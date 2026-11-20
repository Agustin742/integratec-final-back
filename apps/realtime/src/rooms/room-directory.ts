import {
  CHAT_MESSAGE_EVENT,
  type ChatMessageHiddenPayload,
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
 * The live rooms of this process, by classroom. The MVP runs a single Colyseus instance, so this
 * map is the complete picture; scaling out would need a shared registry (rules/realtime-and-presence.md).
 * Rooms register themselves when created and unregister when disposed.
 */
export class RoomDirectory {
  private readonly rooms = new Map<string, Set<ClassroomRoomHandle>>();

  register(classroomId: string, room: ClassroomRoomHandle): void {
    const set = this.rooms.get(classroomId) ?? new Set<ClassroomRoomHandle>();
    set.add(room);
    this.rooms.set(classroomId, set);
  }

  unregister(classroomId: string, room: ClassroomRoomHandle): void {
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
