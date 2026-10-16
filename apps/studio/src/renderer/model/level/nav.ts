import { BODY, collidersFrom, CROUCH, type Collider } from './controller';
import { assetOf, boundsOf, contains, corners, frameOf, meshesFor, num, paramOf, toLocal } from './geometry';
import type { AssetDefinition, LevelItem, LevelSet } from './types';

/**
 * Navigation (spec §5.1, §5.3, §19 navmesh): where someone can stand, which of
 * it the player can walk to from the player start, and the way between two
 * places. The level is sampled on a grid; a cell's surfaces are the tops of
 * what collides there (floors, steps, platforms), and one is standable when
 * the body fits above it. Neighbours connect when the step between them is
 * climbable (or a drop), and ladders, elevators and traversal links join the
 * floors they stand across. Doors and state gates count as open: this is about
 * the geometry, not the story (characters open doors as they go).
 *
 * The cells and their links are the navigation graph: `findPath` walks it with
 * A* and then pulls the path straight wherever the ground between two points
 * of it is clear, so characters walk round walls by the short way. The engines
 * get the same graph in the handoff and walk it the same way.
 */

export interface NavCell {
  x: number;
  y: number;
  /** The standing surface's height. */
  z: number;
  reached: boolean;
  /** For people (nav areas): Infinity where No walk keeps them off, a Cost area's cost; absent on ordinary ground. */
  cost?: number;
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
  // A body that can crouch gets through anything as tall as a crouching one.
  const head = feet + CROUCH.height;
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

/** The navigation graph: standable cells on a grid, and which reach which. */
export interface NavGraph {
  /** Cell size (metres) and the grid's corner and size, in level space. */
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  nodes: { x: number; y: number; z: number }[];
  /** For each node, the nodes one step away (a neighbour, or across a ladder). */
  links: number[][];
  /** Grid cell (row * cols + col) to the nodes standing in it. */
  at: Map<number, number[]>;
  /** What a metre on each node counts for (1 is ordinary ground; a Cost nav area's cost); absent when it is all ordinary. */
  costs?: number[];
}

interface Built {
  graph: NavGraph;
  items: LevelItem[];
  role: (i: LevelItem) => string;
  elevation: Map<string, number>;
}

const graphs = new WeakMap<LevelSet, Map<string, Built | null>>();

const build = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): Built | null => {
  const memo = graphs.get(set) ?? new Map<string, Built | null>();
  graphs.set(set, memo);
  if (memo.has(levelId)) return memo.get(levelId)!;

  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const role = (i: LevelItem) => assetOf(set, i, global).role;
  // Doors stand open and gates are out of the way.
  const meshes = meshesFor(set, levelId, { ceilings: true, global, open: () => true, skip: (i) => i.hidden === true || role(i) === 'gate' });
  const colliders = collidersFrom(meshes);
  const level = set.levels.find((l) => l.id === levelId);
  const elevation = new Map(level?.floors.map((f) => [f.id, f.elevation]) ?? []);
  if (!colliders.length) {
    memo.set(levelId, null);
    return null;
  }
  const b = boundsOf(items.flatMap((i) => corners(frameOf(set, i, global))));
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  const cell = area / 0.25 > 40000 ? Math.ceil(Math.sqrt(area / 40000) * 2) / 2 : 0.5;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell));

  // The colliders by grid cell (each in every cell its footprint, plus a body's width, overlaps), so a cell asks only those near it.
  const buckets = new Map<number, Collider[]>();
  const pad = BODY.radius;
  for (const k of colliders) {
    const xs = k.poly ? k.poly.map((p) => p.x) : [k.x - Math.hypot(k.hw, k.hd), k.x + Math.hypot(k.hw, k.hd)];
    const ys = k.poly ? k.poly.map((p) => p.y) : [k.y - Math.hypot(k.hw, k.hd), k.y + Math.hypot(k.hw, k.hd)];
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - pad - b.minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(...xs) + pad - b.minX) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - pad - b.minY) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(...ys) + pad - b.minY) / cell));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (buckets.get(r * cols + c) ?? buckets.set(r * cols + c, []).get(r * cols + c)!).push(k);
  }
  const nearby = (x: number, y: number): Collider[] => {
    const c = Math.floor((x - b.minX) / cell);
    const r = Math.floor((y - b.minY) / cell);
    return c < 0 || r < 0 || c >= cols || r >= rows ? colliders : buckets.get(r * cols + c) ?? [];
  };

  // Standable surfaces in each cell.
  const nodes: { x: number; y: number; z: number }[] = [];
  const at = new Map<number, number[]>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = b.minX + (c + 0.5) * cell;
      const y = b.minY + (r + 0.5) * cell;
      // Floors, steps and solids are stood on; the tops of walls and ceilings aren't somewhere to go.
      const around = nearby(x, y);
      const tops = [...new Set(around.filter((k) => k.part !== 'wall' && k.part !== 'ceiling' && inside(k, x, y)).map((k) => Math.round(k.top * 1000) / 1000))].sort((p, q) => p - q);
      const here: number[] = [];
      for (const z of tops) {
        if (blocked(around, x, y, z)) continue;
        here.push(nodes.length);
        nodes.push({ x, y, z });
      }
      if (here.length) at.set(r * cols + c, here);
    }
  }

  // Each node to the nodes beside it it can step to (or drop to), with nothing in the way halfway across.
  const linked: Set<number>[] = nodes.map(() => new Set<number>());
  for (const [k0, here] of at) {
    const r0 = Math.floor(k0 / cols);
    const c0 = k0 % cols;
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      const r = r0 + dr;
      const c = c0 + dc;
      if (r >= rows || c >= cols) continue;
      for (const ia of here) {
        for (const ib of at.get(r * cols + c) ?? []) {
          const n = nodes[ia]!;
          const m = nodes[ib]!;
          const rise = m.z - n.z;
          if (Math.abs(rise) > DROP) continue;
          const mx = (n.x + m.x) / 2;
          const my = (n.y + m.y) / 2;
          if (blocked(nearby(mx, my), mx, my, Math.max(n.z, m.z))) continue;
          // Up a step either way, or down a drop (one way: you can't climb back up it).
          if (rise <= BODY.stepUp) linked[ia]!.add(ib);
          if (-rise <= BODY.stepUp) linked[ib]!.add(ia);
        }
      }
    }
  }
  // Ladders, elevators and traversal links join every surface beside them, from their foot to their top.
  const near = (f: ReturnType<typeof frameOf>, n: { x: number; y: number }) => contains({ ...f, w: f.w + cell * 2.5, d: f.d + cell * 2.5 }, n);
  for (const i of items.filter((x) => CLIMB.has(role(x)))) {
    const f = frameOf(set, i, global);
    const base = (elevation.get(i.floorId) ?? 0) + f.z;
    const group = nodes.map((n, idx) => ({ n, idx })).filter(({ n }) => near(f, n) && n.z >= base - 0.5 && n.z <= base + f.h + 0.5).map(({ idx }) => idx);
    for (const a of group) for (const c of group) if (a !== c) linked[a]!.add(c);
  }
  // Nav links (navmesh authoring) join the ground at their back end to the ground at their front: forward only, or both ways.
  for (const i of items.filter((x) => role(x) === 'navLink')) {
    const f = frameOf(set, i, global);
    const base = (elevation.get(i.floorId) ?? 0) + f.z;
    const end = (side: 1 | -1) =>
      nodes.flatMap((n, idx) => {
        if (n.z < base - 0.5 || n.z > base + f.h + 0.5) return [];
        // Its front is the way it faces (north, -y, unturned).
        const l = toLocal(f, n);
        return Math.abs(l.x) <= f.w / 2 + cell && Math.abs(l.y - (side * f.d) / 2) <= cell * 1.25 ? [idx] : [];
      });
    const back = end(1);
    const front = end(-1);
    const both = String(paramOf(set, i, 'way', global) ?? 'forward only') === 'both ways';
    for (const a of back)
      for (const c of front) {
        if (a === c) continue;
        linked[a]!.add(c);
        if (both) linked[c]!.add(a);
      }
  }
  const links = linked.map((l) => [...l]);
  const out: Built = { graph: { cell, minX: b.minX, minY: b.minY, cols, rows, nodes, links, at }, items, role, elevation };
  memo.set(levelId, out);
  return out;
};

const forPeople = new WeakMap<Built, NavGraph>();
const areaCosts = new WeakMap<Built, number[] | null>();

/** What each of the level's nodes costs people (Infinity: a No walk area's), or null with no nav areas. */
const costsOf = (b: Built, set: LevelSet, global?: readonly AssetDefinition[]): number[] | null => {
  if (areaCosts.has(b)) return areaCosts.get(b)!;
  const areas = b.items
    .filter((i) => b.role(i) === 'navArea')
    .map((i) => {
      const f = frameOf(set, i, global);
      const base = (b.elevation.get(i.floorId) ?? 0) + f.z;
      const block = String(paramOf(set, i, 'area', global) ?? 'no walk') !== 'cost';
      return { f, base, top: base + f.h, cost: block ? Infinity : Math.max(1, num(paramOf(set, i, 'cost', global), 3)) };
    });
  // The highest where they overlap: No walk wins.
  const out = areas.length ? b.graph.nodes.map((n) => Math.max(1, ...areas.filter((a) => n.z >= a.base - 0.5 && n.z <= a.top && contains(a.f, n)).map((a) => a.cost))) : null;
  areaCosts.set(b, out);
  return out;
};

/**
 * The graph people walk (spec §19 navmesh authoring): the level's, less the
 * ground inside No walk nav areas, with a Cost area's cost on the ground in
 * it (the highest where they overlap). The player's own reach (`navigate`)
 * is the level's: nav areas are for the people the game moves.
 */
const peopleGraph = (b: Built, set: LevelSet, global?: readonly AssetDefinition[]): NavGraph => {
  const known = forPeople.get(b);
  if (known) return known;
  const all = costsOf(b, set, global);
  let out = b.graph;
  if (all) {
    const g = b.graph;
    const index: number[] = [];
    const nodes: NavGraph['nodes'] = [];
    const costs: number[] = [];
    g.nodes.forEach((n, i) => {
      if (all[i] === Infinity) {
        index.push(-1);
        return;
      }
      index.push(nodes.length);
      nodes.push(n);
      costs.push(all[i]!);
    });
    const links = g.links.flatMap((l, i) => (index[i]! < 0 ? [] : [l.map((m) => index[m]!).filter((m) => m >= 0)]));
    const at = new Map<number, number[]>();
    for (const [k, list] of g.at) {
      const kept = list.map((i) => index[i]!).filter((i) => i >= 0);
      if (kept.length) at.set(k, kept);
    }
    out = { ...g, nodes, links, at, ...(costs.some((c) => c !== 1) ? { costs } : {}) };
  }
  forPeople.set(b, out);
  return out;
};

/** The graph a level's people walk (cached per level set), or null when it has nothing to stand on. */
export const navGraph = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): NavGraph | null => {
  const b = build(set, levelId, global);
  return b ? peopleGraph(b, set, global) : null;
};

const costOf = (g: NavGraph, i: number) => g.costs?.[i] ?? 1;

const cellOf = (g: NavGraph, x: number, y: number) => {
  const c = Math.floor((x - g.minX) / g.cell);
  const r = Math.floor((y - g.minY) / g.cell);
  return c < 0 || r < 0 || c >= g.cols || r >= g.rows ? -1 : r * g.cols + c;
};

/** The node nearest a point: in its cell (the closest height), else the nearest in a few cells round it. */
export const nearestNode = (g: NavGraph, p: { x: number; y: number; z: number }, reach = 4): number => {
  const c0 = Math.floor((p.x - g.minX) / g.cell);
  const r0 = Math.floor((p.y - g.minY) / g.cell);
  let best = -1;
  let score = Infinity;
  for (let ring = 0; ring <= reach && best < 0; ring++) {
    for (let r = r0 - ring; r <= r0 + ring; r++) {
      for (let c = c0 - ring; c <= c0 + ring; c++) {
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring || r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue;
        for (const i of g.at.get(r * g.cols + c) ?? []) {
          const n = g.nodes[i]!;
          // Height matters more than the plan: the floor you're on, not the one above.
          const s = Math.hypot(n.x - p.x, n.y - p.y) + Math.abs(n.z - p.z) * 3;
          if (s < score) {
            score = s;
            best = i;
          }
        }
      }
    }
  }
  return best;
};

/**
 * Whether someone can walk straight from a to b over the graph: every sample
 * along the line stands on a node near the height expected there, and each
 * node the line passes leads to the next.
 */
export const clearLine = (g: NavGraph, a: number, b: number): boolean => {
  const p = g.nodes[a]!;
  const q = g.nodes[b]!;
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  const steps = Math.max(1, Math.ceil(d / (g.cell * 0.5)));
  let prev = a;
  // Not straight across ground dearer than either end: round a Cost area, or through it by the way A* chose.
  const cap = Math.max(costOf(g, a), costOf(g, b)) + 1e-9;
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = p.x + (q.x - p.x) * t;
    const y = p.y + (q.y - p.y) * t;
    const z = (g.nodes[prev]!.z);
    const here = g.at.get(cellOf(g, x, y)) ?? [];
    const next = s === steps ? b : here.find((i) => Math.abs(g.nodes[i]!.z - z) <= BODY.stepUp + 1e-6);
    if (next === undefined || costOf(g, next) > cap) return false;
    if (next === prev) continue;
    // Straight on, or round a corner through a cell both sides of it reach.
    if (!g.links[prev]!.includes(next) && !g.links[prev]!.some((m) => g.links[m]!.includes(next))) return false;
    prev = next;
  }
  return true;
};

/**
 * The way from one place to another over the navigation graph: the points to
 * walk through, ending at the goal (or the ground nearest it), or null when
 * there is no way there. A* over the cells, then pulled straight wherever the
 * line between two points of it is clear.
 */
export const findPath = (g: NavGraph, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { x: number; y: number; z: number }[] | null => {
  const start = nearestNode(g, from);
  const goal = nearestNode(g, to);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [to];
  const h = (i: number) => {
    const n = g.nodes[i]!;
    const m = g.nodes[goal]!;
    return Math.hypot(n.x - m.x, n.y - m.y) + Math.abs(n.z - m.z);
  };
  const cost = new Map<number, number>([[start, 0]]);
  const came = new Map<number, number>();
  // A small binary heap of [f, node].
  const heap: [number, number][] = [[h(start), start]];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up]![0] <= heap[i]![0]) break;
      [heap[up], heap[i]] = [heap[i]!, heap[up]!];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const done = new Set<number>();
  while (heap.length) {
    const [, n] = pop();
    if (n === goal) break;
    if (done.has(n)) continue;
    done.add(n);
    const here = g.nodes[n]!;
    for (const m of g.links[n]!) {
      const there = g.nodes[m]!;
      // A step counts its length at the cost of the ground either side (never under 1, so the straight-line guess stays a guess from below).
      const c = cost.get(n)! + (Math.hypot(there.x - here.x, there.y - here.y) + Math.abs(there.z - here.z)) * ((costOf(g, n) + costOf(g, m)) / 2);
      if (c < (cost.get(m) ?? Infinity)) {
        cost.set(m, c);
        came.set(m, n);
        push([c + h(m), m]);
      }
    }
  }
  if (!came.has(goal)) return null;
  const chain = [goal];
  while (chain[0] !== start) chain.unshift(came.get(chain[0]!)!);
  // Pull it straight: from each point, go to the farthest point of the chain it can see.
  const corners: number[] = [];
  let i = 0;
  while (i < chain.length - 1) {
    let j = chain.length - 1;
    while (j > i + 1 && !clearLine(g, chain[i]!, chain[j]!)) j--;
    corners.push(chain[j]!);
    i = j;
  }
  const out = corners.map((k) => ({ ...g.nodes[k]! }));
  // End at the goal itself when it is near its node (the node is the cell's middle).
  const last = g.nodes[goal]!;
  if (Math.hypot(to.x - last.x, to.y - last.y) <= g.cell && Math.abs(to.z - last.z) <= BODY.stepUp + 0.1) out[out.length - 1] = { ...to };
  return out;
};

const reaches = new WeakMap<NavGraph, Map<number, Uint8Array>>();

/** The nodes one standing at a point can walk to (by the links, so down a drop but not back up it); null when it stands on none. */
export const reachableFrom = (g: NavGraph, p: { x: number; y: number; z: number }): Uint8Array | null => {
  const first = nearestNode(g, p, 2);
  if (first < 0) return null;
  const memo = reaches.get(g) ?? new Map<number, Uint8Array>();
  reaches.set(g, memo);
  const known = memo.get(first);
  if (known) return known;
  const seen = new Uint8Array(g.nodes.length);
  seen[first] = 1;
  const queue = [first];
  for (let q = 0; q < queue.length; q++) {
    for (const m of g.links[queue[q]!]!) {
      if (seen[m]) continue;
      seen[m] = 1;
      queue.push(m);
    }
  }
  memo.set(first, seen);
  return seen;
};

/** A way being walked: the points still ahead, where it was planned to, and whether there is no way there at all. */
export interface Way {
  route: { x: number; y: number; z: number }[];
  aim: { x: number; y: number; z: number };
  none?: boolean;
}

/** A way is planned again once its target has moved this far from where it was planned to. */
export const REPLAN = 1;

/**
 * The next point to head for on the way from `from` to `to`, and the way kept
 * for the next step: planned when there is none (or the target moved), its
 * points dropped as they are reached. Null: there is no way there.
 */
export const nextOnWay = (g: NavGraph, way: Way | undefined, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): { way: Way; next: { x: number; y: number; z: number } | null } => {
  let w = way;
  if (!w || Math.hypot(w.aim.x - to.x, w.aim.y - to.y) > REPLAN || Math.abs(w.aim.z - to.z) > 1) {
    const path = findPath(g, from, to);
    w = path ? { route: path, aim: { ...to } } : { route: [], aim: { ...to }, none: true };
  }
  if (w.none) return { way: w, next: null };
  let route = w.route;
  while (route.length > 1 && Math.hypot(route[0]!.x - from.x, route[0]!.y - from.y) < 0.05) route = route.slice(1);
  if (route !== w.route) w = { ...w, route };
  // The last point of the way is where it was planned to; the target itself is near it.
  return { way: w, next: route.length > 1 ? route[0]! : to };
};

/**
 * The way people would walk from one point to another on a floor at a
 * height (the map's Path tool): its points from a, and its length; none when
 * there is no way; null when the level has nothing to walk on.
 */
export const pathBetween = (set: LevelSet, levelId: string, z: number, a: { x: number; y: number }, b: { x: number; y: number }, global?: readonly AssetDefinition[]): { points: { x: number; y: number; z: number }[]; length: number; none: boolean } | null => {
  const g = navGraph(set, levelId, global);
  if (!g) return null;
  const from = { ...a, z };
  const path = findPath(g, from, { ...b, z });
  if (!path) return { points: [from], length: 0, none: true };
  const points = [from, ...path];
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y, points[i]!.z - points[i - 1]!.z);
  return { points, length, none: false };
};

const cache = new WeakMap<LevelSet, Map<string, NavResult>>();

export const navigate = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): NavResult => {
  const memo = cache.get(set) ?? new Map<string, NavResult>();
  cache.set(set, memo);
  const known = memo.get(levelId);
  if (known) return known;
  const built = build(set, levelId, global);
  if (!built) {
    const empty: NavResult = { cell: 0.5, cells: [], start: false, unreachable: [] };
    memo.set(levelId, empty);
    return empty;
  }
  const { graph: g, items, role, elevation } = built;
  const costs = costsOf(built, set, global);
  const nodes: NavCell[] = g.nodes.map((n, i) => ({ ...n, reached: false, ...(costs && costs[i] !== 1 ? { cost: costs[i] } : {}) }));
  const start = items.find((i) => role(i) === 'playerStart');
  if (start) {
    const sf = frameOf(set, start, global);
    const feet = (elevation.get(start.floorId) ?? 0) + sf.z;
    const first = [...(g.at.get(cellOf(g, sf.x, sf.y)) ?? [])].sort((p, q) => Math.abs(g.nodes[p]!.z - feet) - Math.abs(g.nodes[q]!.z - feet))[0];
    if (first !== undefined) {
      nodes[first]!.reached = true;
      const queue = [first];
      while (queue.length) {
        const n = queue.shift()!;
        for (const m of g.links[n]!) {
          if (nodes[m]!.reached) continue;
          nodes[m]!.reached = true;
          queue.push(m);
        }
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
          const near = Math.max(f.w, f.d) / 2 + num(paramOf(set, i, 'range', global), 1.5) + g.cell;
          return !reached.some((n) => Math.hypot(n.x - f.x, n.y - f.y) <= near && Math.abs(n.z - base) <= Math.max(2, f.h));
        })
        .map((i) => i.id);
  const out = { cell: g.cell, cells: nodes, start: !!start && reached.length > 0, unreachable };
  memo.set(levelId, out);
  return out;
};
