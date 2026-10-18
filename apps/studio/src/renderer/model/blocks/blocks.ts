import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Puzzle game (game modules): a push-block puzzle, level after level. The
 * player walks a grid and pushes crates onto the targets; a crate can only
 * be pushed, one at a time, never pulled. The designer draws the levels,
 * puts them in order, and the studio solves each one (solver.ts) to say
 * whether it can be done, in how few moves, and how hard it is. The handoff
 * sends the levels to the engine as data, with their solutions.
 *
 * A level is kept as rows of the standard text format, so levels can be
 * pasted in from anywhere that uses it:
 *   #  wall      (space) floor      .  target
 *   $  crate     *  crate on a target
 *   @  player    +  player on a target
 */

export interface Level {
  id: string;
  name: string;
  rows: string[];
  /** Moves for three stars; 0 takes the solver's best. */
  par: number;
  notes?: string;
}

export interface BlockRules {
  /** The words the game uses, so the studio speaks its language. */
  crateWord: string;
  targetWord: string;
  /** Whether the player can take moves back. */
  undo: boolean;
  /** Stars: three at par, two within this share over it, one for finishing. */
  twoStarSlack: number;
}

export interface BlockGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  rules: BlockRules;
  levels: Level[];
}

export type Tile = 'wall' | 'floor' | 'target';

export interface Board {
  cols: number;
  rows: number;
  /** Row by row, cols × rows. */
  tiles: Tile[];
  crates: number[];
  player: number;
}

/** Read a level's rows into a board. Ragged rows are padded with floor. */
export const parseLevel = (rows: readonly string[]): Board => {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const tiles: Tile[] = [];
  const crates: number[] = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < cols; x++) {
      const ch = row[x] ?? ' ';
      const i = y * cols + x;
      tiles.push(ch === '#' ? 'wall' : ch === '.' || ch === '*' || ch === '+' ? 'target' : 'floor');
      if (ch === '$' || ch === '*') crates.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  return { cols, rows: rows.length, tiles, crates, player };
};

/** Write a board back to rows, trailing spaces trimmed. */
export const levelRows = (b: Board): string[] => {
  const crates = new Set(b.crates);
  const out: string[] = [];
  for (let y = 0; y < b.rows; y++) {
    let row = '';
    for (let x = 0; x < b.cols; x++) {
      const i = y * b.cols + x;
      const t = b.tiles[i];
      const c = crates.has(i);
      const p = b.player === i;
      row += t === 'wall' ? '#' : t === 'target' ? (c ? '*' : p ? '+' : '.') : c ? '$' : p ? '@' : ' ';
    }
    out.push(row.replace(/\s+$/, ''));
  }
  return out;
};

export type Paint = 'wall' | 'floor' | 'target' | 'crate' | 'player';

/** Paint a cell: walls, floor and targets set the tile; a crate or the player is placed on it (again to take a crate off). */
export const paintCell = (b: Board, i: number, paint: Paint): Board => {
  if (i < 0 || i >= b.tiles.length) return b;
  const tiles = [...b.tiles];
  let crates = b.crates.filter((c) => c !== i || paint === 'crate');
  let player = b.player;
  if (paint === 'wall' || paint === 'floor' || paint === 'target') {
    tiles[i] = paint;
    if (paint === 'wall') {
      crates = crates.filter((c) => c !== i);
      if (player === i) player = -1;
    }
  } else if (paint === 'crate') {
    if (tiles[i] === 'wall') tiles[i] = 'floor';
    crates = b.crates.includes(i) ? b.crates.filter((c) => c !== i) : [...b.crates, i];
    if (player === i) player = -1;
  } else {
    if (tiles[i] === 'wall') tiles[i] = 'floor';
    player = i;
  }
  return { ...b, tiles, crates, player };
};

/** Resize, keeping what fits; new cells are wall. */
export const resizeBoard = (b: Board, cols: number, rows: number): Board => {
  const c = Math.max(3, Math.min(20, Math.round(cols)));
  const r = Math.max(3, Math.min(20, Math.round(rows)));
  const map = (i: number) => {
    const x = i % b.cols;
    const y = Math.floor(i / b.cols);
    return x < c && y < r ? y * c + x : -1;
  };
  const tiles: Tile[] = [];
  for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) tiles.push(x < b.cols && y < b.rows ? b.tiles[y * b.cols + x]! : 'wall');
  return { cols: c, rows: r, tiles, crates: b.crates.map(map).filter((i) => i >= 0), player: map(b.player) };
};

const level = (name: string, rows: string[]): Level => ({ id: newId('lv'), name, rows, par: 0 });

/** A small playable start to sculpt from: five levels, rising in difficulty, each solvable. */
export const starterBlocks = (): BlockGame => ({
  concept: { premise: '', platform: 'mobile' },
  rules: { crateWord: 'crate', targetWord: 'target', undo: true, twoStarSlack: 0.5 },
  levels: [
    level('First push', ['#######', '#@ $ .#', '#######']),
    level('Around the corner', ['######', '#    #', '# #$ #', '# .@ #', '######']),
    level('Two at once', ['#######', '#     #', '# $@$ #', '#.   .#', '#######']),
    level('The storeroom', ['########', '#      #', '# .**$@#', '#      #', '#####  #', '    ####']),
    level('Tight squeeze', ['  #####', '###   #', '#.@$  #', '### $.#', '#.##$ #', '# # . ##', '#$ *$$.#', '#   .  #', '########']),
  ],
});

/** A new puzzle game project: the starter game to sculpt from, with its premise. */
export const createBlockProject = (name: string, premise = ''): Project => {
  const g = starterBlocks();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'blocks', blocks: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the puzzle game; starts one from the starter if there is none. */
export const updateBlocks = (project: Project, change: (game: BlockGame) => BlockGame): Project => ({ ...project, blocks: change(project.blocks ?? starterBlocks()) });

/** A new level: an empty room with a crate, a target and the player. */
export const newLevel = (n: number): Level => level(`Level ${n}`, ['#######', '#     #', '# @$. #', '#     #', '#######']);

export interface LevelIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What the level needs before it can be played at all (whether it can be solved is the solver's). */
export const levelIssues = (b: Board): LevelIssue[] => {
  const out: LevelIssue[] = [];
  const targets = b.tiles.filter((t) => t === 'target').length;
  if (b.player < 0) out.push({ severity: 'error', message: 'There is no player start.' });
  if (!b.crates.length) out.push({ severity: 'error', message: 'There are no crates.' });
  if (b.crates.length !== targets) out.push({ severity: 'error', message: `${b.crates.length} crates for ${targets} targets: they should match.` });
  // The edge must be closed, or the player walks off the map.
  const walk = reachable(b, []);
  for (let i = 0; i < b.tiles.length; i++) {
    const x = i % b.cols;
    const y = Math.floor(i / b.cols);
    if (b.tiles[i] !== 'wall' && (x === 0 || y === 0 || x === b.cols - 1 || y === b.rows - 1) && walk.has(i)) {
      out.push({ severity: 'warning', message: 'The player can reach the edge of the map: close it with wall.' });
      break;
    }
  }
  return out;
};

/** Cells the player can walk to from the start, around crates. */
export const reachable = (b: Board, crates: readonly number[] = b.crates, from = b.player): Set<number> => {
  const seen = new Set<number>();
  if (from < 0) return seen;
  const blocked = new Set(crates);
  const queue = [from];
  seen.add(from);
  while (queue.length) {
    const i = queue.shift()!;
    for (const n of neighbours(b, i)) if (!seen.has(n) && b.tiles[n] !== 'wall' && !blocked.has(n)) (seen.add(n), queue.push(n));
  }
  return seen;
};

/** The cells next to one, inside the map. */
export const neighbours = (b: Board, i: number): number[] => {
  const x = i % b.cols;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < b.cols - 1) out.push(i + 1);
  if (i - b.cols >= 0) out.push(i - b.cols);
  if (i + b.cols < b.tiles.length) out.push(i + b.cols);
  return out;
};
