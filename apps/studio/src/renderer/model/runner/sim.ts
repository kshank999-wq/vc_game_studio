import { HEIGHTS, PLAYER, cellAt, chunkLength, speedAt, speedRange, type Chunk, type RunnerGame, type RunnerRules } from './runner';

/**
 * The runner running, a frame at a time: the player runs at the track's
 * speed, jumps (only from the ground) and slides; gravity pulls; a solid
 * cell or a fall into a pit ends the run. The same frames drive the play
 * preview, the check that a chunk can be got through (a search over every
 * jump and slide), and the studio's runner, which plans like the search but
 * acts a little early or late, the way people do.
 */

export const DT = 1 / 60;

export interface Track {
  length: number;
  /** For each column: a bit for each height that is solid. */
  solid: number[];
  ground: boolean[];
  /** Coins by column × 4 + height. */
  coins: Set<number>;
  /** Units a second through each column. */
  speed: number[];
  /** Which chunk (index into the game's chunks) each column comes from; -1 for the runway. */
  from: number[];
}

/** Lay chunks end to end after a runway, each at its own speed. */
export const buildTrack = (parts: readonly { chunk: Chunk | null; length?: number; speed: number; index: number }[]): Track => {
  const t: Track = { length: 0, solid: [], ground: [], coins: new Set(), speed: [], from: [] };
  for (const p of parts) {
    const len = p.chunk ? chunkLength(p.chunk) : (p.length ?? 8);
    for (let x = 0; x < len; x++) {
      let bits = 0;
      if (p.chunk) for (let h = 0; h < HEIGHTS; h++) {
        const c = cellAt(p.chunk, x, h);
        if (c === 'solid') bits |= 1 << h;
        if (c === 'coin') t.coins.add((t.length + x) * 4 + h);
      }
      t.solid.push(bits);
      t.ground.push(p.chunk ? cellAt(p.chunk, x, -1) === 'solid' : true);
      t.speed.push(p.speed);
      t.from.push(p.chunk ? p.index : -1);
    }
    t.length += len;
  }
  return t;
};

export interface RunState {
  x: number;
  y: number;
  vy: number;
  /** Frames of slide left. */
  slide: number;
  alive: boolean;
  /** Why the run ended. */
  end?: 'hit' | 'fell' | 'finished';
  coins: number;
  got: number[];
  frame: number;
}

export type Action = 'none' | 'jump' | 'slide';

export const startRun = (): RunState => ({ x: 1, y: 0, vy: 0, slide: 0, alive: true, coins: 0, got: [], frame: 0 });

const groundUnder = (t: Track, x: number) => {
  for (let c = Math.floor(x + 0.05); c <= Math.floor(x + PLAYER.width - 0.05); c++) if (c >= t.length || c < 0 || t.ground[c]) return true;
  return false;
};

/** On the ground, ready to jump or slide. */
export const grounded = (t: Track, s: RunState) => s.y <= 1e-6 && s.vy <= 0 && groundUnder(t, s.x);

/** One frame. Returns a new state. */
export const stepRun = (g: RunnerRules, t: Track, prev: RunState, action: Action, collect = true): RunState => {
  if (!prev.alive) return prev;
  const p = g.physics;
  const s: RunState = { ...prev, frame: prev.frame + 1 };
  const onGround = grounded(t, s);
  if (action === 'jump' && onGround) {
    s.vy = p.jumpSpeed;
    s.slide = 0;
  } else if (action === 'slide' && onGround && s.slide === 0) s.slide = Math.round(p.slideTime / DT);
  const speed = t.speed[Math.min(t.length - 1, Math.max(0, Math.floor(s.x)))] ?? p.startSpeed;
  s.x += speed * DT;
  const wasAbove = s.y >= -0.02;
  s.y += s.vy * DT;
  s.vy -= p.gravity * DT;
  if (s.y <= 0 && wasAbove && groundUnder(t, s.x)) {
    s.y = 0;
    s.vy = 0;
  }
  if (s.slide > 0) s.slide--;
  const h = s.slide > 0 ? PLAYER.slideHeight : PLAYER.height;
  // Hit anything solid: cells above the ground, and the ground's own side when below it.
  for (let c = Math.floor(s.x); c <= Math.floor(s.x + PLAYER.width - 1e-6); c++) {
    if (c < 0 || c >= t.length) continue;
    const bits = t.solid[c]!;
    for (let k = 0; k < HEIGHTS; k++) if (bits & (1 << k) && s.y < k + 1 - 0.02 && s.y + h > k + 0.02) return { ...s, alive: false, end: 'hit' };
    if (t.ground[c] && s.y < -0.05) return { ...s, alive: false, end: 'hit' };
  }
  if (s.y < -1.2) return { ...s, alive: false, end: 'fell' };
  if (collect)
    for (let c = Math.floor(s.x); c <= Math.floor(s.x + PLAYER.width); c++)
      for (let k = 0; k < HEIGHTS; k++) {
        const key = c * 4 + k;
        if (t.coins.has(key) && !s.got.includes(key) && s.y < k + 1 && s.y + h > k) {
          s.got = [...s.got, key];
          s.coins++;
        }
      }
  if (s.x >= t.length - PLAYER.width) return { ...s, end: 'finished' };
  return s;
};

/**
 * Find a way from here to a distance: the jumps and slides, frame by frame.
 * Doing nothing is tried first, so the plan acts only when it must. Null if
 * there is no way through.
 */
export const plan = (g: RunnerRules, t: Track, from: RunState, toX: number, limit = 40_000): Action[] | null => {
  const dead = new Set<string>();
  let budget = limit;
  const key = (s: RunState) => `${Math.round(s.x * 100)}|${Math.round(s.y * 50)}|${Math.round(s.vy * 4)}|${s.slide}`;
  const go = (s: RunState, out: Action[]): boolean => {
    if (s.x >= toX || s.end === 'finished') return true;
    if (!s.alive || --budget < 0) return false;
    const k = key(s);
    if (dead.has(k)) return false;
    const options: Action[] = grounded(t, s) ? (s.slide > 0 ? ['none', 'jump'] : ['none', 'jump', 'slide']) : ['none'];
    for (const a of options) {
      out.push(a);
      if (go(stepRun(g, t, s, a, false), out)) return true;
      out.pop();
    }
    dead.add(k);
    return false;
  };
  const out: Action[] = [];
  return go(from, out) ? out : null;
};

const passMemo = new Map<string, boolean>();

/** Whether a chunk can be got through at a speed: a runway, the chunk, a runway. */
export const passable = (g: RunnerRules, c: Chunk, speed: number): boolean => {
  const k = JSON.stringify([g.physics, c.rows, c.ground, Math.round(speed * 100)]);
  const hit = passMemo.get(k);
  if (hit !== undefined) return hit;
  const t = buildTrack([{ chunk: null, length: 6, speed, index: -1 }, { chunk: c, speed, index: 0 }, { chunk: null, length: 6, speed, index: -1 }]);
  const ok = !!plan(g, t, startRun(), t.length - 3);
  if (passMemo.size > 400) passMemo.clear();
  passMemo.set(k, ok);
  return ok;
};

const rand = (seed: number): [number, number] => {
  let x = (seed + 0x6d2b79f5) | 0;
  const next = x;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return [((x ^ (x >>> 14)) >>> 0) / 4294967296, next];
};

/** What the studio's runner is about to do: a move it has aimed, so many frames from now. */
export interface BotMind {
  wait: number;
  action: Action | null;
  seed: number;
}

export const newMind = (seed: number): BotMind => ({ wait: 0, action: null, seed });

/**
 * The studio's runner, a frame at a time: with no move aimed, it plans a way
 * through what's ahead (each move at the last moment that works), aims its
 * next move that far ahead of the moment as the rules' timing error, and
 * lands anywhere within the error either side. A move with a window
 * narrower than about twice the error is where it, like players, slips.
 */
export const botStep = (g: RunnerRules, t: Track, s: RunState, mind: BotMind): [Action, BotMind] => {
  if (mind.action) {
    if (mind.wait > 0) return ['none', { ...mind, wait: mind.wait - 1 }];
    return [mind.action, { ...mind, action: null }];
  }
  const ahead = plan(g, t, s, Math.min(t.length, s.x + 24), 12_000);
  if (!ahead) return ['none', mind];
  const k = ahead.findIndex((a) => a !== 'none');
  if (k < 0) return ['none', { ...mind, wait: 0 }];
  const spread = Math.round(g.timingMs / 1000 / DT);
  const [u, seed] = rand(mind.seed);
  const at = Math.max(0, k - spread + Math.round((u * 2 - 1) * spread));
  if (at === 0) return [ahead[k]!, { ...mind, seed }];
  return ['none', { wait: at - 1, action: ahead[k]!, seed }];
};

/** The studio's runner on a whole track. Returns how it ended. */
export const botRun = (g: RunnerRules, t: Track, seed: number, maxFrames = 60 * 600): RunState => {
  let s = startRun();
  let mind = newMind(seed);
  let idle = 0;
  while (s.alive && s.end !== 'finished' && s.frame < maxFrames) {
    // With nothing to do in the plan's reach, there is no need to plan again every frame.
    if (!mind.action && idle > 0) {
      idle--;
      s = stepRun(g, t, s, 'none');
      continue;
    }
    const [a, next] = botStep(g, t, s, mind);
    if (!mind.action && !next.action && a === 'none') idle = 12;
    mind = next;
    s = stepRun(g, t, s, a);
  }
  return s;
};

/** The way through a chunk the solver finds at a speed, as points the runner passes, for drawing. Null if there is none. */
export const wayThrough = (g: RunnerRules, c: Chunk, speed: number): [number, number][] | null => {
  const t = buildTrack([{ chunk: null, length: 6, speed, index: -1 }, { chunk: c, speed, index: 0 }, { chunk: null, length: 6, speed, index: -1 }]);
  const steps = plan(g, t, startRun(), t.length - 3);
  if (!steps) return null;
  let s = startRun();
  const out: [number, number][] = [];
  steps.forEach((a, i) => {
    s = stepRun(g, t, s, a, false);
    if (i % 3 === 0 && s.x >= 6 - PLAYER.width && s.x <= 6 + chunkLength(c)) out.push([s.x - 6 + PLAYER.width / 2, s.y + (s.slide > 0 ? PLAYER.slideHeight : PLAYER.height) / 2]);
  });
  return out;
};

export interface ChunkReport {
  /** Can be got through at the slowest and fastest it will be run at. */
  slow: boolean;
  fast: boolean;
  speeds: [number, number];
  /** Share of the studio runner's tries that got through, at each speed. */
  slowRate: number;
  fastRate: number;
}

const chunkMemo = new Map<string, ChunkReport>();

/** How a chunk plays: passable, and how often a player with the rules' timing gets through, slow and fast. */
export const chunkReport = (g: RunnerGame, c: Chunk, tries = 24): ChunkReport => {
  const k = JSON.stringify([g.rules, c.rows, c.ground, c.tier, tries]);
  const hit = chunkMemo.get(k);
  if (hit) return hit;
  const speeds = speedRange(g.rules, c.tier);
  const rate = (speed: number) => {
    const t = buildTrack([{ chunk: null, length: 6, speed, index: -1 }, { chunk: c, speed, index: 0 }, { chunk: null, length: 6, speed, index: -1 }]);
    let ok = 0;
    for (let i = 0; i < tries; i++) if (botRun(g.rules, t, i * 7919 + 1).end === 'finished') ok++;
    return ok / tries;
  };
  const slow = passable(g.rules, c, speeds[0]);
  const fast = passable(g.rules, c, speeds[1]);
  const r: ChunkReport = { slow, fast, speeds, slowRate: slow ? rate(speeds[0]) : 0, fastRate: fast ? rate(speeds[1]) : 0 };
  if (chunkMemo.size > 200) chunkMemo.clear();
  chunkMemo.set(k, r);
  return r;
};

/** An endless run's track, chunk after chunk to a distance, picked at random by tier and weight; never the same chunk twice in a row. */
export const endlessTrack = (g: RunnerGame, seed: number, distance = 1500): Track => {
  const parts: { chunk: Chunk | null; length?: number; speed: number; index: number }[] = [{ chunk: null, length: 10, speed: g.rules.physics.startSpeed, index: -1 }];
  let at = 10;
  let r = seed;
  let last = -1;
  while (at < distance) {
    const tier = 1 + (at >= g.rules.tierAt[0] ? 1 : 0) + (at >= g.rules.tierAt[1] ? 1 : 0);
    const pool = g.chunks.map((c, i) => ({ c, i })).filter(({ c, i }) => c.tier <= tier && c.weight > 0 && (i !== last || g.chunks.filter((x) => x.tier <= tier).length < 2));
    if (!pool.length) break;
    const total = pool.reduce((n, x) => n + x.c.weight, 0);
    const [u, next] = rand(r);
    r = next;
    let pick = u * total;
    const chosen = pool.find((x) => (pick -= x.c.weight) < 0) ?? pool[pool.length - 1]!;
    parts.push({ chunk: chosen.c, speed: speedAt(g.rules.physics, at), index: chosen.i });
    last = chosen.i;
    at += chunkLength(chosen.c);
  }
  return buildTrack(parts);
};

export interface RunReport {
  runs: number;
  /** Distance reached on each run, in order of the seeds. */
  distances: number[];
  median: number;
  /** How many runs ended in each chunk (by index), and at the far end. */
  endedIn: number[];
  finished: number;
  coins: number;
}

const runMemo = new Map<string, RunReport>();

/** The studio's runner plays endless runs to a distance and says how far it gets and where it falls. */
export const runReport = (g: RunnerGame, runs = 12, distance = 1500): RunReport => {
  const k = JSON.stringify([g.rules, g.chunks.map((c) => [c.rows, c.ground, c.tier, c.weight]), runs, distance]);
  const hit = runMemo.get(k);
  if (hit) return hit;
  const endedIn = g.chunks.map(() => 0);
  const distances: number[] = [];
  let finished = 0;
  let coins = 0;
  for (let i = 0; i < runs; i++) {
    const t = endlessTrack(g, i * 104729 + 3, distance);
    const s = botRun(g.rules, t, i * 31 + 5, 60 * 60 * 10);
    distances.push(Math.round(s.x));
    coins += s.coins;
    if (s.end === 'finished') finished++;
    else {
      const from = t.from[Math.min(t.length - 1, Math.floor(s.x + PLAYER.width))] ?? -1;
      if (from >= 0) endedIn[from]!++;
    }
  }
  const sorted = [...distances].sort((a, b) => a - b);
  const r: RunReport = { runs, distances, median: sorted[Math.floor(runs / 2)] ?? 0, endedIn, finished, coins: Math.round(coins / runs) };
  if (runMemo.size > 50) runMemo.clear();
  runMemo.set(k, r);
  return r;
};
