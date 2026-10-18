import { neighbours, parseLevel, type Board, type Level } from './blocks';

/**
 * Playing and solving a push-block level. A move is a step up, down, left
 * or right; walking into a crate pushes it, if the cell beyond is free.
 * Solutions are written the standard way: u d l r for a step, U D L R for a
 * push. The solver searches every position breadth first, so the solution
 * it finds has the fewest moves, and skips positions with a crate where it
 * can never reach a target (in a corner, say).
 */

export type Dir = 'u' | 'd' | 'l' | 'r';
export const DIRS: readonly Dir[] = ['u', 'd', 'l', 'r'];

export interface PlayState {
  player: number;
  crates: number[];
  moves: number;
  pushes: number;
  /** The moves so far, as u d l r / U D L R. */
  path: string;
}

export const startState = (b: Board): PlayState => ({ player: b.player, crates: [...b.crates].sort((a, z) => a - z), moves: 0, pushes: 0, path: '' });

const offset = (b: Board, i: number, d: Dir): number => {
  const x = i % b.cols;
  if (d === 'l') return x > 0 ? i - 1 : -1;
  if (d === 'r') return x < b.cols - 1 ? i + 1 : -1;
  const n = d === 'u' ? i - b.cols : i + b.cols;
  return n >= 0 && n < b.tiles.length ? n : -1;
};

const free = (b: Board, i: number, crates: readonly number[]) => i >= 0 && b.tiles[i] !== 'wall' && !crates.includes(i);

/** One step. Null if it goes nowhere (a wall, or a crate that can't move). */
export const step = (b: Board, s: PlayState, d: Dir): PlayState | null => {
  const to = offset(b, s.player, d);
  if (to < 0 || b.tiles[to] === 'wall') return null;
  const at = s.crates.indexOf(to);
  if (at < 0) return { ...s, player: to, moves: s.moves + 1, path: s.path + d };
  const beyond = offset(b, to, d);
  if (!free(b, beyond, s.crates)) return null;
  const crates = [...s.crates];
  crates[at] = beyond;
  crates.sort((a, z) => a - z);
  return { player: to, crates, moves: s.moves + 1, pushes: s.pushes + 1, path: s.path + d.toUpperCase() };
};

/** Every crate on a target. */
export const solved = (b: Board, s: PlayState): boolean => s.crates.length > 0 && s.crates.every((c) => b.tiles[c] === 'target');

/** Play a solution string from the start. Null if a move in it can't be made. */
export const replay = (b: Board, path: string): PlayState | null => {
  let s: PlayState | null = startState(b);
  for (const ch of path) {
    if (!s) return null;
    s = step(b, s, ch.toLowerCase() as Dir);
  }
  return s;
};

/**
 * Cells a crate can still be pushed from to some target: worked backwards,
 * pulling from every target. A crate pushed anywhere else is stuck for good.
 */
export const liveCells = (b: Board): Set<number> => {
  const live = new Set<number>();
  const queue: number[] = [];
  b.tiles.forEach((t, i) => {
    if (t === 'target') (live.add(i), queue.push(i));
  });
  while (queue.length) {
    const i = queue.shift()!;
    for (const d of DIRS) {
      // Pull the crate from i to j: the player stands at j and steps on to k.
      const j = offset(b, i, d);
      const k = j < 0 ? -1 : offset(b, j, d);
      if (j < 0 || k < 0 || b.tiles[j] === 'wall' || b.tiles[k] === 'wall' || live.has(j)) continue;
      live.add(j);
      queue.push(j);
    }
  }
  return live;
};

export interface Solution {
  status: 'solved' | 'unsolvable' | 'too big' | 'not ready';
  /** The fewest moves, and the pushes on that solution. */
  moves: number;
  pushes: number;
  path: string;
  /** Positions the search looked at: how much there is to think through. */
  explored: number;
}

/** The most positions the solver looks at before giving up. */
export const SOLVE_LIMIT = 150_000;

/** Solve a board: the fewest moves, or why there are none. */
export const solveBoard = (b: Board, limit = SOLVE_LIMIT): Solution => {
  const none = (status: Solution['status'], explored = 0): Solution => ({ status, moves: 0, pushes: 0, path: '', explored });
  const targets = b.tiles.filter((t) => t === 'target').length;
  if (b.player < 0 || !b.crates.length || b.crates.length !== targets) return none('not ready');
  const live = liveCells(b);
  if (b.crates.some((c) => !live.has(c))) return none('unsolvable', 1);
  const start = startState(b);
  if (solved(b, start)) return { status: 'solved', moves: 0, pushes: 0, path: '', explored: 1 };
  const key = (s: { player: number; crates: readonly number[] }) => `${s.player}|${s.crates.join(',')}`;
  // Each position remembers how it was reached, to write the path out at the end.
  const from = new Map<string, { prev: string; move: string }>();
  from.set(key(start), { prev: '', move: '' });
  let frontier: { player: number; crates: number[] }[] = [{ player: start.player, crates: start.crates }];
  let explored = 1;
  while (frontier.length) {
    const next: { player: number; crates: number[] }[] = [];
    for (const s of frontier) {
      const k = key(s);
      for (const d of DIRS) {
        const to = offset(b, s.player, d);
        if (to < 0 || b.tiles[to] === 'wall') continue;
        const at = s.crates.indexOf(to);
        let crates = s.crates;
        let move: string = d;
        if (at >= 0) {
          const beyond = offset(b, to, d);
          if (!free(b, beyond, s.crates) || !live.has(beyond)) continue;
          crates = [...s.crates];
          crates[at] = beyond;
          crates.sort((a, z) => a - z);
          move = d.toUpperCase();
        }
        const n = { player: to, crates };
        const nk = key(n);
        if (from.has(nk)) continue;
        from.set(nk, { prev: k, move });
        explored++;
        if (crates.every((c) => b.tiles[c] === 'target')) {
          let path = '';
          for (let at2 = nk; at2 !== key(start); ) {
            const f = from.get(at2)!;
            path = f.move + path;
            at2 = f.prev;
          }
          return { status: 'solved', moves: path.length, pushes: [...path].filter((c) => c === c.toUpperCase()).length, path, explored };
        }
        if (explored >= limit) return none('too big', explored);
        next.push(n);
      }
    }
    frontier = next;
  }
  return none('unsolvable', explored);
};

const memo = new Map<string, Solution>();

/** Solve a level, remembering the answer for the same rows. */
export const solveLevel = (l: Pick<Level, 'rows'>): Solution => {
  const k = l.rows.join('\n');
  const hit = memo.get(k);
  if (hit) return hit;
  const s = solveBoard(parseLevel(l.rows));
  if (memo.size > 200) memo.clear();
  memo.set(k, s);
  return s;
};

/**
 * How hard a solved level is, 1 to 5: how much there is to search through
 * and how many pushes it takes. A guide to the order, not a measure of fun.
 */
export const difficulty = (s: Solution): number => {
  if (s.status !== 'solved') return 0;
  const d = Math.log10(Math.max(1, s.explored)) + s.pushes / 8;
  return d < 2 ? 1 : d < 2.8 ? 2 : d < 3.6 ? 3 : d < 4.4 ? 4 : 5;
};

/** Stars for finishing in so many moves: three at par, two within the slack over it, one otherwise. */
export const stars = (moves: number, par: number, slack: number): 1 | 2 | 3 => (moves <= par ? 3 : moves <= Math.ceil(par * (1 + slack)) ? 2 : 1);

/** The cells next to a crate the player could push it from right now (for hints). */
export const pushable = (b: Board, s: PlayState): number[] => s.crates.filter((c) => neighbours(b, c).some((n) => n === s.player));
