import { describe, expect, it, vi } from 'vitest';
import { RoomDirectory } from './room-directory';

const room = (result = 1) => ({ evict: vi.fn().mockReturnValue(result) });

describe('RoomDirectory', () => {
  it('evicts from the room of the given classroom only', () => {
    const directory = new RoomDirectory();
    const a = room();
    const b = room();
    directory.register('A', a);
    directory.register('B', b);

    expect(directory.evict({ userId: 'u', classroomId: 'A' })).toBe(1);

    expect(a.evict).toHaveBeenCalledExactlyOnceWith({ userId: 'u' });
    expect(b.evict).not.toHaveBeenCalled();
  });

  it('evicts from every room when no classroom is given and sums the connections', () => {
    const directory = new RoomDirectory();
    directory.register('A', room(2));
    directory.register('B', room(1));

    expect(directory.evict({ userId: 'u', sessionId: 's' })).toBe(3);
  });

  it('forwards the session filter to the rooms', () => {
    const directory = new RoomDirectory();
    const a = room();
    directory.register('A', a);

    directory.evict({ userId: 'u', sessionId: 's' });

    expect(a.evict).toHaveBeenCalledExactlyOnceWith({ userId: 'u', sessionId: 's' });
  });

  it('forgets a room once it is unregistered', () => {
    const directory = new RoomDirectory();
    const a = room();
    directory.register('A', a);
    directory.unregister('A', a);

    expect(directory.evict({ userId: 'u' })).toBe(0);
    expect(a.evict).not.toHaveBeenCalled();
  });

  it('keeps every room when two are registered for one classroom', () => {
    const directory = new RoomDirectory();
    const first = room();
    const second = room();
    directory.register('A', first);
    directory.register('A', second);
    directory.unregister('A', first);

    directory.evict({ userId: 'u', classroomId: 'A' });

    expect(first.evict).not.toHaveBeenCalled();
    expect(second.evict).toHaveBeenCalledTimes(1);
  });

  it('matches nothing for an unknown classroom', () => {
    expect(new RoomDirectory().evict({ userId: 'u', classroomId: 'nope' })).toBe(0);
  });
});
