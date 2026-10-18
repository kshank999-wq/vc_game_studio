import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Platformer (game modules): a side-scrolling platformer, level by level.
 * The hero runs and jumps across a grid of tiles to the goal flag, past
 * spikes, pits and walking enemies (stomp them from above), picking up
 * coins. The designer paints the levels; the studio maps every place the
 * hero can stand and every jump between them (sim.ts), so it can say
 * whether the goal can be reached, by what route, which coins are out of
 * reach, which jumps are tight, and whether a careful player gets past the
 * enemies.
 *
 * A level is rows of tiles, top first:
 *   #  solid      =  one-way platform (stand on it, jump up through it)
 *   ^  spikes     o  coin      e  walking enemy
 *   S  the start  G  the goal  .  empty
 */

export interface Hero {
  /** Tiles a second running. */
  runSpeed: number;
  /** Tiles a second up when a jump starts, and gravity, tiles a second a second. */
  jumpSpeed: number;
  gravity: number;
  /** Seconds after running off an edge that a jump still works (play only: it makes jumps feel fair). */
  coyoteTime: number;
}

export interface PlatformRules {
  hero: Hero;
  /** Tiles a second an enemy walks. */
  enemySpeed: number;
  coinValue: number;
  lives: number;
}

export interface PlatformLevel {
  id: string;
  name: string;
  rows: string[];
  /** Seconds for the time bonus; 0 for none. */
  par: number;
  notes?: string;
}

export interface PlatformGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  rules: PlatformRules;
  levels: PlatformLevel[];
}

/** The hero's box, in tiles. Under a tile tall, so it fits a one-tile tunnel. */
export const HERO = { width: 0.8, height: 0.9 } as const;

const level = (name: string, rows: string[]): PlatformLevel => ({ id: newId('pl'), name, rows, par: 0 });

/** A small playable start to sculpt from: three levels, each with a way to the goal. */
export const starterPlatformer = (): PlatformGame => ({
  concept: { premise: '', platform: 'pc' },
  rules: { hero: { runSpeed: 6, jumpSpeed: 12, gravity: 32, coyoteTime: 0.1 }, enemySpeed: 2, coinValue: 10, lives: 3 },
  levels: [
    level('First steps', [
      '........................................',
      '........................................',
      '........................................',
      '........................................',
      '........................................',
      '........................................',
      '...................ooo..................',
      '..........ooo...........................',
      '.S................#####..ooo.........G..',
      '.......#####..........................#.',
      '..............#.....######....##..######',
      '##########..#####...######...###..######',
      '##########..#####...######..####..######',
    ]),
    level('Up and over', [
      '..............................................',
      '..............................................',
      '..........................ooo.................',
      '.........................=====................',
      '..................ooo.........................',
      '.................=====........######..........',
      '.............................................G',
      '..........=====.........................=====#',
      '.S......o.o.o...........e.....................',
      '######..######^^^#####################..######',
      '######..##########################.###..######',
      '######..##########################.###..######',
    ]),
    level('The climb', [
      '..............................G.',
      '...........................#####',
      '.......................===......',
      '................................',
      '..........o.o.....===...........',
      '.............e..................',
      '.........#######................',
      '................................',
      '......===.......................',
      '..===...........................',
      '.S..........e...................',
      '##########################^^^^##',
    ]),
  ],
});

/** A new platformer project: the starter game to sculpt from, with its premise. */
export const createPlatformProject = (name: string, premise = ''): Project => {
  const g = starterPlatformer();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'platformer', platformer: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the platformer; starts one from the starter if there is none. */
export const updatePlatformer = (project: Project, change: (game: PlatformGame) => PlatformGame): Project => ({ ...project, platformer: change(project.platformer ?? starterPlatformer()) });

export const newPlatformLevel = (n: number): PlatformLevel =>
  level(`Level ${n}`, ['..............................', '..............................', '..............................', '..............................', '..............................', '.S..........................G.', '##############################', '##############################']);

export type Tile = '#' | '=' | '^' | 'o' | 'e' | 'S' | 'G' | '.';

export interface Grid {
  cols: number;
  rows: number;
  /** Row by row. */
  tiles: Tile[];
}

const TILES = new Set(['#', '=', '^', 'o', 'e', 'S', 'G', '.']);

export const parseGrid = (rows: readonly string[]): Grid => {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const tiles: Tile[] = [];
  for (const r of rows) for (let x = 0; x < cols; x++) tiles.push((TILES.has(r[x] ?? '.') ? (r[x] ?? '.') : '.') as Tile);
  return { cols, rows: rows.length, tiles };
};

export const gridRows = (g: Grid): string[] => Array.from({ length: g.rows }, (_, y) => g.tiles.slice(y * g.cols, (y + 1) * g.cols).join(''));

/** Paint a tile. There is one start and one goal: painting either moves it. */
export const paintTile = (g: Grid, i: number, t: Tile): Grid => {
  if (i < 0 || i >= g.tiles.length) return g;
  const tiles = g.tiles.map((x) => ((t === 'S' || t === 'G') && x === t ? '.' : x)) as Tile[];
  tiles[i] = t;
  return { ...g, tiles };
};

/** Resize, keeping what fits; new cells are empty. */
export const resizeGrid = (g: Grid, cols: number, rows: number): Grid => {
  const c = Math.max(10, Math.min(120, Math.round(cols)));
  const r = Math.max(6, Math.min(24, Math.round(rows)));
  const tiles: Tile[] = [];
  // Rows are kept from the bottom, so the ground stays put.
  const shift = g.rows - r;
  for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) {
    const sy = y + shift;
    tiles.push(sy >= 0 && sy < g.rows && x < g.cols ? g.tiles[sy * g.cols + x]! : '.');
  }
  return { cols: c, rows: r, tiles };
};

export interface PlatformIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What a level needs before it can be played at all (whether the goal can be reached is the studio's to find). */
export const platformIssues = (l: PlatformLevel): PlatformIssue[] => {
  const g = parseGrid(l.rows);
  const out: PlatformIssue[] = [];
  const count = (t: Tile) => g.tiles.filter((x) => x === t).length;
  if (count('S') !== 1) out.push({ severity: 'error', message: count('S') ? 'There is more than one start.' : 'There is no start: paint an S.' });
  if (count('G') !== 1) out.push({ severity: 'error', message: count('G') ? 'There is more than one goal.' : 'There is no goal: paint a G.' });
  return out;
};
