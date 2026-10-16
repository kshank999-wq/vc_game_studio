import type { Project } from '../types';
import { limitsOf, METRICS, tallyOf, type Limits, type Metric } from './budget';
import { assetOf, boundsOf, corners, frameOf } from './geometry';
import { levelsOf } from './level';
import { motionOf } from './actors';
import { navGraph } from './nav';
import type { AssetDefinition, LevelItem } from './types';

/**
 * Streaming and world-partition planning (spec §19): a large map cut into a
 * grid of cells the game loads as the player nears them. The plan says how
 * big a cell is, how far around the player cells stay loaded, and what stays
 * loaded wherever the player is (the player start, and what the designer
 * marks). From it the studio works out each cell's contents and costs, what
 * is loaded together at its worst, and where the story reaches out of what is
 * loaded. The engine team builds the real partition from it: Unreal's World
 * Partition grid, Unity's additive scenes, Godot's streamed scenes.
 */

export interface StreamingPlan {
  /** A cell's side, in metres. */
  cell: number;
  /** How far round the player cells stay loaded, in metres. */
  range: number;
  /** Items that stay loaded wherever the player is, besides the player start. */
  always?: string[];
}

export const DEFAULT_PLAN: StreamingPlan = { cell: 64, range: 128 };

export interface StreamCell {
  /** Column letters then row number, as on the map: A1 is the north-west cell. */
  key: string;
  col: number;
  row: number;
  /** Its square on the plan: west, north, east, south edges. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** The items whose centre is in it (not those always loaded). */
  items: string[];
  counts: Limits;
}

export interface StreamLayout {
  plan: StreamingPlan;
  cols: number;
  rows: number;
  /** The grid's north-west corner. */
  x: number;
  y: number;
  cells: StreamCell[];
  /** Every item that stays loaded: the player start and those marked. */
  always: string[];
  /** What is loaded with the player in each cell (its cells within range, and those always loaded): the worst of them per count. */
  worst: { metric: Metric; count: number; around: string }[];
}

const letters = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : letters(Math.floor(n / 26) - 1) + String.fromCharCode(65 + (n % 26)));

const zero = (): Limits => Object.fromEntries(METRICS.map((m) => [m.id, 0])) as Limits;

/** The plan's cells for a level, with what is in each and what the loaded cells cost; null when it has no plan or nothing in it. */
export const streamLayout = (project: Project, levelId: string, global?: readonly AssetDefinition[]): StreamLayout | null => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level?.streaming) return null;
  const plan = { ...DEFAULT_PLAN, ...level.streaming, cell: Math.max(1, level.streaming.cell), range: Math.max(0, level.streaming.range) };
  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  if (!items.length) return null;
  const b = boundsOf(items.flatMap((i) => corners(frameOf(set, i, global))));
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / plan.cell));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / plan.cell));
  const x = b.minX;
  const y = b.minY;
  const cellAt = (px: number, py: number) => {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((px - x) / plan.cell)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((py - y) / plan.cell)));
    return r * cols + c;
  };
  const always = new Set([...(plan.always ?? []).filter((id) => items.some((i) => i.id === id)), ...items.filter((i) => assetOf(set, i, global).role === 'playerStart').map((i) => i.id)]);
  const cells: StreamCell[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push({ key: `${letters(c)}${r + 1}`, col: c, row: r, x0: x + c * plan.cell, y0: y + r * plan.cell, x1: x + (c + 1) * plan.cell, y1: y + (r + 1) * plan.cell, items: [], counts: zero() });
  const t = tallyOf(project, levelId, undefined, global);
  const alwaysCounts = zero();
  for (const i of items) {
    const f = frameOf(set, i, global);
    const cell = cells[cellAt(f.x, f.y)]!;
    if (!always.has(i.id)) cell.items.push(i.id);
    for (const m of METRICS) {
      const n = t.byItem[m.id].get(i.id) ?? 0;
      if (always.has(i.id)) alwaysCounts[m.id] += n;
      else cell.counts[m.id] += n;
    }
  }
  // Walkable cells by where they are.
  const g = navGraph(set, levelId, global);
  if (g) for (const n of g.nodes) cells[cellAt(n.x, n.y)]!.counts.navNodes += 1;
  // The cells loaded with the player in each: those whose square comes within range of it.
  const reach = Math.ceil(plan.range / plan.cell);
  const worst = METRICS.map((m) => {
    let count = 0;
    let around = cells[0]!.key;
    for (const c of cells) {
      let sum = alwaysCounts[m.id];
      for (const o of cells) if (Math.abs(o.col - c.col) <= reach && Math.abs(o.row - c.row) <= reach) sum += o.counts[m.id];
      if (sum > count) {
        count = sum;
        around = c.key;
      }
    }
    return { metric: m.id, count, around };
  });
  return { plan, cols, rows, x, y, cells, always: [...always], worst };
};

/** The cell an item is in. */
export const cellOfItem = (layout: StreamLayout, set: ReturnType<typeof levelsOf>, item: LevelItem, global?: readonly AssetDefinition[]): StreamCell => {
  const f = frameOf(set, item, global);
  const c = Math.min(layout.cols - 1, Math.max(0, Math.floor((f.x - layout.x) / layout.plan.cell)));
  const r = Math.min(layout.rows - 1, Math.max(0, Math.floor((f.y - layout.y) / layout.plan.cell)));
  return layout.cells[r * layout.cols + c]!;
};

/** Whether two cells are loaded together: within the plan's range of each other. */
const together = (layout: StreamLayout, a: StreamCell, b: StreamCell) => {
  const reach = Math.ceil(layout.plan.range / layout.plan.cell);
  return Math.abs(a.col - b.col) <= reach && Math.abs(a.row - b.row) <= reach;
};

export interface StreamingIssue {
  id: string;
  message: string;
  export: string;
}

/**
 * Where the plan and the level disagree: a rule acting on something that may
 * not be loaded when it fires, a patrol walking out of what is loaded around
 * its actor, and loaded cells over the level's performance budget.
 */
export const streamingIssues = (project: Project, levelId: string, global?: readonly AssetDefinition[]): StreamingIssue[] => {
  const layout = streamLayout(project, levelId, global);
  if (!layout) return [];
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId)!;
  const always = new Set(layout.always);
  const byId = new Map(set.items.map((i) => [i.id, i]));
  const out: StreamingIssue[] = [];
  for (const item of set.items.filter((i) => i.levelId === levelId && !i.hidden)) {
    const here = cellOfItem(layout, set, item, global);
    for (const rule of item.rules ?? []) {
      for (const a of rule.actions ?? []) {
        const target = byId.get(a.target);
        if (!target || target.levelId !== levelId || always.has(target.id) || always.has(item.id)) continue;
        const there = cellOfItem(layout, set, target, global);
        if (!together(layout, here, there))
          out.push({ id: item.id, message: `${item.name} (in ${here.key}) acts on ${target.name} in ${there.key}, which may not be loaded then.`, export: `Mark ${target.name} Always loaded, widen the load range, or move one of them: ${here.key} and ${there.key} are farther apart than the ${layout.plan.range} m that stays loaded.` });
      }
    }
    const m = motionOf(set, item, global);
    if (m?.kind === 'patrol' && !always.has(item.id)) {
      const far = m.stops.map((s) => byId.get(s.itemId)).filter((s): s is LevelItem => !!s).find((s) => !together(layout, here, cellOfItem(layout, set, s, global)));
      if (far) out.push({ id: item.id, message: `${item.name}'s patrol reaches ${far.name} in ${cellOfItem(layout, set, far, global).key}, out of what is loaded round ${here.key}.`, export: 'An actor walking into an unloaded cell falls through it or stops. Keep the patrol within the load range, mark the actor Always loaded, or widen the range.' });
    }
  }
  if (level.budget) {
    const limits = limitsOf(level.budget);
    for (const w of layout.worst) {
      if (w.count <= limits[w.metric]) continue;
      const label = METRICS.find((m) => m.id === w.metric)!.label.toLowerCase();
      out.push({ id: level.id, message: `Round cell ${w.around} the loaded cells cost ${Math.round(w.count)} ${label}, over the budget of ${limits[w.metric]}.`, export: 'What is loaded at once has to fit the budget, wherever the player is. Make cells smaller, the load range shorter, or move some of it.' });
    }
  }
  return out;
};
