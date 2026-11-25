import {
  NPC_EMOTES,
  NpcState,
  type ClassroomLayout,
  type NpcHome,
  type NpcId,
  type PropObstacleId,
} from '@aula/contracts';
import { isWalkable } from '../movement/step-avatar';

/**
 * The pet and tutor bot routine (#147): a pure, server-only state machine with no Colyseus imports
 * and an injected `random`. The room steps it on its fixed timestep and copies the result into the
 * synchronized `Npc` state, so every member sees the same NPC.
 *
 * Wandering is deliberately simple: a destination is a random point whose straight segment from
 * the NPC is clear, so no pathfinding is needed, and anything unexpected (blocked step, no
 * progress, too slow, standing on a spot that stopped being walkable) ends in a short pause and a
 * fresh decision, never a glitch.
 */

interface NpcProfile {
  /** Collision radius of the body, in layout units (metres). */
  radius: number;
  /** Walking speed, metres per second. */
  speed: number;
  /** Chance that a decision is "go home and rest". */
  restChance: number;
  /** Rest duration range, seconds. */
  restSeconds: readonly [number, number];
  /** Props the NPC may stand on. The pet lies on its own bed, which blocks avatars. */
  ignoreProps: readonly PropObstacleId[];
}

const PROFILES: Record<NpcId, NpcProfile> = {
  pet: { radius: 0.3, speed: 0.7, restChance: 0.2, restSeconds: [15, 30], ignoreProps: ['petBed'] },
  tutorBot: { radius: 0.3, speed: 0.55, restChance: 0.15, restSeconds: [10, 20], ignoreProps: [] },
};

/** Seconds each emote plays, from the length of its clip. */
export const NPC_EMOTE_DURATION_S: Readonly<Record<string, number>> = {
  Wave: 2.0,
  Think: 2.5,
  Celebrate: 2.5,
  Encourage: 2.5,
  Talk: 2.0,
  Meow: 1.5,
  AskForPets: 2.5,
};

/** Emotes that are really locomotion or rest clips, played by the walking and sleeping states. */
const NON_EMOTES: ReadonlySet<string> = new Set(['Walk', 'Sleep']);

const PAUSE_SECONDS: readonly [number, number] = [3, 8];
/** Pause after abandoning a walk or being moved: short, so the NPC does not look frozen. */
const RECOVERY_PAUSE_SECONDS: readonly [number, number] = [1, 2];
const EMOTE_CHANCE = 0.4;
/** Farthest from a wall a destination centre may be, on top of the body radius. */
const WALL_MARGIN_M = 0.6;
const MIN_TRAVEL_M = 1.5;
const MAX_POLAR_TRAVEL_M = 4;
const DESTINATION_ATTEMPTS = 40;
/** Finer than a walking tick (0.035 m for the pet), so a segment cannot clip a corner between samples. */
const SEGMENT_SAMPLE_M = 0.02;
/** Maximum turning speed, radians per second: calm, no spinning. */
const TURN_RATE = 3;
/** A turn this close to the target heading counts as done. */
const TURN_DONE_RAD = 0.02;
const PROGRESS_WINDOW_S = 1.5;
const MIN_PROGRESS_M = 0.05;
/** A walk may last this many times the time it should take. */
const WALK_TIME_BUDGET = 2;
/** Arrival: the final step is clamped to the target, so the NPC lands on it exactly. */
const ARRIVAL_EPSILON_M = 1e-9;
/** Longest slice simulated at once, so a long frame cannot jump an NPC over a thin obstacle. */
const MAX_SLICE_S = 0.1;
const SNAP_SEARCH_STEP_M = 0.1;
const SNAP_SEARCH_MAX_M = 4;
const SNAP_SEARCH_ANGLES = 16;

type Phase = 'pause' | 'turn' | 'walk' | 'emote' | 'sleep' | 'reacting';
type Goal = 'wander' | 'rest';

const STATE_OF_PHASE: Record<Phase, NpcState> = {
  pause: NpcState.idle,
  turn: NpcState.idle,
  walk: NpcState.walking,
  emote: NpcState.emote,
  sleep: NpcState.sleeping,
  reacting: NpcState.reacting,
};

interface Point {
  x: number;
  z: number;
}

/** Everything the routine reads from the room. The room refreshes it when the layout grows. */
export interface NpcRoutineContext {
  layout: ClassroomLayout;
  homes: Record<NpcId, NpcHome>;
  /** Uniform in [0, 1); `Math.random` in production, seeded in tests. */
  random: () => number;
}

/** Server-only state of one NPC. The schema only ever receives its published fields. */
export interface NpcRuntime {
  readonly id: NpcId;
  x: number;
  z: number;
  rotation: number;
  /** Published `NpcState`. */
  state: NpcState;
  /** Published emote name, `''` unless the state is `emote`. */
  emote: string;
  /** Walking speed, metres per second. */
  speed: number;
  phase: Phase;
  /** Seconds left in a timed phase (pause, emote, sleep, reacting). */
  timer: number;
  target: Point | null;
  goal: Goal;
  /** Facing the turn phase rotates to, and what follows it. */
  heading: number;
  afterTurn: 'walk' | 'sleep';
  /** A rest was chosen but not reached: the next decision resumes it. */
  restPending: boolean;
  walkElapsed: number;
  walkBudget: number;
  progressAnchor: Point;
  progressElapsed: number;
}

export function createNpcRuntime(id: NpcId, home: NpcHome, random: () => number): NpcRuntime {
  const runtime: NpcRuntime = {
    id,
    x: home.x,
    z: home.z,
    rotation: home.rotation,
    state: NpcState.idle,
    emote: '',
    speed: PROFILES[id].speed,
    phase: 'pause',
    timer: 0,
    target: null,
    goal: 'wander',
    heading: home.rotation,
    afterTurn: 'walk',
    restPending: false,
    walkElapsed: 0,
    walkBudget: 0,
    progressAnchor: { x: home.x, z: home.z },
    progressElapsed: 0,
  };
  enterPause(runtime, random, PAUSE_SECONDS);
  return runtime;
}

/** Advances the routine by `dtSeconds`. Mutates `runtime`; invalid steps are ignored. */
export function stepNpc(runtime: NpcRuntime, dtSeconds: number, ctx: NpcRoutineContext): void {
  if (!(dtSeconds > 0) || !Number.isFinite(dtSeconds)) return;
  let left = dtSeconds;
  while (left > 1e-12) {
    const slice = Math.min(left, MAX_SLICE_S);
    left -= slice;
    advance(runtime, slice, ctx);
  }
}

/**
 * Stops the NPC where it stands as `reacting` for `durationSeconds`, then resumes the routine with
 * a short pause. Dropping the walk target and the emote keeps the interruption clean; a pending
 * rest is kept, so it still goes home later.
 */
export function interruptNpc(runtime: NpcRuntime, durationSeconds: number): void {
  runtime.target = null;
  runtime.timer = Math.max(0, durationSeconds);
  setPhase(runtime, 'reacting');
}

function advance(rt: NpcRuntime, dt: number, ctx: NpcRoutineContext): void {
  if (!canStand(rt, ctx, rt.x, rt.z)) {
    recoverPosition(rt, ctx);
    return;
  }
  switch (rt.phase) {
    case 'pause':
      rt.timer -= dt;
      if (rt.timer <= 0) decide(rt, ctx);
      return;
    case 'reacting':
      rt.timer -= dt;
      if (rt.timer <= 0) enterPause(rt, ctx.random, RECOVERY_PAUSE_SECONDS);
      return;
    case 'emote':
      rt.timer -= dt;
      if (rt.timer <= 0) enterPause(rt, ctx.random, PAUSE_SECONDS);
      return;
    case 'sleep':
      rt.timer -= dt;
      if (rt.timer <= 0) enterPause(rt, ctx.random, PAUSE_SECONDS);
      return;
    case 'turn':
      turn(rt, dt, ctx);
      return;
    case 'walk':
      walk(rt, dt, ctx);
      return;
  }
}

// --- decisions ---------------------------------------------------------------------------------

function decide(rt: NpcRuntime, ctx: NpcRoutineContext): void {
  const profile = PROFILES[rt.id];
  const wantsRest = rt.restPending || ctx.random() < profile.restChance;
  if (wantsRest && tryRest(rt, ctx)) return;
  if (wantsRest) rt.restPending = true;
  const target = pickWanderTarget(rt, ctx);
  if (target) {
    startWalk(rt, target, 'wander');
  } else {
    // Nowhere clear to go: stay put and look again after the next pause.
    enterPause(rt, ctx.random, PAUSE_SECONDS);
  }
}

/** Heads home to sleep: straight there when clear, otherwise via a point that sees the home. */
function tryRest(rt: NpcRuntime, ctx: NpcRoutineContext): boolean {
  const home = ctx.homes[rt.id];
  if (distance(rt, home) <= ARRIVAL_EPSILON_M) {
    startSleep(rt, ctx);
    return true;
  }
  if (clearSegment(rt, ctx, rt, home)) {
    startWalk(rt, home, 'rest');
    return true;
  }
  for (let attempt = 0; attempt < DESTINATION_ATTEMPTS; attempt++) {
    const candidate = sampleCandidate(rt, ctx, attempt);
    if (
      candidate &&
      clearSegment(rt, ctx, rt, candidate) &&
      clearSegment(rt, ctx, candidate, home)
    ) {
      startWalk(rt, candidate, 'rest');
      return true;
    }
  }
  return false;
}

function pickWanderTarget(rt: NpcRuntime, ctx: NpcRoutineContext): Point | undefined {
  for (let attempt = 0; attempt < DESTINATION_ATTEMPTS; attempt++) {
    const candidate = sampleCandidate(rt, ctx, attempt);
    if (candidate && clearSegment(rt, ctx, rt, candidate)) return candidate;
  }
  return undefined;
}

/**
 * A random point inside the walls margin, walkable for this body and far enough away. Even attempts
 * sample the whole room; odd ones a ring around the NPC, which finds short hops out of tight spots.
 */
function sampleCandidate(
  rt: NpcRuntime,
  ctx: NpcRoutineContext,
  attempt: number,
): Point | undefined {
  const { bounds } = ctx.layout;
  const minX = bounds.minX + WALL_MARGIN_M;
  const maxX = bounds.maxX - WALL_MARGIN_M;
  const minZ = bounds.minZ + WALL_MARGIN_M;
  const maxZ = bounds.maxZ - WALL_MARGIN_M;
  let x: number;
  let z: number;
  if (attempt % 2 === 0) {
    x = minX + ctx.random() * (maxX - minX);
    z = minZ + ctx.random() * (maxZ - minZ);
  } else {
    const angle = ctx.random() * 2 * Math.PI;
    const length = MIN_TRAVEL_M + ctx.random() * (MAX_POLAR_TRAVEL_M - MIN_TRAVEL_M);
    x = rt.x + Math.sin(angle) * length;
    z = rt.z + Math.cos(angle) * length;
  }
  if (x < minX || x > maxX || z < minZ || z > maxZ) return undefined;
  if (distance(rt, { x, z }) < MIN_TRAVEL_M) return undefined;
  return canStand(rt, ctx, x, z) ? { x, z } : undefined;
}

/** Whether every sampled point of the straight segment is a spot this body may stand on. */
function clearSegment(rt: NpcRuntime, ctx: NpcRoutineContext, from: Point, to: Point): boolean {
  const length = distance(from, to);
  const samples = Math.max(1, Math.ceil(length / SEGMENT_SAMPLE_M));
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    if (!canStand(rt, ctx, from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t)) {
      return false;
    }
  }
  return true;
}

function canStand(rt: NpcRuntime, ctx: NpcRoutineContext, x: number, z: number): boolean {
  const profile = PROFILES[rt.id];
  return isWalkable(ctx.layout, x, z, {
    radius: profile.radius,
    ignoreProps: profile.ignoreProps,
  });
}

// --- phases ------------------------------------------------------------------------------------

function setPhase(rt: NpcRuntime, phase: Phase): void {
  rt.phase = phase;
  rt.state = STATE_OF_PHASE[phase];
  if (phase !== 'emote') rt.emote = '';
}

function enterPause(rt: NpcRuntime, random: () => number, range: readonly [number, number]): void {
  rt.target = null;
  rt.timer = between(random, range);
  setPhase(rt, 'pause');
}

/** Turn towards the target first, so the NPC never slides sideways, then walk. */
function startWalk(rt: NpcRuntime, target: Point, goal: Goal): void {
  rt.target = target;
  rt.goal = goal;
  rt.heading = Math.atan2(target.x - rt.x, target.z - rt.z);
  rt.afterTurn = 'walk';
  setPhase(rt, 'turn');
}

function startSleep(rt: NpcRuntime, ctx: NpcRoutineContext): void {
  rt.restPending = false;
  rt.target = null;
  rt.heading = ctx.homes[rt.id].rotation;
  rt.afterTurn = 'sleep';
  setPhase(rt, 'turn');
}

function turn(rt: NpcRuntime, dt: number, ctx: NpcRoutineContext): void {
  const diff = angleDiff(rt.heading, rt.rotation);
  if (Math.abs(diff) > TURN_DONE_RAD) {
    rt.rotation = normalizeAngle(
      rt.rotation + Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt),
    );
    return;
  }
  rt.rotation = rt.heading;
  if (rt.afterTurn === 'sleep') {
    rt.timer = between(ctx.random, PROFILES[rt.id].restSeconds);
    setPhase(rt, 'sleep');
    return;
  }
  const target = rt.target;
  if (!target) {
    enterPause(rt, ctx.random, RECOVERY_PAUSE_SECONDS);
    return;
  }
  rt.walkElapsed = 0;
  rt.walkBudget = (WALK_TIME_BUDGET * distance(rt, target)) / rt.speed;
  rt.progressAnchor = { x: rt.x, z: rt.z };
  rt.progressElapsed = 0;
  setPhase(rt, 'walk');
}

function walk(rt: NpcRuntime, dt: number, ctx: NpcRoutineContext): void {
  const target = rt.target;
  if (!target) {
    enterPause(rt, ctx.random, RECOVERY_PAUSE_SECONDS);
    return;
  }
  const remaining = distance(rt, target);
  const stepLength = Math.min(rt.speed * dt, remaining);
  const nextX = remaining > 0 ? rt.x + ((target.x - rt.x) / remaining) * stepLength : rt.x;
  const nextZ = remaining > 0 ? rt.z + ((target.z - rt.z) / remaining) * stepLength : rt.z;
  // Never step onto a spot the body cannot stand on, whatever changed since the segment was checked.
  if (!canStand(rt, ctx, nextX, nextZ)) {
    abandonWalk(rt, ctx);
    return;
  }
  rt.x = nextX;
  rt.z = nextZ;
  rt.walkElapsed += dt;
  rt.progressElapsed += dt;

  if (distance(rt, target) <= ARRIVAL_EPSILON_M) {
    arrive(rt, ctx);
    return;
  }
  if (rt.progressElapsed >= PROGRESS_WINDOW_S) {
    if (distance(rt, rt.progressAnchor) < MIN_PROGRESS_M) {
      abandonWalk(rt, ctx);
      return;
    }
    rt.progressAnchor = { x: rt.x, z: rt.z };
    rt.progressElapsed = 0;
  }
  if (rt.walkElapsed > rt.walkBudget) abandonWalk(rt, ctx);
}

function abandonWalk(rt: NpcRuntime, ctx: NpcRoutineContext): void {
  // A rest in progress stays pending, so the NPC still goes home after the pause.
  if (rt.goal === 'rest') rt.restPending = true;
  enterPause(rt, ctx.random, RECOVERY_PAUSE_SECONDS);
}

function arrive(rt: NpcRuntime, ctx: NpcRoutineContext): void {
  const atHome = distance(rt, ctx.homes[rt.id]) <= ARRIVAL_EPSILON_M;
  if (rt.goal === 'rest') {
    rt.target = null;
    if (atHome) {
      startSleep(rt, ctx);
    } else {
      // Only a waypoint towards home: look again soon, the rest is still pending.
      rt.restPending = true;
      enterPause(rt, ctx.random, RECOVERY_PAUSE_SECONDS);
    }
    return;
  }
  if (ctx.random() < EMOTE_CHANCE) {
    const emotes = NPC_EMOTES[rt.id].filter((name) => !NON_EMOTES.has(name));
    const emote = emotes[Math.min(emotes.length - 1, Math.floor(ctx.random() * emotes.length))];
    rt.target = null;
    rt.timer = NPC_EMOTE_DURATION_S[emote] ?? 2;
    setPhase(rt, 'emote');
    rt.emote = emote;
    return;
  }
  enterPause(rt, ctx.random, PAUSE_SECONDS);
}

/**
 * The NPC stands on a spot that is not walkable (the layout changed under it): it moves to the
 * nearest walkable point, or its home, and pauses.
 */
function recoverPosition(rt: NpcRuntime, ctx: NpcRoutineContext): void {
  const spot = nearestWalkable(rt, ctx) ?? ctx.homes[rt.id];
  rt.x = spot.x;
  rt.z = spot.z;
  enterPause(rt, ctx.random, RECOVERY_PAUSE_SECONDS);
}

function nearestWalkable(rt: NpcRuntime, ctx: NpcRoutineContext): Point | undefined {
  for (let ring = SNAP_SEARCH_STEP_M; ring <= SNAP_SEARCH_MAX_M; ring += SNAP_SEARCH_STEP_M) {
    for (let i = 0; i < SNAP_SEARCH_ANGLES; i++) {
      const angle = (i / SNAP_SEARCH_ANGLES) * 2 * Math.PI;
      const x = rt.x + Math.sin(angle) * ring;
      const z = rt.z + Math.cos(angle) * ring;
      if (canStand(rt, ctx, x, z)) return { x, z };
    }
  }
  return undefined;
}

// --- maths -------------------------------------------------------------------------------------

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.z - b.z);

const between = (random: () => number, [min, max]: readonly [number, number]): number =>
  min + random() * (max - min);

function normalizeAngle(angle: number): number {
  const turns = Math.round(angle / (2 * Math.PI));
  return angle - turns * 2 * Math.PI;
}

/** Signed shortest rotation from `from` to `to`, in (-PI, PI]. */
const angleDiff = (to: number, from: number): number => normalizeAngle(to - from);
