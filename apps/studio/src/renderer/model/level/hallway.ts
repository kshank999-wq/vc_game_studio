import type { Project } from '../types';
import { assetOf, contains, corners, frameOf, type Point } from './geometry';
import { levelsOf, placeAsset, withSet } from './level';
import type { AssetDefinition, LevelItem } from './types';

/**
 * Hallways drawn as a line (the Hallway tool): click along where it runs,
 * give it a width, and each straight run becomes a corridor space. Runs go
 * along the map's axes; where they turn, the earlier run takes the corner
 * and an opening joins them. Rooms can then be laid out round them (the
 * generator's "Around the hallways" rules).
 */

/** Hallway widths offered first: 4 ft and 8 ft (stored in metres). */
export const HALLWAY_WIDTHS: readonly { label: string; metres: number }[] = [
  { label: '4 ft', metres: 1.2192 },
  { label: '8 ft', metres: 2.4384 },
];

/** The next point straight on from the last: along whichever axis it moved further. */
export const squareUp = (from: Point, to: Point): Point => (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y });

/** The points squared up one after another, with repeats and points on a straight run dropped. */
export const squaredLine = (points: readonly Point[]): Point[] => {
  const out: Point[] = [];
  for (const p of points) {
    const q = out.length ? squareUp(out[out.length - 1]!, p) : { ...p };
    const last = out[out.length - 1];
    if (last && Math.hypot(q.x - last.x, q.y - last.y) < 1e-6) continue;
    const before = out[out.length - 2];
    // Straight on (the same axis, the same way): the run just gets longer.
    if (before && last) {
      const a = { x: Math.sign(last.x - before.x), y: Math.sign(last.y - before.y) };
      const b = { x: Math.sign(q.x - last.x), y: Math.sign(q.y - last.y) };
      if (a.x === b.x && a.y === b.y) {
        out[out.length - 1] = q;
        continue;
      }
    }
    out.push(q);
  }
  return out;
};

/** A run of hallway: its centre and size (w along x, d along y), in metres. */
export interface HallwayRun {
  x: number;
  y: number;
  w: number;
  d: number;
}

/**
 * The runs of a hallway this wide along the points (squared up first).
 * Each run takes the corner at its far end, so runs meet edge to edge;
 * `joints` are where one opens into the next.
 */
export const hallwayRuns = (points: readonly Point[], width: number): { runs: HallwayRun[]; joints: Point[] } => {
  const line = squaredLine(points);
  const half = width / 2;
  const runs: HallwayRun[] = [];
  const joints: Point[] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    // From just past the corner the run before took (or from its start), to past the next corner (or to its end).
    const s = i === 0 ? 0 : half;
    const e = i + 2 < line.length ? half : 0;
    const p0 = { x: a.x + dx * s, y: a.y + dy * s };
    const p1 = { x: b.x + dx * e, y: b.y + dy * e };
    const len = Math.abs(p1.x - p0.x) + Math.abs(p1.y - p0.y);
    if (len < 1e-6) continue;
    if (i > 0 && runs.length) joints.push(p0);
    runs.push({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2, w: dx ? len : width, d: dx ? width : len });
  }
  return { runs, joints };
};

/** Lay a hallway out on a floor: a corridor space per run, opened into one another. One undo step. */
export const addHallway = (project: Project, levelId: string, floorId: string, points: readonly Point[], width: number, global?: readonly AssetDefinition[], name = 'Hallway'): { project: Project; ids: string[] } => {
  const { runs, joints } = hallwayRuns(points, width);
  if (!runs.length || !(width > 0)) return { project, ids: [] };
  const floor = levelsOf(project).levels.find((l) => l.id === levelId)?.floors.find((f) => f.id === floorId);
  let next = project;
  const ids: string[] = [];
  const set = (id: string, patch: Partial<LevelItem>) => {
    const s = levelsOf(next);
    next = withSet(next, { ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  };
  runs.forEach((r, k) => {
    const placed = placeAsset(next, levelId, floorId, 'space.corridor', { x: r.x, y: r.y }, { global, name: runs.length > 1 ? `${name} ${k + 1}` : name });
    const id = placed.ids[0];
    if (!id) return;
    next = placed.project;
    const item = levelsOf(next).items.find((i) => i.id === id)!;
    // Exactly where it was drawn (not snapped to the grid: its edges are half its width off the line).
    set(id, { x: r.x, y: r.y, size: { ...item.size, w: r.w, d: r.d, ...(floor?.height ? { h: floor.height } : {}) } });
    ids.push(id);
  });
  // An end drawn up to the building's outside wall: a way in there.
  const line = squaredLine(points);
  const s0 = levelsOf(next);
  const footprints = s0.items.filter((i) => i.levelId === levelId && i.floorId === floorId && assetOf(s0, i, global).role === 'footprint').map((i) => frameOf(s0, i, global));
  const outerEnd = (end: Point, from: Point) => {
    const len = Math.hypot(end.x - from.x, end.y - from.y) || 1;
    const dir = { x: (end.x - from.x) / len, y: (end.y - from.y) / len };
    // Inside just short of it, outside just past it: it runs into the wall.
    return footprints.some((f) => contains(f, { x: end.x - dir.x * 0.3, y: end.y - dir.y * 0.3 }) && !contains(f, { x: end.x + dir.x * 0.3, y: end.y + dir.y * 0.3 }) && nearEdge(f, end));
  };
  const doorsOut: Point[] = [];
  if (line.length >= 2) {
    if (outerEnd(line[line.length - 1]!, line[line.length - 2]!)) doorsOut.push(line[line.length - 1]!);
    if (outerEnd(line[0]!, line[1]!)) doorsOut.push(line[0]!);
  }
  for (const at of doorsOut) {
    const placed = placeAsset(next, levelId, floorId, 'arch.door', at, { global, name: 'Way in' });
    const id = placed.ids[0];
    if (!id) continue;
    next = placed.project;
    set(id, { x: at.x, y: at.y });
    ids.push(id);
  }
  // Where runs meet: an opening as wide as the hallway allows.
  const wide = Math.max(0.9, Math.min(3, width - 0.4));
  for (const j of joints) {
    const placed = placeAsset(next, levelId, floorId, 'arch.door', j, { global, name: 'Opening' });
    const id = placed.ids[0];
    if (!id) continue;
    next = placed.project;
    const item = levelsOf(next).items.find((i) => i.id === id)!;
    set(id, { x: j.x, y: j.y, size: { ...item.size, w: wide }, params: { ...item.params, swing: 'open archway' } });
    ids.push(id);
  }
  return { project: next, ids };
};

/** Whether a point is on (within a few centimetres of) a frame's edge. */
const nearEdge = (f: ReturnType<typeof frameOf>, p: Point, within = 0.35): boolean => {
  const pts = f.outline ? f.outline.map((q) => ({ x: f.x + q.x, y: f.y + q.y })) : corners(f);
  return pts.some((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= within;
  });
};
