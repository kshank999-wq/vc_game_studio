import { assetOf, boundsOf, corners, frameOf } from './geometry';
import type { AssetDefinition, LevelItem, LevelSet } from './types';

/**
 * Edges that pull together: rooms, hallways and buildings moved, resized or
 * drawn near another's edge snap flush against it (or line up with it), so
 * the two share a wall and a door can go through. The grid alone can't do
 * this: a room centred on the grid has its edges off it when its width isn't
 * a whole number of grid squares.
 */

/** An edge to snap to: a line at `at` (x for a vertical edge, y for a horizontal one), running from..to. */
export interface EdgeLine {
  at: number;
  from: number;
  to: number;
}

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** What snaps: spaces (rooms, hallways, footprints, zones) and solids (buildings, walls, blocks), square to the map. */
export const snapsByEdge = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): boolean => {
  if (item.host || item.outline) return false;
  const kind = assetOf(set, item, global).kind;
  return (kind === 'space' || kind === 'solid') && ((item.rotation % 90) + 90) % 90 === 0;
};

export const boxOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Box => boundsOf(corners(frameOf(set, item, global)));

/** The edges on a floor to snap to, leaving out what is moving. */
export const edgeLines = (set: LevelSet, levelId: string, floorId: string, exclude: readonly string[], global?: readonly AssetDefinition[]): { xs: EdgeLine[]; ys: EdgeLine[] } => {
  const out = { xs: [] as EdgeLine[], ys: [] as EdgeLine[] };
  const skip = new Set(exclude);
  for (const i of set.items) {
    if (i.levelId !== levelId || i.floorId !== floorId || i.hidden || skip.has(i.id) || !snapsByEdge(set, i, global)) continue;
    const b = boxOf(set, i, global);
    out.xs.push({ at: b.minX, from: b.minY, to: b.maxY }, { at: b.maxX, from: b.minY, to: b.maxY });
    out.ys.push({ at: b.minY, from: b.minX, to: b.maxX }, { at: b.maxY, from: b.minX, to: b.maxX });
  }
  return out;
};

/** The nearest line within `tol` of any of these values, alongside the span lo..hi: how far to move, and the line. */
const nearest = (values: readonly number[], lines: readonly EdgeLine[], lo: number, hi: number, tol: number): { by: number; line: EdgeLine } | null => {
  let best: { by: number; line: EdgeLine } | null = null;
  for (const line of lines) {
    // Beside it (or nearly): an edge far along the map is no use.
    if (line.to < lo - tol || line.from > hi + tol) continue;
    for (const v of values) {
      const by = line.at - v;
      if (Math.abs(by) <= tol && (!best || Math.abs(by) < Math.abs(best.by))) best = { by, line };
    }
  }
  return best;
};

/** A guide drawn while snapped: the edge snapped to, in plan. */
export interface Guide {
  vertical: boolean;
  at: number;
  from: number;
  to: number;
}

const guide = (vertical: boolean, line: EdgeLine, lo: number, hi: number): Guide => ({ vertical, at: line.at, from: Math.min(line.from, lo), to: Math.max(line.to, hi) });

/** A box moved: how much further to move it so an edge sits on a nearby edge, each way. */
export const snapBox = (box: Box, lines: { xs: EdgeLine[]; ys: EdgeLine[] }, tol: number): { dx: number; dy: number; hitX: boolean; hitY: boolean; guides: Guide[] } => {
  const x = nearest([box.minX, box.maxX], lines.xs, box.minY, box.maxY, tol);
  const y = nearest([box.minY, box.maxY], lines.ys, box.minX, box.maxX, tol);
  const dx = x?.by ?? 0;
  const dy = y?.by ?? 0;
  const guides: Guide[] = [];
  if (x) guides.push(guide(true, x.line, box.minY + dy, box.maxY + dy));
  if (y) guides.push(guide(false, y.line, box.minX + dx, box.maxX + dx));
  return { dx, dy, hitX: !!x, hitY: !!y, guides };
};

/** A box resized: its edges that moved, each pulled onto a nearby edge. */
export const snapEdges = (box: Box, moved: { minX?: boolean; maxX?: boolean; minY?: boolean; maxY?: boolean }, lines: { xs: EdgeLine[]; ys: EdgeLine[] }, tol: number): { box: Box; hit: Partial<Record<keyof Box, boolean>>; guides: Guide[] } => {
  const b = { ...box };
  const guides: Guide[] = [];
  const hit: Partial<Record<keyof Box, boolean>> = {};
  for (const k of ['minX', 'maxX'] as const) {
    if (!moved[k]) continue;
    const n = nearest([b[k]], lines.xs, b.minY, b.maxY, tol);
    if (n) {
      b[k] += n.by;
      hit[k] = true;
      guides.push(guide(true, n.line, b.minY, b.maxY));
    }
  }
  for (const k of ['minY', 'maxY'] as const) {
    if (!moved[k]) continue;
    const n = nearest([b[k]], lines.ys, b.minX, b.maxX, tol);
    if (n) {
      b[k] += n.by;
      hit[k] = true;
      guides.push(guide(false, n.line, b.minX, b.maxX));
    }
  }
  return { box: b, hit, guides };
};

/** The edges that caught on a neighbour from `snapped`, the rest from `otherwise` (the grid). */
export const mergeBox = (snapped: Box, hit: Partial<Record<keyof Box, boolean>>, otherwise: Box): Box => ({
  minX: hit.minX ? snapped.minX : otherwise.minX,
  maxX: hit.maxX ? snapped.maxX : otherwise.maxX,
  minY: hit.minY ? snapped.minY : otherwise.minY,
  maxY: hit.maxY ? snapped.maxY : otherwise.maxY,
});
