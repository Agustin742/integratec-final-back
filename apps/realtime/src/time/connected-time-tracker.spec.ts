import { describe, expect, it } from 'vitest';
import { ConnectedTimeTracker } from './connected-time-tracker';

describe('ConnectedTimeTracker', () => {
  it('measures one connected interval', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 1_000);

    expect(tracker.complete('ada', 61_000)).toBe(60_000);
  });

  it('does not count the time the user was not live', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 0);
    tracker.setLive('ada', false, 40_000); // dropped
    tracker.setLive('ada', true, 55_000); // back after a 15 s gap

    expect(tracker.complete('ada', 70_000)).toBe(55_000);
  });

  it('counts overlapping connections once because it follows the user, not the connection', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 0);
    tracker.setLive('ada', true, 30_000); // second screen: already live, nothing changes
    tracker.setLive('ada', true, 40_000);

    expect(tracker.complete('ada', 100_000)).toBe(100_000);
  });

  it('keeps users apart', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 0);
    tracker.setLive('bob', true, 10_000);

    expect(tracker.complete('ada', 50_000)).toBe(50_000);
    expect(tracker.complete('bob', 50_000)).toBe(40_000);
  });

  it('reports nothing for an unknown user and forgets a completed one', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 0);

    expect(tracker.complete('nobody', 10_000)).toBe(0);
    expect(tracker.complete('ada', 10_000)).toBe(10_000);
    expect(tracker.complete('ada', 20_000)).toBe(0);
  });

  it('ignores a clock that goes backwards', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 10_000);

    expect(tracker.complete('ada', 5_000)).toBe(0);
  });

  it('drains everyone, closing open intervals at the given time', () => {
    const tracker = new ConnectedTimeTracker();
    tracker.setLive('ada', true, 0);
    tracker.setLive('bob', true, 0);
    tracker.setLive('bob', false, 20_000);

    const drained = tracker.drain(50_000);

    expect(Object.fromEntries(drained)).toEqual({ ada: 50_000, bob: 20_000 });
    expect(tracker.drain(60_000)).toEqual([]);
  });
});
