import { describe, it, expect } from 'vitest';
import {
  NPC_EMOTES,
  NPC_IDS,
  buildClassroomLayout,
  deriveNpcHomes,
  type ClassroomLayout,
  type NpcId,
} from '@aula/contracts';
import { isWalkable } from '../movement/step-avatar';
import {
  NPC_EMOTE_DURATION_S,
  createNpcRuntime,
  interruptNpc,
  stepNpc,
  type NpcRoutineContext,
  type NpcRuntime,
} from './npc-routine';

const DT = 0.05;
const layout = buildClassroomLayout(12);
const homes = deriveNpcHomes(layout);

/** Deterministic PRNG so every simulated run is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const makeCtx = (seed: number, l: ClassroomLayout = layout): NpcRoutineContext => ({
  layout: l,
  homes: deriveNpcHomes(l),
  random: mulberry32(seed),
});

/** The walkability the server applies to an NPC body: the pet may lie on its own bed. */
const walkableFor = (id: NpcId, l: ClassroomLayout, x: number, z: number): boolean =>
  isWalkable(l, x, z, { radius: 0.3, ignoreProps: id === 'pet' ? ['petBed'] : [] });

const ALLOWED_EMOTES: Record<NpcId, string[]> = {
  pet: ['Meow', 'AskForPets'],
  tutorBot: ['Wave', 'Think', 'Celebrate', 'Encourage', 'Talk'],
};

interface Run {
  state: string;
  startedAt: number;
  length: number;
  from: { x: number; z: number };
  to: { x: number; z: number };
  emote: string;
}

/** Simulates `seconds` at a fixed step and returns the runs of consecutive equal states. */
function simulate(
  id: NpcId,
  seconds: number,
  seed: number,
  onStep?: (rt: NpcRuntime, ctx: NpcRoutineContext, time: number) => void,
): { runs: Run[]; rt: NpcRuntime; ctx: NpcRoutineContext } {
  const ctx = makeCtx(seed);
  const rt = createNpcRuntime(id, ctx.homes[id], ctx.random);
  const runs: Run[] = [];
  let current: Run | undefined;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    stepNpc(rt, DT, ctx);
    onStep?.(rt, ctx, i * DT);
    if (!current || current.state !== rt.state || current.emote !== rt.emote) {
      current = {
        state: rt.state,
        startedAt: i * DT,
        length: 0,
        from: { x: rt.x, z: rt.z },
        to: { x: rt.x, z: rt.z },
        emote: rt.emote,
      };
      runs.push(current);
    }
    current.length += DT;
    current.to = { x: rt.x, z: rt.z };
  }
  return { runs, rt, ctx };
}

describe('stepNpc', () => {
  describe.each(NPC_IDS)('%s', (id) => {
    it('starts idle at its home and pauses at least 3 s before doing anything', () => {
      const ctx = makeCtx(1);
      const rt = createNpcRuntime(id, ctx.homes[id], ctx.random);

      for (let t = 0; t < 2.9; t += DT) stepNpc(rt, DT, ctx);

      expect(rt).toMatchObject({
        state: 'idle',
        emote: '',
        x: ctx.homes[id].x,
        z: ctx.homes[id].z,
      });
    });

    it.each([1, 2, 3])(
      'never stands on a non-walkable spot over ten simulated minutes (seed %i)',
      (seed) => {
        let violations = 0;
        const { runs } = simulate(id, 600, seed, (rt, ctx) => {
          if (!walkableFor(id, ctx.layout, rt.x, rt.z) || !Number.isFinite(rt.rotation)) {
            violations += 1;
          }
        });

        expect(violations).toBe(0);
        expect(runs.some((run) => run.state === 'walking')).toBe(true);
      },
    );

    it('only picks destinations 1.5 m or farther, with a 0.6 m wall margin, except going home', () => {
      const { runs, ctx } = simulate(id, 600, 4);
      const { bounds } = ctx.layout;
      const home = ctx.homes[id];

      for (const run of runs.filter((r) => r.state === 'walking')) {
        const atHome = Math.hypot(run.to.x - home.x, run.to.z - home.z) < 0.1;
        if (atHome) continue;
        expect(Math.hypot(run.to.x - run.from.x, run.to.z - run.from.z)).toBeGreaterThanOrEqual(
          1.4,
        );
        expect(run.to.x).toBeGreaterThanOrEqual(bounds.minX + 0.6 - 1e-6);
        expect(run.to.x).toBeLessThanOrEqual(bounds.maxX - 0.6 + 1e-6);
        expect(run.to.z).toBeGreaterThanOrEqual(bounds.minZ + 0.6 - 1e-6);
        expect(run.to.z).toBeLessThanOrEqual(bounds.maxZ - 0.6 + 1e-6);
      }
    });

    it('walks at a calm speed', () => {
      const speed = id === 'pet' ? 0.7 : 0.55;
      let last: { x: number; z: number } | undefined;
      let fastest = 0;
      simulate(id, 300, 5, (rt) => {
        if (last && rt.state === 'walking') {
          fastest = Math.max(fastest, Math.hypot(rt.x - last.x, rt.z - last.z) / DT);
        }
        last = { x: rt.x, z: rt.z };
      });

      expect(fastest).toBeGreaterThan(speed * 0.9);
      expect(fastest).toBeLessThanOrEqual(speed + 1e-6);
    });

    it('plays only its own emotes for the configured time, and clears the field otherwise', () => {
      const seen = new Set<string>();
      const { runs } = simulate(id, 900, 6, (rt) => {
        if (rt.state !== 'emote') expect(rt.emote).toBe('');
      });

      for (const run of runs.filter((r) => r.state === 'emote')) {
        seen.add(run.emote);
        expect(ALLOWED_EMOTES[id]).toContain(run.emote);
        expect(NPC_EMOTES[id] as readonly string[]).toContain(run.emote);
        expect(run.length).toBeCloseTo(NPC_EMOTE_DURATION_S[run.emote], 1);
      }
      expect(seen.size).toBeGreaterThan(0);
      const afterEmote = runs.filter((_, i) => i > 0 && runs[i - 1].state === 'emote');
      expect(afterEmote.every((run) => run.state === 'idle')).toBe(true);
    });

    it('rests at its home for its own sleep time, then goes back to idle', () => {
      const [min, max] = id === 'pet' ? [15, 30] : [10, 20];
      const { runs, ctx } = simulate(id, 1800, 7);
      const sleeps = runs.filter((r) => r.state === 'sleeping');

      expect(sleeps.length).toBeGreaterThan(0);
      for (const sleep of sleeps) {
        expect(sleep.from).toEqual({ x: ctx.homes[id].x, z: ctx.homes[id].z });
        expect(sleep.emote).toBe('');
        expect(sleep.length).toBeGreaterThanOrEqual(min - 0.1);
        expect(sleep.length).toBeLessThanOrEqual(max + 0.1);
      }
      const next = runs[runs.indexOf(sleeps[0]) + 1];
      expect(next?.state).toBe('idle');
    });
  });

  it('lets the pet lie on its bed, which blocks avatars', () => {
    const home = homes.pet;

    expect(isWalkable(layout, home.x, home.z)).toBe(false);
    expect(walkableFor('pet', layout, home.x, home.z)).toBe(true);
    expect(walkableFor('tutorBot', layout, home.x, home.z)).toBe(false);
  });

  it('abandons a walk when the next step would not be walkable, then picks a new destination', () => {
    const ctx = makeCtx(8);
    const rt = createNpcRuntime('pet', ctx.homes.pet, ctx.random);
    while (rt.state !== 'walking') stepNpc(rt, DT, ctx);
    const target = rt.target!;
    const start = { x: rt.x, z: rt.z };
    const length = Math.hypot(target.x - start.x, target.z - start.z);
    const ahead = { x: start.x + ((target.x - start.x) / length) * 0.6, z: 0 };
    ahead.z = start.z + ((target.z - start.z) / length) * 0.6;
    const blocked: ClassroomLayout = {
      ...ctx.layout,
      obstacles: [
        ...ctx.layout.obstacles,
        { minX: ahead.x - 0.05, maxX: ahead.x + 0.05, minZ: ahead.z - 0.05, maxZ: ahead.z + 0.05 },
      ],
    };
    ctx.layout = blocked;

    let guard = 0;
    while (rt.state === 'walking' && guard++ < 200) {
      stepNpc(rt, DT, ctx);
      expect(walkableFor('pet', blocked, rt.x, rt.z)).toBe(true);
    }

    expect(rt.state).toBe('idle');
    expect(Math.hypot(rt.x - start.x, rt.z - start.z)).toBeLessThan(0.5);
    let walkedAgain = false;
    for (let t = 0; t < 120 && !walkedAgain; t += DT) {
      stepNpc(rt, DT, ctx);
      expect(walkableFor('pet', blocked, rt.x, rt.z)).toBe(true);
      walkedAgain = rt.state === 'walking';
    }
    expect(walkedAgain).toBe(true);
  });

  it('abandons a walk that makes under 5 cm of progress in 1.5 s', () => {
    const ctx = makeCtx(9);
    const rt = createNpcRuntime('tutorBot', ctx.homes.tutorBot, ctx.random);
    while (rt.state !== 'walking') stepNpc(rt, DT, ctx);

    rt.speed = 0.01;
    let elapsed = 0;
    while (rt.state === 'walking' && elapsed < 10) {
      stepNpc(rt, DT, ctx);
      elapsed += DT;
    }

    expect(rt.state).toBe('idle');
    expect(elapsed).toBeGreaterThanOrEqual(1.4);
    expect(elapsed).toBeLessThanOrEqual(1.7);
  });

  it('abandons a walk that takes more than twice the expected time', () => {
    const ctx = makeCtx(10);
    const rt = createNpcRuntime('pet', ctx.homes.pet, ctx.random);
    while (rt.state !== 'walking') stepNpc(rt, DT, ctx);
    const target = rt.target!;
    const expected = Math.hypot(target.x - rt.x, target.z - rt.z) / rt.speed;

    rt.speed *= 0.3; // slow but still moving: only the time budget catches it
    let elapsed = 0;
    while (rt.state === 'walking' && elapsed < expected * 4) {
      stepNpc(rt, DT, ctx);
      elapsed += DT;
    }

    expect(rt.state).toBe('idle');
    expect(elapsed).toBeGreaterThanOrEqual(expected * 2 - 0.2);
    expect(elapsed).toBeLessThanOrEqual(expected * 2 + 0.2);
  });

  it.each(NPC_IDS)('moves %s out of a spot that stopped being walkable', (id) => {
    const ctx = makeCtx(11);
    const rt = createNpcRuntime(id, ctx.homes[id], ctx.random);
    rt.x = 1.5;
    rt.z = -1.8; // inside the first row desk
    expect(walkableFor(id, ctx.layout, rt.x, rt.z)).toBe(false);

    stepNpc(rt, DT, ctx);

    expect(walkableFor(id, ctx.layout, rt.x, rt.z)).toBe(true);
    expect(rt.state).toBe('idle');
    expect(rt.emote).toBe('');
  });

  it('stays idle and retries on the next pause when no destination is reachable', () => {
    const ctx = makeCtx(12);
    const boxed: ClassroomLayout = {
      ...ctx.layout,
      obstacles: [
        ...ctx.layout.obstacles,
        // Everything but a pocket (about 0.7 by 1.1 m) around the bot's home is wall.
        { minX: -5, maxX: 8, minZ: -6, maxZ: 6 },
        { minX: -8, maxX: -5, minZ: -6, maxZ: 0.2 },
        { minX: -8, maxX: -5, minZ: 1.9, maxZ: 6 },
      ],
    };
    ctx.layout = boxed;
    const rt = createNpcRuntime('tutorBot', ctx.homes.tutorBot, ctx.random);
    const home = ctx.homes.tutorBot;

    for (let t = 0; t < 120; t += DT) {
      stepNpc(rt, DT, ctx);
      expect(walkableFor('tutorBot', boxed, rt.x, rt.z)).toBe(true);
      expect(['idle', 'sleeping', 'emote']).toContain(rt.state);
      expect(Math.hypot(rt.x - home.x, rt.z - home.z)).toBeLessThan(1.5);
    }
  });
});

describe('interruptNpc', () => {
  it('stops a walking NPC in place as reacting and resumes the routine afterwards', () => {
    const ctx = makeCtx(13);
    const rt = createNpcRuntime('pet', ctx.homes.pet, ctx.random);
    while (rt.state !== 'walking') stepNpc(rt, DT, ctx);
    for (let i = 0; i < 20; i++) stepNpc(rt, DT, ctx);

    interruptNpc(rt, 2);
    const frozen = { x: rt.x, z: rt.z };

    expect(rt.state).toBe('reacting');
    expect(rt.emote).toBe('');
    for (let t = 0; t < 1.9; t += DT) {
      stepNpc(rt, DT, ctx);
      expect(rt.state).toBe('reacting');
      expect({ x: rt.x, z: rt.z }).toEqual(frozen);
    }
    for (let t = 0; t < 0.3; t += DT) stepNpc(rt, DT, ctx);
    expect(rt.state).toBe('idle');

    let walkedAgain = false;
    for (let t = 0; t < 60 && !walkedAgain; t += DT) {
      stepNpc(rt, DT, ctx);
      walkedAgain = rt.state === 'walking';
    }
    expect(walkedAgain).toBe(true);
  });

  it('clears an emote and wakes a sleeper', () => {
    const ctx = makeCtx(14);
    const rt = createNpcRuntime('tutorBot', ctx.homes.tutorBot, ctx.random);
    while (rt.state !== 'emote' && rt.state !== 'sleeping') stepNpc(rt, DT, ctx);

    interruptNpc(rt, 1);

    expect(rt.state).toBe('reacting');
    expect(rt.emote).toBe('');
  });
});
