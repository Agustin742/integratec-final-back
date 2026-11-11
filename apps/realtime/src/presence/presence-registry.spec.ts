import { describe, expect, it } from 'vitest';
import { PresenceRegistry } from './presence-registry';

describe('PresenceRegistry', () => {
  const make = () => new PresenceRegistry(3);

  it('reports the first connection of a user', () => {
    const registry = make();
    expect(registry.attach('ada', 'c1')).toEqual({ result: 'attached', first: true });
    expect(registry.attach('ada', 'c2')).toEqual({ result: 'attached', first: false });
  });

  it('refuses a connection over the cap and does not track it', () => {
    const registry = make();
    ['c1', 'c2', 'c3'].forEach((id) => registry.attach('ada', id));

    expect(registry.attach('ada', 'c4')).toEqual({ result: 'full' });
    expect(registry.has('c4')).toBe(false);
    expect(registry.connectionCount('ada')).toBe(3);
  });

  it('counts the cap per user', () => {
    const registry = make();
    ['c1', 'c2', 'c3'].forEach((id) => registry.attach('ada', id));

    expect(registry.attach('bob', 'c4')).toEqual({ result: 'attached', first: true });
  });

  it('counts held connections toward the cap but not as live', () => {
    const registry = make();
    ['c1', 'c2', 'c3'].forEach((id) => registry.attach('ada', id));
    registry.hold('c2');

    expect(registry.liveCount('ada')).toBe(2);
    expect(registry.connectionCount('ada')).toBe(3);
    expect(registry.attach('ada', 'c4')).toEqual({ result: 'full' });

    registry.resume('c2');
    expect(registry.liveCount('ada')).toBe(3);
  });

  it('keeps the user until the last connection is detached', () => {
    const registry = make();
    registry.attach('ada', 'c1');
    registry.attach('ada', 'c2');

    expect(registry.detach('c1')).toEqual({ userId: 'ada', userGone: false });
    expect(registry.detach('c2')).toEqual({ userId: 'ada', userGone: true });
    expect(registry.connectionCount('ada')).toBe(0);
  });

  it('frees a seat when a connection is detached', () => {
    const registry = make();
    ['c1', 'c2', 'c3'].forEach((id) => registry.attach('ada', id));
    registry.detach('c1');

    expect(registry.attach('ada', 'c4')).toEqual({ result: 'attached', first: false });
  });

  it('ignores unknown and repeated detaches', () => {
    const registry = make();
    registry.attach('ada', 'c1');

    expect(registry.detach('nope')).toBeUndefined();
    registry.detach('c1');
    expect(registry.detach('c1')).toBeUndefined();
  });

  it('lists the connections of a user', () => {
    const registry = make();
    registry.attach('ada', 'c1');
    registry.attach('bob', 'c2');
    registry.attach('ada', 'c3');

    expect(registry.connectionIds('ada').sort()).toEqual(['c1', 'c3']);
    expect(registry.userOf('c2')).toBe('bob');
  });
});
