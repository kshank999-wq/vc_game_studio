import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Match-3 (game modules): swap two neighbouring gems to line up three or
 * more of a colour; they clear, the rest fall, new ones drop in, and chains
 * score more. Four in a line makes a line gem, five (or an L or T) a bomb.
 * Each level has a board shape, how many colours, a move limit and a goal:
 * a score, gems of one colour to collect, or jelly to clear. The designer
 * draws the levels, and the studio plays each one many times (sim.ts) to
 * say how often it is beaten and what move limit would make it fair.
 */

export type GoalKind = 'score' | 'collect' | 'jelly';

export interface Goal {
  kind: GoalKind;
  /** Points to reach, or gems to collect. Jelly goals clear every jelly cell. */
  amount: number;
  /** For collect goals: which colour (0-based). */
  color: number;
}

export interface MatchLevel {
  id: string;
  name: string;
  /** The board's shape: . a cell, # no cell, j a cell with jelly under it. */
  rows: string[];
  /** How many of the gem colours fall on this board (3 to 7). */
  colors: number;
  moves: number;
  goal: Goal;
  notes?: string;
}

export interface MatchRules {
  /** What the gems are, in colour order. */
  gems: string[];
  /** Points a gem cleared. */
  points: number;
  /** Each step of a chain scores this much more (0.5: the second clear in a chain scores 1.5 times). */
  chainBonus: number;
  /** Whether four and five in a line make special gems. */
  specials: boolean;
  /** Two and three stars: score at this many times the first star (the goal's score, or the points a goal like it takes). */
  starSteps: [number, number];
}

export interface MatchGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  rules: MatchRules;
  levels: MatchLevel[];
}

export const MAX_COLORS = 7;
export const GEM_HUES = ['#e5534b', '#f08a2c', '#f2c230', '#6fae5e', '#4a86d8', '#9a7fc0', '#e8e4dc'];

const level = (name: string, rows: string[], colors: number, moves: number, goal: Goal): MatchLevel => ({ id: newId('ml'), name, rows, colors, moves, goal });
const full = (cols: number, rows: number, row = '.'.repeat(cols)) => Array.from({ length: rows }, () => row);

/** A small playable start to sculpt from: five levels, one of each goal and a shaped board. */
export const starterMatch = (): MatchGame => ({
  concept: { premise: '', platform: 'mobile' },
  rules: { gems: ['Ruby', 'Amber', 'Topaz', 'Emerald', 'Sapphire', 'Amethyst', 'Pearl'], points: 10, chainBonus: 0.5, specials: true, starSteps: [1.5, 2] },
  levels: [
    level('Warm-up', full(8, 8), 5, 15, { kind: 'score', amount: 1500, color: 0 }),
    level('Gather the blues', full(8, 8), 5, 18, { kind: 'collect', amount: 25, color: 4 }),
    level('Jelly floor', [...full(8, 6), 'jjjjjjjj', 'jjjjjjjj'], 5, 30, { kind: 'jelly', amount: 0, color: 0 }),
    level('The hourglass', ['........', '#......#', '##....##', '###..###', '###..###', '##....##', '#......#', '........'], 6, 27, { kind: 'score', amount: 1500, color: 0 }),
    level('Jelly cross', ['...jj...', '...jj...', '...jj...', 'jjjjjjjj', 'jjjjjjjj', '...jj...', '...jj...', '...jj...'], 6, 28, { kind: 'jelly', amount: 0, color: 0 }),
  ],
});

/** A new match-3 project: the starter game to sculpt from, with its premise. */
export const createMatchProject = (name: string, premise = ''): Project => {
  const g = starterMatch();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'match', match: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the match-3 game; starts one from the starter if there is none. */
export const updateMatch = (project: Project, change: (game: MatchGame) => MatchGame): Project => ({ ...project, match: change(project.match ?? starterMatch()) });

export const newMatchLevel = (n: number): MatchLevel => level(`Level ${n}`, full(8, 8), 5, 20, { kind: 'score', amount: 2000, color: 0 });

export interface Shape {
  cols: number;
  rows: number;
  /** Cells that exist. */
  cell: boolean[];
  jelly: boolean[];
}

/** Read a level's shape. Ragged rows are padded with no cell. */
export const parseShape = (rows: readonly string[]): Shape => {
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const cell: boolean[] = [];
  const jelly: boolean[] = [];
  for (const r of rows)
    for (let x = 0; x < cols; x++) {
      const ch = r[x] ?? '#';
      cell.push(ch !== '#');
      jelly.push(ch === 'j');
    }
  return { cols, rows: rows.length, cell, jelly };
};

export const shapeRows = (s: Shape): string[] => Array.from({ length: s.rows }, (_, y) => Array.from({ length: s.cols }, (_, x) => (s.cell[y * s.cols + x] ? (s.jelly[y * s.cols + x] ? 'j' : '.') : '#')).join(''));

export type ShapePaint = 'cell' | 'hole' | 'jelly';

export const paintShape = (s: Shape, i: number, paint: ShapePaint): Shape => {
  const cell = [...s.cell];
  const jelly = [...s.jelly];
  cell[i] = paint !== 'hole';
  jelly[i] = paint === 'jelly';
  return { ...s, cell, jelly };
};

export const resizeShape = (s: Shape, cols: number, rows: number): Shape => {
  const c = Math.max(4, Math.min(10, Math.round(cols)));
  const r = Math.max(4, Math.min(10, Math.round(rows)));
  const cell: boolean[] = [];
  const jelly: boolean[] = [];
  for (let y = 0; y < r; y++)
    for (let x = 0; x < c; x++) {
      const inside = x < s.cols && y < s.rows;
      cell.push(inside ? s.cell[y * s.cols + x]! : true);
      jelly.push(inside ? s.jelly[y * s.cols + x]! : false);
    }
  return { cols: c, rows: r, cell, jelly };
};

export interface MatchIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would stop a level working. */
export const levelIssues = (g: MatchGame, l: MatchLevel): MatchIssue[] => {
  const out: MatchIssue[] = [];
  const s = parseShape(l.rows);
  const cells = s.cell.filter(Boolean).length;
  if (cells < 12) out.push({ severity: 'error', message: 'The board needs at least 12 cells.' });
  if (l.colors < 3 || l.colors > Math.min(MAX_COLORS, g.rules.gems.length)) out.push({ severity: 'error', message: `Use 3 to ${Math.min(MAX_COLORS, g.rules.gems.length)} colours.` });
  if (l.moves < 1) out.push({ severity: 'error', message: 'The level needs a move limit.' });
  if (l.goal.kind === 'jelly' && !s.jelly.some(Boolean)) out.push({ severity: 'error', message: 'A jelly goal needs jelly on the board: paint some.' });
  if (l.goal.kind === 'collect' && l.goal.color >= l.colors) out.push({ severity: 'error', message: 'The colour to collect doesn’t fall on this board: use more colours or pick another.' });
  if (l.goal.kind !== 'jelly' && l.goal.amount < 1) out.push({ severity: 'error', message: 'The goal needs an amount.' });
  return out;
};

/** The goal in words. */
export const goalText = (g: MatchGame, l: MatchLevel): string =>
  l.goal.kind === 'score' ? `Score ${l.goal.amount.toLocaleString()}` : l.goal.kind === 'collect' ? `Collect ${l.goal.amount} ${g.rules.gems[l.goal.color] ?? 'gems'}` : 'Clear all the jelly';
