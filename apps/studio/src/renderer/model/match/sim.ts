import { parseShape, type MatchGame, type MatchLevel, type Shape } from './match';

/**
 * The match-3 board running: swaps, matches, special gems, gravity, refills
 * and chains, a level's moves and goal. One set of moves drives the play
 * preview and the studio's player, and refills come from a seed kept in the
 * state, so the same game runs the same.
 */

/** none, a line gem that clears its row, one that clears its column, a bomb that clears the 3×3 round it. */
export type Special = 0 | 1 | 2 | 3;

export interface Gem {
  c: number;
  s: Special;
}

export interface MatchState {
  shape: Shape;
  colors: number;
  /** null: no gem (or no cell). */
  gems: (Gem | null)[];
  jelly: boolean[];
  score: number;
  moves: number;
  /** Gems cleared of each colour. */
  collected: number[];
  phase: 'playing' | 'won' | 'lost';
  /** The longest chain the last move set off. */
  chain: number;
  /** Cells cleared by the last move, for the preview to flash. */
  cleared: number[];
  seed: number;
  shuffles: number;
}

const rand = (seed: number): [number, number] => {
  let t = (seed + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
};
const roll = (s: { seed: number }, n: number) => {
  const [r, seed] = rand(s.seed);
  s.seed = seed;
  return Math.floor(r * n);
};

const colorAt = (s: MatchState, i: number) => s.gems[i]?.c ?? -1;

/** Whether a colour at a cell would line up three with what is already left of it or above it. */
const makesRun = (s: MatchState, i: number, c: number) => {
  const { cols } = s.shape;
  const x = i % cols;
  if (x >= 2 && colorAt(s, i - 1) === c && colorAt(s, i - 2) === c) return true;
  if (i >= 2 * cols && colorAt(s, i - cols) === c && colorAt(s, i - 2 * cols) === c) return true;
  return false;
};

/** A fresh board for a level: every cell filled, no lines of three to start with, at least one move to make. */
export const createMatch = (g: MatchGame, l: MatchLevel, seed = 1): MatchState => {
  const shape = parseShape(l.rows);
  const s: MatchState = { shape, colors: Math.max(3, Math.min(l.colors, g.rules.gems.length)), gems: shape.cell.map(() => null), jelly: [...shape.jelly], score: 0, moves: l.moves, collected: Array.from({ length: g.rules.gems.length }, () => 0), phase: 'playing', chain: 0, cleared: [], seed, shuffles: 0 };
  fillFresh(s);
  return s;
};

const fillFresh = (s: MatchState) => {
  for (let tries = 0; tries < 50; tries++) {
    s.shape.cell.forEach((on, i) => {
      if (!on) return;
      let c = roll(s, s.colors);
      for (let k = 0; k < s.colors && makesRun(s, i, c); k++) c = (c + 1) % s.colors;
      s.gems[i] = { c, s: 0 };
    });
    if (anyMove(s)) return;
  }
};

const inRun = (s: MatchState, i: number): { h: number[]; v: number[] } => {
  const { cols } = s.shape;
  const c = colorAt(s, i);
  const h = [i];
  const v = [i];
  if (c < 0) return { h: [], v: [] };
  for (let j = i - 1; j >= 0 && Math.floor(j / cols) === Math.floor(i / cols) && colorAt(s, j) === c; j--) h.push(j);
  for (let j = i + 1; Math.floor(j / cols) === Math.floor(i / cols) && j < s.gems.length && colorAt(s, j) === c; j++) h.push(j);
  for (let j = i - cols; j >= 0 && colorAt(s, j) === c; j -= cols) v.push(j);
  for (let j = i + cols; j < s.gems.length && colorAt(s, j) === c; j += cols) v.push(j);
  return { h: h.length >= 3 ? h : [], v: v.length >= 3 ? v : [] };
};

/** Whether two cells are side by side. */
export const adjacent = (s: MatchState, a: number, b: number) => {
  const { cols } = s.shape;
  return (Math.abs(a - b) === 1 && Math.floor(a / cols) === Math.floor(b / cols)) || Math.abs(a - b) === cols;
};

const swapIn = (s: MatchState, a: number, b: number) => {
  const t = s.gems[a]!;
  s.gems[a] = s.gems[b]!;
  s.gems[b] = t;
};

/** Whether swapping two cells would line up three or more. */
export const canSwap = (s: MatchState, a: number, b: number): boolean => {
  if (s.phase !== 'playing' || !adjacent(s, a, b) || !s.gems[a] || !s.gems[b]) return false;
  swapIn(s, a, b);
  const ra = inRun(s, a);
  const rb = inRun(s, b);
  swapIn(s, a, b);
  return ra.h.length + ra.v.length + rb.h.length + rb.v.length > 0;
};

/** Every swap that would make a match. */
export const moves = (s: MatchState): [number, number][] => {
  const out: [number, number][] = [];
  const { cols } = s.shape;
  for (let i = 0; i < s.gems.length; i++) {
    if ((i % cols) + 1 < cols && canSwap(s, i, i + 1)) out.push([i, i + 1]);
    if (i + cols < s.gems.length && canSwap(s, i, i + cols)) out.push([i, i + cols]);
  }
  return out;
};
const anyMove = (s: MatchState) => moves(s).length > 0;

/** All lines of three or more on the board, as runs of cells. */
const allRuns = (s: MatchState): { cells: number[]; dir: 'h' | 'v' }[] => {
  const { cols, rows } = s.shape;
  const out: { cells: number[]; dir: 'h' | 'v' }[] = [];
  for (let y = 0; y < rows; y++) {
    let run: number[] = [];
    for (let x = 0; x <= cols; x++) {
      const i = y * cols + x;
      const c = x < cols ? colorAt(s, i) : -2;
      if (run.length && (c < 0 || c !== colorAt(s, run[0]!))) {
        if (run.length >= 3) out.push({ cells: run, dir: 'h' });
        run = [];
      }
      if (c >= 0) run.push(i);
    }
  }
  for (let x = 0; x < cols; x++) {
    let run: number[] = [];
    for (let y = 0; y <= rows; y++) {
      const i = y * cols + x;
      const c = y < rows ? colorAt(s, i) : -2;
      if (run.length && (c < 0 || c !== colorAt(s, run[0]!))) {
        if (run.length >= 3) out.push({ cells: run, dir: 'v' });
        run = [];
      }
      if (c >= 0) run.push(i);
    }
  }
  return out;
};

/** Clear what lines up, again and again as gems fall and new ones drop, each chain step scoring more. */
const resolve = (g: MatchGame, s: MatchState, moved: number[]) => {
  const { cols, rows } = s.shape;
  for (let step = 1; step < 60; step++) {
    const runs = allRuns(s);
    if (!runs.length) break;
    s.chain = step;
    const clear = new Set<number>();
    const make = new Map<number, Gem>();
    const count = new Map<number, number>();
    for (const r of runs) for (const i of r.cells) count.set(i, (count.get(i) ?? 0) + 1);
    for (const r of runs) {
      for (const i of r.cells) clear.add(i);
      if (!g.rules.specials || r.cells.length < 4) continue;
      const at = r.cells.find((i) => moved.includes(i)) ?? r.cells[Math.floor(r.cells.length / 2)]!;
      if (!make.has(at)) make.set(at, { c: colorAt(s, at), s: r.cells.length >= 5 ? 3 : r.dir === 'h' ? 1 : 2 });
    }
    if (g.rules.specials) for (const [i, n] of count) if (n > 1) make.set(i, { c: colorAt(s, i), s: 3 });
    // Specials caught in the clear go off, and may set off others.
    const queue = [...clear];
    const fired = new Set<number>();
    while (queue.length) {
      const i = queue.pop()!;
      const gem = s.gems[i];
      if (!gem || gem.s === 0 || fired.has(i) || make.has(i)) continue;
      fired.add(i);
      const x = i % cols;
      const y = Math.floor(i / cols);
      const hit: number[] = [];
      if (gem.s === 1) for (let k = 0; k < cols; k++) hit.push(y * cols + k);
      if (gem.s === 2) for (let k = 0; k < rows; k++) hit.push(k * cols + x);
      if (gem.s === 3) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < cols && y + dy >= 0 && y + dy < rows) hit.push((y + dy) * cols + x + dx);
      for (const j of hit) if (s.gems[j] && !clear.has(j)) (clear.add(j), queue.push(j));
    }
    const per = g.rules.points * (1 + g.rules.chainBonus * (step - 1));
    for (const i of clear) {
      const gem = s.gems[i];
      if (!gem) continue;
      s.score += Math.round(per);
      s.collected[gem.c] = (s.collected[gem.c] ?? 0) + 1;
      if (s.jelly[i]) s.jelly[i] = false;
      s.cleared.push(i);
      s.gems[i] = make.get(i) ?? null;
    }
    // Gravity: gems fall through the cells below them, new ones drop in at the top.
    for (let x = 0; x < cols; x++) {
      const cells = Array.from({ length: rows }, (_, y) => y * cols + x).filter((i) => s.shape.cell[i]);
      const stack = cells.map((i) => s.gems[i]).filter((gm): gm is Gem => !!gm);
      for (let k = cells.length - 1, j = stack.length - 1; k >= 0; k--, j--) s.gems[cells[k]!] = j >= 0 ? stack[j]! : { c: roll(s, s.colors), s: 0 };
    }
    moved = [];
  }
};

/** The goal met? */
export const goalMet = (l: MatchLevel, s: MatchState): boolean =>
  l.goal.kind === 'score' ? s.score >= l.goal.amount : l.goal.kind === 'collect' ? (s.collected[l.goal.color] ?? 0) >= l.goal.amount : !s.jelly.some(Boolean);

/** How far along the goal is, 0 to 1. */
export const goalProgress = (l: MatchLevel, s: MatchState): number => {
  if (l.goal.kind === 'score') return Math.min(1, s.score / Math.max(1, l.goal.amount));
  if (l.goal.kind === 'collect') return Math.min(1, (s.collected[l.goal.color] ?? 0) / Math.max(1, l.goal.amount));
  const start = s.shape.jelly.filter(Boolean).length;
  return start ? 1 - s.jelly.filter(Boolean).length / start : 1;
};

/** Swap two gems and play out what follows. Unchanged if the swap makes no match. */
export const swap = (g: MatchGame, l: MatchLevel, prev: MatchState, a: number, b: number, unlimited = false): MatchState => {
  if (!canSwap(prev, a, b)) return prev;
  const s: MatchState = { ...prev, gems: prev.gems.map((x) => (x ? { ...x } : null)), jelly: [...prev.jelly], collected: [...prev.collected], cleared: [] };
  swapIn(s, a, b);
  resolve(g, s, [a, b]);
  s.moves--;
  if (!anyMove(s)) {
    // No move left: shuffle the colours already on the board.
    for (let tries = 0; tries < 20 && !anyMove(s); tries++) {
      const cells = s.gems.map((gm, i) => (gm ? i : -1)).filter((i) => i >= 0);
      for (let k = cells.length - 1; k > 0; k--) {
        const j = roll(s, k + 1);
        const t = s.gems[cells[k]!];
        s.gems[cells[k]!] = s.gems[cells[j]!]!;
        s.gems[cells[j]!] = t!;
      }
      resolve(g, s, []);
      s.shuffles++;
    }
    if (!anyMove(s)) fillFresh(s);
  }
  if (goalMet(l, s)) s.phase = 'won';
  else if (s.moves <= 0 && !unlimited) s.phase = 'lost';
  return s;
};

/**
 * The studio's player: a steady one, not a clever one. It takes the swap
 * that clears the most gems on the spot, counting a special it would make,
 * the goal's gems and jelly double, and lower on the board a little better
 * (more falls after). It doesn't look past the first clear.
 */
export const bestSwap = (g: MatchGame, l: MatchLevel, s: MatchState): [number, number] | null => {
  let best: [number, number] | null = null;
  let top = -Infinity;
  const { cols } = s.shape;
  for (const [a, b] of moves(s)) {
    swapIn(s, a, b);
    let value = 0;
    for (const i of [a, b]) {
      const r = inRun(s, i);
      for (const run of [r.h, r.v]) {
        if (!run.length) continue;
        value += run.length + (g.rules.specials ? (run.length >= 5 ? 6 : run.length === 4 ? 3 : 0) : 0);
        for (const j of run) {
          if (l.goal.kind === 'collect' && colorAt(s, j) === l.goal.color) value += 2;
          if (l.goal.kind === 'jelly' && s.jelly[j]) value += 2;
          if (s.gems[j]?.s) value += 4;
        }
      }
    }
    swapIn(s, a, b);
    value += (Math.floor(Math.max(a, b) / cols) / s.shape.rows) * 0.5;
    if (value > top) {
      top = value;
      best = [a, b];
    }
  }
  return best;
};

export interface LevelRun {
  /** Moves the studio's player needed to meet the goal; null if not within the cap. */
  needed: number | null;
  /** Score when the level's move limit ran out, or the goal was met. */
  score: number;
  won: boolean;
}

/** The studio plays a level until the goal is met (or the cap), noting how many moves it took. */
export const runLevel = (g: MatchGame, l: MatchLevel, seed: number, cap = 120): LevelRun => {
  let s = createMatch(g, l, seed);
  s = { ...s, moves: cap };
  let scoreAtLimit = -1;
  for (let used = 0; used < cap; used++) {
    const m = bestSwap(g, l, s);
    if (!m) break;
    s = swap(g, l, s, m[0], m[1], true);
    if (used + 1 === l.moves) scoreAtLimit = s.score;
    if (goalMet(l, s)) return { needed: used + 1, score: scoreAtLimit < 0 ? s.score : scoreAtLimit, won: used + 1 <= l.moves };
  }
  return { needed: null, score: scoreAtLimit < 0 ? s.score : scoreAtLimit, won: false };
};

export interface LevelReport {
  runs: number;
  /** Share of runs that met the goal within the level's move limit. */
  winRate: number;
  /** Moves needed, at the middle run and at the 80th percentile. */
  median: number | null;
  p80: number | null;
  /** Share of runs that met the goal at all within the cap. */
  finished: number;
  avgScore: number;
  /** For each move limit (index), the share of runs that would win with it. */
  curve: number[];
}

const reports = new Map<string, LevelReport>();

/** The studio plays a level many times with different boards and sums it up. */
export const levelReport = (g: MatchGame, l: MatchLevel, runs = 40, cap = 120): LevelReport => {
  const key = JSON.stringify([g.rules, l.rows, l.colors, l.moves, l.goal, runs, cap]);
  const hit = reports.get(key);
  if (hit) return hit;
  const results = Array.from({ length: runs }, (_, i) => runLevel(g, l, i + 1, cap));
  const needed = results.map((r) => r.needed).filter((n): n is number => n !== null).sort((a, b) => a - b);
  const pct = (p: number) => {
    const k = Math.ceil(p * runs) - 1;
    return k < needed.length ? needed[Math.max(0, k)]! : null;
  };
  const curve = Array.from({ length: cap + 1 }, (_, m) => needed.filter((n) => n <= m).length / runs);
  const r: LevelReport = { runs, winRate: results.filter((x) => x.won).length / runs, median: pct(0.5), p80: pct(0.8), finished: needed.length / runs, avgScore: Math.round(results.reduce((a, x) => a + x.score, 0) / runs), curve };
  if (reports.size > 100) reports.clear();
  reports.set(key, r);
  return r;
};

/** The move limit at which the studio's player wins about this share of the time; null if it never gets there. */
export const movesFor = (r: LevelReport, share: number): number | null => {
  const m = r.curve.findIndex((w) => w >= share);
  return m < 0 ? null : m;
};

/** Stars for a finished level: one for the goal, two and three at the rules' steps of score. */
export const starsFor = (g: MatchGame, l: MatchLevel, s: MatchState): 0 | 1 | 2 | 3 => {
  if (s.phase !== 'won') return 0;
  const base = l.goal.kind === 'score' ? l.goal.amount : g.rules.points * 10 * Math.max(10, l.moves);
  return s.score >= base * g.rules.starSteps[1] ? 3 : s.score >= base * g.rules.starSteps[0] ? 2 : 1;
};
