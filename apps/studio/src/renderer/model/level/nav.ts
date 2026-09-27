import { BODY, collidersFrom, type Collider } from './controller';
import { assetOf, boundsOf, contains, corners, frameOf, meshesFor, num, paramOf } from './geometry';
import type { AssetDefinition, LevelItem, LevelSet } from './types';

/**
 * Navigation preview (spec §5.1, §5.3): where the player can stand, and which
 * of it they can walk to from the player start. The level is sampled on a
 * grid; a cell's surfaces are the tops of what collides there (floors, steps,
 * platforms), and one is standable when the body fits above it. Neighbours
 * connect when the step between them is climbable (or a drop), and ladders,
 * elevators and traversal links join the floors they stand across. Doors and
 * state gates count as open: this is about the geometry, not the story.
 */

export interface NavCell {
  x: number;
  y: number;
  /** The standing surface's height. */
  z: number;
  reached: boolean;
}

export interface NavResult {
  cell: number;
  cells: NavCell[];
  /** Whether there was a player start to walk from. */
  start: boolean;
  /** Items the player is meant to reach that no reached cell comes near. */
  unreachable: string[];
}

/** Roles someone has to get to: things to pick up, use, talk to, walk into or through. */
const DESTINATIONS = new Set([
  'door', 'pickup', 'inventory', 'weapon', 'ammo', 'health', 'checkpoint', 'objective',
  'npc', 'companion', 'neutral', 'interaction', 'puzzle', 'trigger', 'cinematic', 'portal', 'destination', 'dialogue',
]);
const CLIMB = new Set(['ladder', 'elevator', 'traversal']);
/** How far a fall may be and still count as a way down. */
const DROP = 4;

const blocked = (colliders: readonly Collider[], x: number, y: number, feet: number): boolean => {
  const head = feet + BODY.height;
  for (const c of colliders) {
    if (c.top <= feet + BODY.stepUp || c.bottom >= head) continue;
    if (c.poly) {
      // Near enough to a slab to be inside or touching it.
      const r = BODY.radius * 0.8;
      if (c.poly.some((p, i) => {
        const q = c.poly![(i + 1) % c.poly!.length]!;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(x - (p.x + dx * t), y - (p.y + dy * t)) < r;
      })) return true;
      continue;
    }
    const cos = Math.cos(c.rot);
    const sin = Math.sin(c.rot);
    const lx = (x - c.x) * cos + (y - c.y) * sin;
    const ly = -(x - c.x) * sin + (y - c.y) * cos;
    const dx = Math.max(Math.abs(lx) - c.hw, 0);
    const dy = Math.max(Math.abs(ly) - c.hd, 0);
    if (Math.hypot(dx, dy) < BODY.radius * 0.8) return true;
  }
  return false;
};

const inside = (c: Collider, x: number, y: number): boolean => {
  if (c.poly) {
    let hit = false;
    for (let i = 0, j = c.poly.length - 1; i < c.poly.length; j = i++) {
      const a = c.poly[i]!;
      const b = c.poly[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  }
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const lx = (x - c.x) * cos + (y - c.y) * sin;
  const ly = -(x - c.x) * sin + (y - c.y) * cos;
  return Math.abs(lx) <= c.hw && Math.abs(ly) <= c.hd;
};

const cache = new WeakMap<LevelSet, Map<string, NavResult>>();

export const navigate = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): NavResult => {
  const memo = cache.get(set) ?? new Map<string, NavResult>();
  cache.set(set, memo);
  const known = memo.get(levelId);
  if (known) return known;

  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const role = (i: LevelItem) => assetOf(set, i, global).role;
  // Doors stand open and gates are out of the way.
  const meshes = meshesFor(set, levelId, { ceilings: true, global, open: () => true, skip: (i) => i.hidden === true || role(i) === 'gate' });
  const colliders = collidersFrom(meshes);
  const level = set.levels.find((l) => l.id === levelId);
  const elevation = new Map(level?.floors.map((f) => [f.id, f.elevation]) ?? []);
  const empty: NavResult = { cell: 0.5, cells: [], start: false, unreachable: [] };
  if (!colliders.length) {
    memo.set(levelId, empty);
    return empty;
  }
  const b = boundsOf(items.flatMap((i) => corners(frameOf(set, i, global))));
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  const cell = area / 0.25 > 40000 ? Math.ceil(Math.sqrt(area / 40000) * 2) / 2 : 0.5;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell));

  // Standable surfaces in each cell.
  const nodes: NavCell[] = [];
  const at = new Map<number, number[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.minX + (c + 0.5) * cell;
      const y = b.minY + (r + 0.5) * cell;
      // Floors, steps and solids are stood on; the tops of walls and ceilings aren't somewhere to go.
      const tops = [...new Set(colliders.filter((k) => k.part !== 'wall' && k.part !== 'ceiling' && inside(k, x, y)).map((k) => Math.round(k.top * 1000) / 1000))].sort((p, q) => p - q);
      const here: number[] = [];
      for (const z of tops) {
        if (blocked(colliders, x, y, z)) continue;
        here.push(nodes.length);
        nodes.push({ x, y, z, reached: false });
      }
      if (here.length) at.set(r * cols + c, here);
    }
  }
  const cellOf = (x: number, y: number) => {
    const c = Math.floor((x - b.minX) / cell);
    const r = Math.floor((y - b.minY) / cell);
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  };

  // Ladders, elevators and traversal links join every surface beside them, from their foot to their top.
  const climbOf = new Map<number, number[]>();
  for (const i of items.filter((x) => CLIMB.has(role(x)))) {
    const f = frameOf(set, i, global);
    const base = (elevation.get(i.floorId) ?? 0) + f.z;
    const near = { ...f, w: f.w + cell * 2.5, d: f.d + cell * 2.5 };
    const group = nodes.map((n, idx) => ({ n, idx })).filter(({ n }) => contains(near, n) && n.z >= base - 0.5 && n.z <= base + f.h + 0.5).map(({ idx }) => idx);
    for (const idx of group) climbOf.set(idx, [...(climbOf.get(idx) ?? []), ...group]);
  }

  const indexOf = new Map(nodes.map((n, i) => [n, i]));
  const start = items.find((i) => role(i) === 'playerStart');
  if (start) {
    const sf = frameOf(set, start, global);
    const feet = (elevation.get(start.floorId) ?? 0) + sf.z;
    const k = cellOf(sf.x, sf.y);
    const first = (at.get(k) ?? []).map((n) => nodes[n]!).sort((p, q) => Math.abs(p.z - feet) - Math.abs(q.z - feet))[0];
    if (first) {
      first.reached = true;
      const queue = [first];
      while (queue.length) {
        const n = queue.shift()!;
        const k0 = cellOf(n.x, n.y);
        const r0 = Math.floor(k0 / cols);
        const c0 = k0 % cols;
        const reach = (m: NavCell) => {
          if (m.reached) return;
          m.reached = true;
          queue.push(m);
        };
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
          const r = r0 + dr;
          const c = c0 + dc;
          if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
          for (const idx of at.get(r * cols + c) ?? []) {
            const m = nodes[idx]!;
            const rise = m.z - n.z;
            if (rise > BODY.stepUp || rise < -DROP) continue;
            // Nothing in the way halfway across, at the higher of the two.
            if (blocked(colliders, (n.x + m.x) / 2, (n.y + m.y) / 2, Math.max(n.z, m.z))) continue;
            reach(m);
          }
        }
        for (const idx of climbOf.get(indexOf.get(n)!) ?? []) reach(nodes[idx]!);
      }
    }
  }

  // What the player is meant to get to, and can't.
  const reached = nodes.filter((n) => n.reached);
  const unreachable = !start
    ? []
    : items
        .filter((i) => DESTINATIONS.has(role(i)) && paramOf(set, i, 'export', global) !== false)
        .filter((i) => {
          const f = frameOf(set, i, global);
          const base = (elevation.get(i.floorId) ?? 0) + (i.host ? 0 : f.z);
          const def = assetOf(set, i, global);
          if (def.kind === 'volume') return !reached.some((n) => contains(f, n) && n.z >= base - 0.5 && n.z <= base + f.h);
          const near = Math.max(f.w, f.d) / 2 + num(paramOf(set, i, 'range', global), 1.5) + cell;
          return !reached.some((n) => Math.hypot(n.x - f.x, n.y - f.y) <= near && Math.abs(n.z - base) <= Math.max(2, f.h));
        })
        .map((i) => i.id);
  const out = { cell, cells: nodes, start: !!start && reached.length > 0, unreachable };
  memo.set(levelId, out);
  return out;
};
