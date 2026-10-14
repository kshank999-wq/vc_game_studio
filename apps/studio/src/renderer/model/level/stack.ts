import { frameOf, type Mesh } from './geometry';
import { OUTSIDE, structureGraph, type StructureEdge } from './structure';
import type { AssetDefinition, Level, LevelSet } from './types';

/**
 * Stacked floors in 3D (structure spec §12): every floor; a cutaway that
 * shows the floors up to the one being worked on and takes its ceiling off,
 * so you look down into it; or the floors spread apart, each lifted clear of
 * the one below, to see a whole building from basement to roof at once.
 */
export type FloorStack = 'all' | 'cutaway' | 'exploded';

/** How far a floor is lifted in an exploded view: a gap above each floor below it, as tall as the tallest floor. */
export const floorLift = (level: Level | undefined, floorId: string, stack: FloorStack | undefined): number => {
  if (!level || stack !== 'exploded') return 0;
  const sorted = [...level.floors].sort((a, b) => a.elevation - b.elevation);
  const gap = Math.max(2, ...level.floors.map((f) => f.height));
  // The ground floor stays where it is; floors above go up, basements go down.
  const ground = Math.max(0, sorted.findIndex((f) => f.elevation >= -0.01));
  const at = sorted.findIndex((f) => f.id === floorId);
  return at < 0 ? 0 : (at - ground) * gap;
};

export const stackMeshes = (set: LevelSet, levelId: string, meshes: readonly Mesh[], floorId: string, stack: FloorStack | undefined): Mesh[] => {
  const level = set.levels.find((l) => l.id === levelId);
  if (!level || !stack || stack === 'all') return [...meshes];
  const floorOf = new Map(set.items.filter((i) => i.levelId === levelId).map((i) => [i.id, i.floorId]));
  const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
  const here = elevation.get(floorId) ?? 0;
  const out: Mesh[] = [];
  for (const m of meshes) {
    const f = floorOf.get(m.itemId) ?? floorId;
    if (stack === 'cutaway') {
      if ((elevation.get(f) ?? 0) > here + 0.01) continue;
      if (f === floorId && m.part === 'ceiling') continue;
      out.push(m);
    } else {
      const lift = floorLift(level, f, stack);
      out.push(lift ? { ...m, y: m.y + lift } : m);
    }
  }
  return out;
};

/** One connection of the structure graph as a line in 3D, room middle to room middle. */
export interface GraphLine {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  kind: StructureEdge['kind'];
  vertical: boolean;
  gated: boolean;
  oneWay: boolean;
  secret: boolean;
}

/** The structure graph drawn in the graybox (spec §12 navigation overlay): each way between rooms, at waist height on its floor. */
export const graphLines = (set: LevelSet, levelId: string, floorId: string, stack: FloorStack | 'one', global?: readonly AssetDefinition[]): GraphLine[] => {
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return [];
  const graph = structureGraph(set, levelId, global);
  const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
  const here = elevation.get(floorId) ?? 0;
  const shown = (fid: string) => (stack === 'one' ? fid === floorId : stack === 'cutaway' ? (elevation.get(fid) ?? 0) <= here + 0.01 : true);
  const node = new Map(graph.nodes.map((n) => [n.id, n]));
  const at = (id: string, via: string): [number, number, number] | null => {
    const n = node.get(id);
    if (n) return shown(n.floorId) ? [n.x, (elevation.get(n.floorId) ?? 0) + 1 + floorLift(level, n.floorId, stack === 'one' ? undefined : stack), n.y] : null;
    if (id !== OUTSIDE) return null;
    // The outside end: a little way out beyond the door or portal.
    const item = set.items.find((i) => i.id === via);
    if (!item || !shown(item.floorId)) return null;
    const f = frameOf(set, item, global);
    const rad = (f.rotation * Math.PI) / 180;
    const inside = graph.edges.find((e) => e.via === via);
    const room = inside && node.get(inside.from === OUTSIDE ? inside.to : inside.from);
    let nx = -Math.sin(rad);
    let ny = Math.cos(rad);
    if (room && (room.x - f.x) * nx + (room.y - f.y) * ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return [f.x + nx * 2.5, (elevation.get(item.floorId) ?? 0) + 1 + floorLift(level, item.floorId, stack === 'one' ? undefined : stack), f.y + ny * 2.5];
  };
  const out: GraphLine[] = [];
  for (const e of graph.edges) {
    const a = at(e.from, e.via);
    const b = at(e.to, e.via);
    if (!a || !b) continue;
    out.push({ id: e.id, from: a, to: b, kind: e.kind, vertical: e.vertical, gated: e.gated, oneWay: !!e.oneWay, secret: !!e.secret });
  }
  return out;
};
