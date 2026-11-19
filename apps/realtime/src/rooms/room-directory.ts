import type { MemberAppearance } from '@aula/contracts';

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

/**
 * What a room offers the directory for appearance updates (#114): apply an API-verified public
 * appearance to the user's avatar, reporting whether that avatar exists.
 */
export interface AppearanceApplicableRoom {
  applyAppearance(userId: string, appearance: MemberAppearance): boolean;
}

/** The full set of room capabilities the internal routes use through the directory. */
export interface DirectoryRoom extends EvictableRoom, AppearanceApplicableRoom {}

/** What the internal routes need from the directory: the `RoomDirectory` method surface. */
export interface RoomDirectoryLike {
  evict(filter: EvictionFilter): number;
  applyAppearance(classroomId: string, userId: string, appearance: MemberAppearance): number;
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
  applyAppearance(classroomId: string, userId: string, appearance: MemberAppearance): number {
    const targets = [...(this.rooms.get(classroomId) ?? [])];
    return targets.reduce(
      (total, room) => total + (room.applyAppearance(userId, appearance) ? 1 : 0),
      0,
    );
  }
}
