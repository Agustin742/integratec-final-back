export type AttachResult = { result: 'attached'; first: boolean } | { result: 'full' };

export interface DetachResult {
  userId: string;
  /** True when that was the user's last connection, so their avatar must go. */
  userGone: boolean;
}

type ConnectionState = 'live' | 'held';

/**
 * Tracks which connections belong to which user. A connection is `live` while its socket is open
 * and `held` while the room waits for it to reconnect; held connections still count toward the
 * per-user cap so a reconnection can never push a user over it.
 */
export class PresenceRegistry {
  private readonly connections = new Map<string, { userId: string; state: ConnectionState }>();
  private readonly byUser = new Map<string, Set<string>>();

  constructor(private readonly maxConnectionsPerUser: number) {}

  attach(userId: string, connectionId: string): AttachResult {
    const owned = this.byUser.get(userId) ?? new Set<string>();
    if (owned.size >= this.maxConnectionsPerUser) return { result: 'full' };
    owned.add(connectionId);
    this.byUser.set(userId, owned);
    this.connections.set(connectionId, { userId, state: 'live' });
    return { result: 'attached', first: owned.size === 1 };
  }

  hold(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) connection.state = 'held';
  }

  resume(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) connection.state = 'live';
  }

  detach(connectionId: string): DetachResult | undefined {
    const connection = this.connections.get(connectionId);
    if (!connection) return undefined;
    this.connections.delete(connectionId);
    const owned = this.byUser.get(connection.userId);
    owned?.delete(connectionId);
    const userGone = owned === undefined || owned.size === 0;
    if (userGone) this.byUser.delete(connection.userId);
    return { userId: connection.userId, userGone };
  }

  has(connectionId: string): boolean {
    return this.connections.has(connectionId);
  }

  isLive(connectionId: string): boolean {
    return this.connections.get(connectionId)?.state === 'live';
  }

  userOf(connectionId: string): string | undefined {
    return this.connections.get(connectionId)?.userId;
  }

  connectionIds(userId: string): string[] {
    return [...(this.byUser.get(userId) ?? [])];
  }

  connectionCount(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0;
  }

  liveCount(userId: string): number {
    return this.connectionIds(userId).filter((id) => this.isLive(id)).length;
  }
}
