import type { Project } from '../types';
import { assetOf, meshesFor, paramOf, type Mesh } from './geometry';
import { levelsOf } from './level';
import { navGraph } from './nav';
import { castOf } from '../character/crowd';
import type { AssetDefinition, LevelSet } from './types';

/**
 * Performance budgets (spec §19): what a level may cost on the platform it
 * is made for, and what it costs now, counted from its graybox. The counts
 * are the studio's estimates from what is placed (graybox pieces, imported
 * models, lights, the people in it, the walkable cells), not a profiler's:
 * they say early, while it is still cheap to move things, that a level is
 * heading over. The engine team gets the budget and the counts in the
 * handoff, and profiles the real thing.
 */

export const METRICS = [
  { id: 'triangles', label: 'Triangles', hint: 'Graybox pieces and imported models, as placed (markers and volumes aren’t drawn in the game).' },
  { id: 'drawCalls', label: 'Draw calls', hint: 'About one a graybox piece or model, and one a person.' },
  { id: 'actors', label: 'People', hint: 'Placed NPCs, companions, enemies and neutrals, and every crowd’s people.' },
  { id: 'lights', label: 'Lights', hint: 'Every light.' },
  { id: 'shadowLights', label: 'Shadow lights', hint: 'Lights set to cast shadows: each draws the scene again.' },
  { id: 'navNodes', label: 'Nav cells', hint: 'Walkable cells in the navigation graph people find their way on.' },
] as const;

export type Metric = (typeof METRICS)[number]['id'];
export type Limits = Record<Metric, number>;

/** Starting points, per platform, for a level loaded at once: change any of them for your project. */
export const PLATFORMS: readonly { id: string; label: string; limits: Limits }[] = [
  { id: 'pc', label: 'PC', limits: { triangles: 5_000_000, drawCalls: 3000, actors: 200, lights: 64, shadowLights: 8, navNodes: 200_000 } },
  { id: 'console', label: 'Console', limits: { triangles: 3_000_000, drawCalls: 2000, actors: 150, lights: 48, shadowLights: 6, navNodes: 150_000 } },
  { id: 'mobile', label: 'Mobile', limits: { triangles: 300_000, drawCalls: 300, actors: 40, lights: 8, shadowLights: 1, navNodes: 30_000 } },
  { id: 'vr', label: 'VR', limits: { triangles: 1_000_000, drawCalls: 800, actors: 60, lights: 16, shadowLights: 2, navNodes: 60_000 } },
];

/** A level's budget: a platform's limits, with any set by hand. */
export interface LevelBudget {
  platform: string;
  limits?: Partial<Limits>;
}

export const limitsOf = (b: LevelBudget): Limits => ({ ...(PLATFORMS.find((p) => p.id === b.platform) ?? PLATFORMS[0]!).limits, ...b.limits });

/** About how many triangles a graybox piece is drawn with. */
const trianglesOf = (m: Mesh, set: LevelSet, global?: readonly AssetDefinition[]): number => {
  switch (m.shape) {
    case 'box':
      return 12;
    case 'wedge':
      return 8;
    case 'pyramid':
      return 6;
    case 'cone':
      return 64;
    case 'cylinder':
      return 128;
    case 'sphere':
      return 960;
    case 'slab':
      // Top and bottom, and two a side.
      return (m.triangles?.length ?? 0) / 3 * 2 + (m.outline?.length ?? 0) * 2;
    case 'model': {
      const item = set.items.find((i) => i.id === m.itemId);
      return (item && assetOf(set, item, global).model?.triangles) || 12;
    }
  }
};

export interface Tally {
  counts: Limits;
  /** For each count, what adds most to it: item ids with what each adds, most first. */
  top: Record<Metric, { itemId: string; amount: number }[]>;
  /** Every item's part of each count (nav cells under the level's id): for the streaming plan's cells. */
  byItem: Record<Metric, ReadonlyMap<string, number>>;
}

// Per project: the people in a crowd come from its characters, not only the level.
const tallies = new WeakMap<Project, Map<string, Tally>>();

/** What a level costs now (or one floor of it), counted from what is placed. */
export const tallyOf = (project: Project, levelId: string, floorId?: string, global?: readonly AssetDefinition[]): Tally => {
  const set = levelsOf(project);
  const memo = tallies.get(project) ?? tallies.set(project, new Map()).get(project)!;
  const key = `${levelId}:${floorId ?? ''}`;
  const known = memo.get(key);
  if (known) return known;
  const items = new Map(set.items.filter((i) => i.levelId === levelId && !i.hidden && (!floorId || i.floorId === floorId)).map((i) => [i.id, i]));
  const by: Record<Metric, Map<string, number>> = { triangles: new Map(), drawCalls: new Map(), actors: new Map(), lights: new Map(), shadowLights: new Map(), navNodes: new Map() };
  const add = (m: Metric, itemId: string, n: number) => n && by[m].set(itemId, (by[m].get(itemId) ?? 0) + n);
  for (const m of meshesFor(set, levelId, { ceilings: true, global, ...(floorId ? { floorId } : {}) })) {
    if (!items.has(m.itemId)) continue;
    // The designer's markers and volumes aren't drawn in the game.
    if (m.part === 'volume' || m.part === 'marker') continue;
    if (m.light) continue;
    add('triangles', m.itemId, trianglesOf(m, set, global));
    add('drawCalls', m.itemId, 1);
  }
  for (const item of items.values()) {
    const def = assetOf(set, item, global);
    if (def.kind === 'light' || def.role === 'light') {
      add('lights', item.id, 1);
      if (paramOf(set, item, 'shadows', global) !== false) add('shadowLights', item.id, 1);
    }
    if (['npc', 'companion', 'enemy', 'neutral'].includes(def.role)) add('actors', item.id, 1);
  }
  // Every crowd's people (one each, and a draw call each), counted as their area.
  for (const c of castOf(project, set, levelId, global)) {
    if (!items.has(c.itemId) || assetOf(set, items.get(c.itemId)!, global).role !== 'crowd') continue;
    add('actors', c.itemId, 1);
    add('drawCalls', c.itemId, 1);
  }
  for (const id of by.actors.keys()) if (assetOf(set, items.get(id)!, global).role !== 'crowd') add('drawCalls', id, 1);
  const g = navGraph(set, levelId, global);
  if (g) {
    const floor = floorId ? set.levels.find((l) => l.id === levelId)?.floors.find((f) => f.id === floorId) : undefined;
    const cells = floor ? g.nodes.filter((n) => n.z >= floor.elevation - 0.6 && n.z < floor.elevation + floor.height).length : g.nodes.length;
    if (cells) by.navNodes.set(levelId, cells);
  }
  const counts = Object.fromEntries(METRICS.map((m) => [m.id, [...by[m.id].values()].reduce((a, b) => a + b, 0)])) as Limits;
  const top = Object.fromEntries(METRICS.map((m) => [m.id, [...by[m.id]].map(([itemId, amount]) => ({ itemId, amount })).sort((a, b) => b.amount - a.amount).slice(0, 3)])) as Tally['top'];
  const out = { counts, top, byItem: by };
  memo.set(key, out);
  return out;
};

/** The counts over a level's budget, with how far over. */
export const overBudget = (project: Project, levelId: string, global?: readonly AssetDefinition[]): { metric: Metric; count: number; limit: number; top: Tally['top'][Metric] }[] => {
  const level = levelsOf(project).levels.find((l) => l.id === levelId);
  if (!level?.budget) return [];
  const limits = limitsOf(level.budget);
  const t = tallyOf(project, levelId, undefined, global);
  return METRICS.filter((m) => t.counts[m.id] > limits[m.id]).map((m) => ({ metric: m.id, count: t.counts[m.id], limit: limits[m.id], top: t.top[m.id] }));
};

/** A count as people read it: 1.2 M, 34 k, 512. */
export const countLabel = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : String(Math.round(n)));
