interface Entry {
  /** Start of the current live interval, or undefined while the user has no live connection. */
  liveSince: number | undefined;
  /** Milliseconds from intervals that already ended. */
  accumulatedMs: number;
}

/**
 * Measures how long each user was connected, as the union of their live intervals. It follows the
 * user, not the connection, so a second screen does not add time and the reconnection gap is not
 * counted: the room calls {@link setLive} whenever a user's live-connection count crosses zero.
 *
 * The tracker is memory-only and never writes anything; the room reports a total when a user's
 * presence ends (see `ConnectedTimeReporter`). Times are milliseconds from an injected clock.
 */
export class ConnectedTimeTracker {
  private readonly entries = new Map<string, Entry>();

  /** Idempotent: calling it with the state the user is already in changes nothing. */
  setLive(userId: string, live: boolean, nowMs: number): void {
    const entry = this.entries.get(userId) ?? { liveSince: undefined, accumulatedMs: 0 };
    this.entries.set(userId, entry);
    if (live && entry.liveSince === undefined) {
      entry.liveSince = nowMs;
    } else if (!live && entry.liveSince !== undefined) {
      this.close(entry, nowMs);
    }
  }

  /** Ends a user's presence: returns the total connected milliseconds and forgets the user. */
  complete(userId: string, nowMs: number): number {
    const entry = this.entries.get(userId);
    if (!entry) return 0;
    this.close(entry, nowMs);
    this.entries.delete(userId);
    return entry.accumulatedMs;
  }

  /** Ends everyone's presence at once (the room is closing). */
  drain(nowMs: number): [userId: string, milliseconds: number][] {
    return [...this.entries.keys()].map((userId) => [userId, this.complete(userId, nowMs)]);
  }

  private close(entry: Entry, nowMs: number): void {
    if (entry.liveSince !== undefined) {
      entry.accumulatedMs += Math.max(0, nowMs - entry.liveSince);
      entry.liveSince = undefined;
    }
  }
}
