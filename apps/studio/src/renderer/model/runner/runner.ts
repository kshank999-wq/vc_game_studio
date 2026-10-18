import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Runner (game modules): an endless side-scrolling runner. The player runs
 * on their own, faster the further they get; the player jumps and slides past
 * blocks, bars and pits, and picks up coins. The track is built from chunks
 * the designer draws, strung together at random, the harder tiers joining
 * the further the run goes. The studio checks every chunk can be got through
 * at the speeds it will come at, and runs a player with human timing through
 * them (sim.ts) to say how tight they are and how far runs get.
 */

/** Rows of a chunk, top first: heights 3, 2, 1, 0 (0 sits on the ground). */
export const HEIGHTS = 4;

export interface Chunk {
  id: string;
  name: string;
  /** Unlocks at this tier (1, 2 or 3). */
  tier: number;
  /** How often it comes up against others of its tier. */
  weight: number;
  /** Four rows of cells, heights 3 down to 0: # solid, o a coin, anything else empty. */
  rows: string[];
  /** The ground under it: _ ground, anything else a pit. */
  ground: string;
  notes?: string;
}

export interface Physics {
  /** Units a second at the start, how much faster each 100 units run, and the most. */
  startSpeed: number;
  speedUp: number;
  maxSpeed: number;
  /** Units a second up when a jump starts, and gravity pulling down. */
  jumpSpeed: number;
  gravity: number;
  /** Seconds a slide lasts. */
  slideTime: number;
}

export interface RunnerRules {
  physics: Physics;
  /** Distance at which tiers 2 and 3 start to come up. */
  tierAt: [number, number];
  coinValue: number;
  /** How far off a typical player's timing is, ± milliseconds: the studio's runner plays with this. */
  timingMs: number;
}

export interface RunnerGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  rules: RunnerRules;
  chunks: Chunk[];
}

/** The player's box: width, standing height, sliding height. */
export const PLAYER = { width: 0.8, height: 1.6, slideHeight: 0.8 } as const;

const chunk = (name: string, tier: number, rows: string[], ground: string): Chunk => ({ id: newId('ch'), name, tier, weight: 1, rows, ground });
const blank = (n: number) => '.'.repeat(n);

/** A small playable start to sculpt from: eight chunks across three tiers, each passable. */
export const starterRunner = (): RunnerGame => ({
  concept: { premise: '', platform: 'mobile' },
  rules: {
    physics: { startSpeed: 7, speedUp: 0.25, maxSpeed: 11, jumpSpeed: 11.5, gravity: 28, slideTime: 0.6 },
    tierAt: [250, 600],
    coinValue: 10,
    timingMs: 70,
  },
  chunks: [
    chunk('Hop', 1, [blank(16), '.......ooo......', blank(16), '........#.......'], '________________'),
    chunk('Duck', 1, [blank(16), blank(16), '........##......', '.......ooooo....'], '________________'),
    chunk('Gap', 1, [blank(16), blank(16), '.......oo.......', blank(16)], '_______...______'),
    chunk('Double hop', 2, [blank(20), blank(20), blank(20), '....#.........#.....'], '____________________'),
    chunk('The wall', 2, [blank(18), '........ooo.......', '.........#........', '.........#........'], '__________________'),
    chunk('Duck, then hop', 2, [blank(18), blank(18), '.....##...........', '............#.....'], '__________________'),
    chunk('Gap and bar', 3, [blank(20), blank(20), '.............##.....', '......oo............'], '____....____________'),
    chunk('Stairs', 3, [blank(20), blank(20), '..........o....#....', '......#.........#...'], '____________________'),
  ],
});

/** A new runner project: the starter game to sculpt from, with its premise. */
export const createRunnerProject = (name: string, premise = ''): Project => {
  const g = starterRunner();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'runner', runner: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the runner game; starts one from the starter if there is none. */
export const updateRunner = (project: Project, change: (game: RunnerGame) => RunnerGame): Project => ({ ...project, runner: change(project.runner ?? starterRunner()) });

export const newChunk = (n: number): Chunk => chunk(`Chunk ${n}`, 1, [blank(16), blank(16), blank(16), '........#.......'], '________________');

/** A chunk's length in units. */
export const chunkLength = (c: Chunk) => Math.max(c.ground.length, ...c.rows.map((r) => r.length));

/** The cell at a column and height: solid, a coin, or empty. Height -1 is the ground: solid or a pit. */
export const cellAt = (c: Chunk, x: number, h: number): 'solid' | 'coin' | 'empty' => {
  if (h < 0) return c.ground[x] === '_' ? 'solid' : 'empty';
  const ch = c.rows[HEIGHTS - 1 - h]?.[x];
  return ch === '#' ? 'solid' : ch === 'o' ? 'coin' : 'empty';
};

export type ChunkPaint = 'solid' | 'coin' | 'empty' | 'pit' | 'ground';

/** Paint a cell. Height -1 is the ground row: pit or ground. */
export const paintChunk = (c: Chunk, x: number, h: number, paint: ChunkPaint): Chunk => {
  const len = chunkLength(c);
  if (x < 0 || x >= len) return c;
  if (h < 0) {
    const g = c.ground.padEnd(len, '_').split('');
    g[x] = paint === 'pit' || paint === 'empty' ? '.' : '_';
    return { ...c, ground: g.join('') };
  }
  const r = HEIGHTS - 1 - h;
  const rows = c.rows.map((row, i) => {
    if (i !== r) return row.padEnd(len, '.');
    const cells = row.padEnd(len, '.').split('');
    cells[x] = paint === 'solid' ? '#' : paint === 'coin' ? 'o' : '.';
    return cells.join('');
  });
  return { ...c, rows };
};

/** Make a chunk longer or shorter, keeping what fits; new cells are empty, on ground. */
export const resizeChunk = (c: Chunk, length: number): Chunk => {
  const n = Math.max(6, Math.min(40, Math.round(length)));
  return { ...c, rows: c.rows.map((r) => r.padEnd(n, '.').slice(0, n)), ground: c.ground.padEnd(n, '_').slice(0, n) };
};

/** The speed at a distance into the run. */
export const speedAt = (p: Physics, distance: number) => Math.min(p.maxSpeed, p.startSpeed + (p.speedUp * Math.max(0, distance)) / 100);

/** The slowest and fastest a chunk of a tier will be run at. */
export const speedRange = (r: RunnerRules, tier: number): [number, number] => {
  const from = tier <= 1 ? 0 : r.tierAt[Math.min(tier, 3) - 2]!;
  return [speedAt(r.physics, from), r.physics.maxSpeed];
};

export interface RunnerIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would stop the rules working. Whether chunks can be got through is the solver's. */
export const runnerIssues = (g: RunnerGame): RunnerIssue[] => {
  const out: RunnerIssue[] = [];
  const p = g.rules.physics;
  if (p.startSpeed <= 0 || p.maxSpeed < p.startSpeed) out.push({ severity: 'error', message: 'Speed needs a start, and a most at least as fast.' });
  if (p.jumpSpeed <= 0 || p.gravity <= 0) out.push({ severity: 'error', message: 'Jumping needs a jump speed and gravity.' });
  if (!g.chunks.some((c) => c.tier <= 1)) out.push({ severity: 'error', message: 'No chunk is in tier 1, so the run has nothing to start with.' });
  if (g.rules.tierAt[1] < g.rules.tierAt[0]) out.push({ severity: 'warning', message: 'Tier 3 starts before tier 2.' });
  return out;
};
