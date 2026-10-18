import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Castle defense (game modules): the whole game as data the designer roughs
 * in step by step and refines: a grid map with the enemies' path and the spots
 * towers can be built on, the towers, the enemies, the waves they come in,
 * and the economy. The play preview and the balance check run it (sim.ts);
 * the handoff sends it to the engine as data.
 */

/** A grid cell: column, row. Row 0 is the top. */
export type Cell = [number, number];

export interface DefenseMap {
  cols: number;
  rows: number;
  /** The enemies' path, cell by cell from where they come in to the castle. Each cell is next to the one before. */
  path: Cell[];
  /** Where towers can be built. */
  spots: Cell[];
}

/** A tower at one upgrade level. */
export interface TowerStats {
  /** Gold to build (level 1) or to upgrade to this level. */
  cost: number;
  /** Damage a shot. */
  damage: number;
  /** Reach, in cells. */
  range: number;
  /** Shots a second. */
  rate: number;
}

export interface Tower extends TowerStats {
  id: string;
  name: string;
  /** Damage also lands on enemies this many cells round the target. 0: one target. */
  splash: number;
  /** Slows what it hits by this share (0–0.9) for a second. */
  slow: number;
  /** Whether it can hit flying enemies. */
  hitsAir: boolean;
  /** Levels 2, 3…: each its own cost and stats. */
  upgrades: TowerStats[];
  notes?: string;
}

export interface Enemy {
  id: string;
  name: string;
  health: number;
  /** Cells a second. */
  speed: number;
  /** Taken off every hit's damage (never below 1). */
  armor: number;
  /** Gold for killing it. */
  reward: number;
  /** Lives lost if it reaches the castle. */
  leak: number;
  flying: boolean;
  notes?: string;
}

/** Some of one enemy in a wave. */
export interface WaveGroup {
  enemyId: string;
  count: number;
  /** Seconds between one and the next. */
  gap: number;
  /** Seconds after the wave starts that the first comes. */
  delay: number;
}

export interface Wave {
  id: string;
  groups: WaveGroup[];
  /** Gold for getting through it. */
  bonus: number;
}

export interface Economy {
  startGold: number;
  lives: number;
  /** Share of what a tower cost that selling it gives back (0–1). */
  sellBack: number;
  /** Seconds between one wave's last enemy and the next wave. */
  breather: number;
}

/** A tower placed on a build spot, for the play preview and the balance check. */
export interface Placement {
  spot: number;
  towerId: string;
  /** 1 is as built. */
  level: number;
}

export interface DefenseGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  map: DefenseMap;
  towers: Tower[];
  enemies: Enemy[];
  waves: Wave[];
  economy: Economy;
  /** The test layout the play preview starts with and the balance check uses. */
  layout: Placement[];
}

const tower = (name: string, s: Partial<Tower>): Tower => ({ id: newId('tw'), name, cost: 50, damage: 10, range: 2.5, rate: 1, splash: 0, slow: 0, hitsAir: true, upgrades: [], ...s });
const enemy = (name: string, s: Partial<Enemy>): Enemy => ({ id: newId('en'), name, health: 50, speed: 1.2, armor: 0, reward: 5, leak: 1, flying: false, ...s });

/** A small playable start to sculpt from: a winding path, build spots beside it, two towers, three enemies, five waves. */
export const starterDefense = (): DefenseGame => {
  const path: Cell[] = [];
  for (let c = 0; c <= 5; c++) path.push([c, 1]);
  for (let r = 2; r <= 5; r++) path.push([5, r]);
  for (let c = 6; c <= 10; c++) path.push([c, 5]);
  for (let r = 4; r >= 2; r--) path.push([10, r]);
  path.push([11, 2]);
  const spots: Cell[] = [
    [2, 2], [4, 0], [4, 3], [6, 3], [6, 6], [8, 4], [9, 6], [11, 4], [9, 2], [7, 1],
  ];
  const archer = tower('Archer tower', { cost: 50, damage: 12, range: 2.5, rate: 1.2, upgrades: [{ cost: 40, damage: 18, range: 2.8, rate: 1.4 }, { cost: 70, damage: 26, range: 3, rate: 1.6 }] });
  const cannon = tower('Cannon', { cost: 90, damage: 30, range: 2.2, rate: 0.5, splash: 1, hitsAir: false, upgrades: [{ cost: 80, damage: 45, range: 2.4, rate: 0.55 }] });
  const grunt = enemy('Goblin', { health: 40, speed: 1.4, reward: 4 });
  const brute = enemy('Ogre', { health: 220, speed: 0.7, armor: 4, reward: 15, leak: 3 });
  const bat = enemy('Bat swarm', { health: 25, speed: 2.2, reward: 3, flying: true });
  const w = (bonus: number, ...groups: WaveGroup[]): Wave => ({ id: newId('wv'), bonus, groups });
  return {
    concept: { premise: '', platform: 'mobile' },
    map: { cols: 12, rows: 7, path, spots },
    towers: [archer, cannon],
    enemies: [grunt, brute, bat],
    waves: [
      w(20, { enemyId: grunt.id, count: 8, gap: 1.2, delay: 0 }),
      w(25, { enemyId: grunt.id, count: 12, gap: 1, delay: 0 }, { enemyId: bat.id, count: 4, gap: 1.5, delay: 6 }),
      w(30, { enemyId: grunt.id, count: 10, gap: 0.9, delay: 0 }, { enemyId: brute.id, count: 2, gap: 4, delay: 5 }),
      w(35, { enemyId: bat.id, count: 12, gap: 0.6, delay: 0 }, { enemyId: grunt.id, count: 12, gap: 0.8, delay: 4 }),
      w(50, { enemyId: brute.id, count: 5, gap: 2.5, delay: 0 }, { enemyId: grunt.id, count: 16, gap: 0.6, delay: 3 }),
    ],
    economy: { startGold: 220, lives: 20, sellBack: 0.7, breather: 5 },
    layout: [
      { spot: 0, towerId: archer.id, level: 1 },
      { spot: 3, towerId: cannon.id, level: 1 },
    ],
  };
};

/** A new castle defense project: the starter game to sculpt from, with its premise. */
export const createDefenseProject = (name: string, premise = ''): Project => {
  const g = starterDefense();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'defense', defense: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

export const defenseOf = (project: Project): DefenseGame | undefined => project.defense;

/** Change the castle defense game; starts one from the starter if there is none. */
export const updateDefense = (project: Project, change: (game: DefenseGame) => DefenseGame): Project => ({ ...project, defense: change(project.defense ?? starterDefense()) });

export const newTower = (): Tower => tower('New tower', {});
export const newEnemy = (): Enemy => enemy('New enemy', {});
export const newWave = (enemyId: string): Wave => ({ id: newId('wv'), bonus: 20, groups: enemyId ? [{ enemyId, count: 10, gap: 1, delay: 0 }] : [] });

const adjacent = (a: Cell, b: Cell) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
const inside = (m: DefenseMap, c: Cell) => c[0] >= 0 && c[1] >= 0 && c[0] < m.cols && c[1] < m.rows;

/**
 * Click a cell to lay the path: next to its end adds to it, its end takes the
 * last cell back off, anywhere else starts it again there.
 */
export const pathClick = (map: DefenseMap, cell: Cell): DefenseMap => {
  const path = map.path;
  const last = path[path.length - 1];
  if (last && same(last, cell)) return { ...map, path: path.slice(0, -1) };
  if (last && adjacent(last, cell) && !path.some((p) => same(p, cell))) return { ...map, path: [...path, cell], spots: map.spots.filter((s) => !same(s, cell)) };
  return { ...map, path: [cell], spots: map.spots.filter((s) => !same(s, cell)) };
};

/** Click a cell to make it a build spot, or not. Path cells can't be. */
export const spotClick = (map: DefenseMap, cell: Cell): DefenseMap => {
  if (map.path.some((p) => same(p, cell))) return map;
  return map.spots.some((s) => same(s, cell)) ? { ...map, spots: map.spots.filter((s) => !same(s, cell)) } : { ...map, spots: [...map.spots, cell] };
};

/** Resize, keeping what still fits; a path cut short ends where it leaves the map. */
export const resizeMap = (map: DefenseMap, cols: number, rows: number): DefenseMap => {
  const m = { ...map, cols: Math.max(4, Math.min(40, Math.round(cols))), rows: Math.max(3, Math.min(30, Math.round(rows))) };
  const cut = m.path.findIndex((c) => !inside(m, c));
  return { ...m, path: cut < 0 ? m.path : m.path.slice(0, cut), spots: m.spots.filter((c) => inside(m, c)) };
};

/** A tower's stats at a level (1 is as built). */
export const statsAt = (t: Tower, level: number): TowerStats => (level <= 1 ? t : (t.upgrades[Math.min(level, t.upgrades.length + 1) - 2] ?? t));

/** All a tower costs to build and bring to a level. */
export const costTo = (t: Tower, level: number): number => t.cost + t.upgrades.slice(0, Math.max(0, level - 1)).reduce((n, u) => n + u.cost, 0);

export interface DefenseIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would stop the game working, or likely make it no fun. */
export const defenseIssues = (g: DefenseGame): DefenseIssue[] => {
  const out: DefenseIssue[] = [];
  const err = (message: string) => out.push({ severity: 'error', message });
  const warn = (message: string) => out.push({ severity: 'warning', message });
  if (g.map.path.length < 2) err('The map has no path yet: lay it from where enemies come in to the castle.');
  for (let i = 1; i < g.map.path.length; i++) if (!adjacent(g.map.path[i - 1]!, g.map.path[i]!)) err(`The path jumps between cells ${i} and ${i + 1}.`);
  if (!g.map.spots.length) err('There is nowhere to build: add build spots beside the path.');
  if (!g.towers.length) err('There are no towers.');
  if (!g.enemies.length) err('There are no enemies.');
  if (!g.waves.length) err('There are no waves.');
  const enemies = new Set(g.enemies.map((e) => e.id));
  g.waves.forEach((w, i) => {
    if (!w.groups.length) warn(`Wave ${i + 1} has no enemies.`);
    for (const grp of w.groups) if (!enemies.has(grp.enemyId)) err(`Wave ${i + 1} sends an enemy that no longer exists.`);
  });
  const cheapest = Math.min(...g.towers.map((t) => t.cost));
  if (g.towers.length && cheapest > g.economy.startGold) err(`The cheapest tower costs ${cheapest} gold, more than the ${g.economy.startGold} the player starts with.`);
  if (g.enemies.some((e) => e.flying) && g.towers.length && !g.towers.some((t) => t.hitsAir)) err('Some enemies fly, but no tower can hit them.');
  for (const t of g.towers) {
    if (t.damage <= 0 || t.rate <= 0 || t.range <= 0) err(`${t.name} can't hurt anything: give it damage, a rate and a range.`);
    for (const e of g.enemies) if (e.armor >= t.damage && t.upgrades.every((u) => e.armor >= u.damage)) warn(`${e.name}'s armor shrugs off ${t.name} (1 damage a hit).`);
  }
  for (const p of g.layout) if (p.spot >= g.map.spots.length || !g.towers.some((t) => t.id === p.towerId)) warn('The test layout has a tower on a spot or of a kind that no longer exists.');
  return out;
};
