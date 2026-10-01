import { findAsset, MISSING_ASSET } from './library';
import type { AssetDefinition, HostRef, LevelItem, LevelSet, OutlinePoint, ParamValue, Size } from './types';

/**
 * Where things are and what shape they take, worked out from the model every
 * time (spec §5.2): the 2D map and the 3D graybox both draw from here, so
 * they can never disagree. Nothing in this file changes the project.
 */

export interface Point {
  x: number;
  y: number;
}

/** An item as placed: its centre on the plan, height above its floor, facing, and size. */
export interface Frame extends Point {
  z: number;
  rotation: number;
  w: number;
  d: number;
  h: number;
  /** A freeform space's corners in its own frame, in metres, clockwise seen from above. */
  outline?: Point[];
}

// ---------------------------------------------------------------- definitions, sizes and parameters

export const assetOf = (set: LevelSet, item: LevelItem, global: readonly AssetDefinition[] = []): AssetDefinition =>
  findAsset(item.assetId, set.assets, global) ?? MISSING_ASSET;

export const sizeOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Size => ({ ...assetOf(set, item, global).size, ...item.size });

export const paramOf = (set: LevelSet, item: LevelItem, key: string, global?: readonly AssetDefinition[]): ParamValue | undefined =>
  item.params && key in item.params ? item.params[key] : assetOf(set, item, global).params.find((p) => p.key === key)?.default;

export const num = (v: ParamValue | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const bool = (v: ParamValue | undefined, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

// ---------------------------------------------------------------- polygons

/**
 * Twice the signed area. Positive when the corners run clockwise seen from
 * above (x east, y south): the order outlines are kept in.
 */
export const signedArea = (points: readonly Point[]): number => {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
};

export const polygonArea = (points: readonly Point[]): number => Math.abs(signedArea(points)) / 2;

export const perimeterOf = (points: readonly Point[]): number => points.reduce((sum, p, i) => sum + Math.hypot(points[(i + 1) % points.length]!.x - p.x, points[(i + 1) % points.length]!.y - p.y), 0);

export const pointInPolygon = (p: Point, points: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do two segments meet (touching counts)? */
const segmentsMeet = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p: Point, q: Point, r: Point) => Math.abs(cross(p, q, r)) < 1e-9 && Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
  return on(c, d, a) || on(c, d, b) || on(a, b, c) || on(a, b, d);
};

/** An outline whose edges cross each other (or fold back) can't be walled. */
export const selfIntersects = (points: readonly Point[]): boolean => {
  const n = points.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      const c = points[j]!;
      const d = points[(j + 1) % n]!;
      if (!adjacent) {
        if (segmentsMeet(a, b, c, d)) return true;
      } else {
        // Neighbours share a corner; they only clash by doubling back along each other.
        const [p, q, r] = j === i + 1 ? [a, b, d] : [c, a, b];
        if (Math.abs(cross(p, q, r)) < 1e-9 && (r.x - q.x) * (p.x - q.x) + (r.y - q.y) * (p.y - q.y) > 0) return true;
      }
    }
  }
  return false;
};

/**
 * The same corners, clockwise seen from above, without repeats. A corner in
 * the middle of a straight wall stays: it was just added, to be dragged.
 */
export const tidyOutline = <P extends Point>(points: readonly P[]): P[] => {
  const out = points.filter((p, i) => {
    const q = points[(i + 1) % points.length]!;
    return Math.hypot(q.x - p.x, q.y - p.y) > 1e-6;
  });
  return signedArea(out) < 0 ? out.reverse() : out;
};

/**
 * Triangles covering a clockwise outline, as index triples into it, each
 * clockwise seen from above (ear clipping).
 */
export const triangulate = (points: readonly Point[]): number[] => {
  const left = points.map((_, i) => i);
  const out: number[] = [];
  const inTriangle = (p: Point, a: Point, b: Point, c: Point) => cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12;
  let guard = 0;
  while (left.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < left.length; k++) {
      const ia = left[(k - 1 + left.length) % left.length]!;
      const ib = left[k]!;
      const ic = left[(k + 1) % left.length]!;
      const a = points[ia]!;
      const b = points[ib]!;
      const c = points[ic]!;
      if (cross(a, b, c) <= 1e-12) continue;
      if (left.some((j) => j !== ia && j !== ib && j !== ic && inTriangle(points[j]!, a, b, c))) continue;
      out.push(ia, ib, ic);
      left.splice(k, 1);
      clipped = true;
      break;
    }
    // Nothing left to clip cleanly (a degenerate outline): fan the rest.
    if (!clipped) break;
  }
  for (let k = 1; k + 1 < left.length; k++) out.push(left[0]!, left[k]!, left[k + 1]!);
  return out;
};

/** An outline pushed outward by a distance (mitred corners, kept short at sharp ones). */
export const offsetOutline = (points: readonly Point[], by: number): Point[] =>
  points.map((p, i) => {
    const a = points[(i - 1 + points.length) % points.length]!;
    const b = points[(i + 1) % points.length]!;
    const n = (u: Point, v: Point) => {
      const len = Math.hypot(v.x - u.x, v.y - u.y) || 1;
      return { x: (v.y - u.y) / len, y: -(v.x - u.x) / len };
    };
    const n1 = n(a, p);
    const n2 = n(p, b);
    const k = Math.min(3, 1 / Math.max(1e-3, (1 + n1.x * n2.x + n1.y * n2.y) / 2));
    return { x: p.x + ((n1.x + n2.x) / 2) * by * k, y: p.y + ((n1.y + n2.y) / 2) * by * k };
  });

const distanceToBoundary = (p: Point, points: readonly Point[]): number =>
  Math.min(...points.map((a, i) => distanceToSegment(p, a, points[(i + 1) % points.length]!).d));

/** Do two plan outlines overlap by more than a sliver? Shared and touching walls don't count. */
export const polygonsOverlap = (a: readonly Point[], b: readonly Point[], tolerance = 0.05): boolean => {
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const r = b[j]!;
      const s = b[(j + 1) % b.length]!;
      const side = (o: Point, u: Point, v: Point) => cross(o, u, v) / (Math.hypot(u.x - o.x, u.y - o.y) || 1);
      const d1 = side(r, s, p);
      const d2 = side(r, s, q);
      const d3 = side(p, q, r);
      const d4 = side(p, q, s);
      if (Math.abs(d1) > tolerance && Math.abs(d2) > tolerance && Math.abs(d3) > tolerance && Math.abs(d4) > tolerance && d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  const deepIn = (p: Point, poly: readonly Point[]) => pointInPolygon(p, poly) && distanceToBoundary(p, poly) > tolerance;
  const inner = (poly: readonly Point[]) => {
    const t = triangulate(poly);
    const [i, j, k] = [t[0] ?? 0, t[1] ?? 0, t[2] ?? 0];
    return { x: (poly[i]!.x + poly[j]!.x + poly[k]!.x) / 3, y: (poly[i]!.y + poly[j]!.y + poly[k]!.y) / 3 };
  };
  return a.some((p) => deepIn(p, b)) || b.some((p) => deepIn(p, a)) || deepIn(inner(a), b) || deepIn(inner(b), a);
};

// ---------------------------------------------------------------- plan maths

const rad = (deg: number) => (deg * Math.PI) / 180;

/** A point in an item's own frame (x along its width, y along its depth) on the plan. */
export const toPlan = (f: Frame, lx: number, ly: number): Point => {
  const c = Math.cos(rad(f.rotation));
  const s = Math.sin(rad(f.rotation));
  return { x: f.x + lx * c - ly * s, y: f.y + lx * s + ly * c };
};

/** A plan point in an item's own frame. */
export const toLocal = (f: Frame, p: Point): Point => {
  const c = Math.cos(rad(f.rotation));
  const s = Math.sin(rad(f.rotation));
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
};

export const corners = (f: Frame): Point[] => f.outline ? f.outline.map((p) => toPlan(f, p.x, p.y)) : [
  toPlan(f, -f.w / 2, -f.d / 2),
  toPlan(f, f.w / 2, -f.d / 2),
  toPlan(f, f.w / 2, f.d / 2),
  toPlan(f, -f.w / 2, f.d / 2),
];

export const contains = (f: Frame, p: Point): boolean => {
  const l = toLocal(f, p);
  if (f.outline) return pointInPolygon(l, f.outline) || distanceToBoundary(l, f.outline) <= 1e-6;
  return Math.abs(l.x) <= f.w / 2 + 1e-6 && Math.abs(l.y) <= f.d / 2 + 1e-6;
};

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const boundsOf = (points: Point[]): Bounds =>
  points.reduce(
    (b, p) => ({ minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

/** A space's floor area. */
export const areaOf = (f: Frame): number => (f.outline ? polygonArea(f.outline) : f.w * f.d);

/** Do two outlines overlap by more than a sliver? (Separating axes for rectangles.) */
export const overlaps = (a: Frame, b: Frame, tolerance = 0.05): boolean => {
  if (a.outline || b.outline) return polygonsOverlap(corners(a), corners(b), tolerance);
  const ca = corners(a);
  const cb = corners(b);
  for (const f of [a, b]) {
    for (const angle of [f.rotation, f.rotation + 90]) {
      const ax = Math.cos(rad(angle));
      const ay = Math.sin(rad(angle));
      const pa = ca.map((p) => p.x * ax + p.y * ay);
      const pb = cb.map((p) => p.x * ax + p.y * ay);
      if (Math.max(...pa) - tolerance <= Math.min(...pb) || Math.max(...pb) - tolerance <= Math.min(...pa)) return false;
    }
  }
  return true;
};

// ---------------------------------------------------------------- walls and hosted items

/**
 * One wall of a space: from `a` to `b` on the plan. A rectangle's are 0 north,
 * 1 east, 2 south, 3 west; an outline's wall n runs from corner n to the next.
 */
export interface Wall {
  index: number;
  a: Point;
  b: Point;
  length: number;
}

/** A space's four wall centre lines. North and south run west to east; east and west run north to south. */
export const wallsOf = (f: Frame): Wall[] => {
  if (f.outline) {
    const c = corners(f);
    return c.map((a, index) => {
      const b = c[(index + 1) % c.length]!;
      return { index, a, b, length: Math.hypot(b.x - a.x, b.y - a.y) };
    });
  }
  const [nw, ne, se, sw] = corners(f) as [Point, Point, Point, Point];
  return [
    { index: 0, a: nw, b: ne, length: f.w },
    { index: 1, a: ne, b: se, length: f.d },
    { index: 2, a: sw, b: se, length: f.w },
    { index: 3, a: nw, b: sw, length: f.d },
  ];
};

/** Spaces and volumes can be drawn freeform. */
export const OUTLINED_KINDS: ReadonlySet<string> = new Set(['space', 'volume']);

/** A space's or volume's outline, when it has one: its own, or its definition's. */
export const outlineOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): OutlinePoint[] | undefined => {
  const def = assetOf(set, item, global);
  if (!OUTLINED_KINDS.has(def.kind)) return undefined;
  const o = item.outline ?? def.outline;
  return o && o.length >= 3 ? o : undefined;
};

const plainFrame = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Frame => {
  const size = sizeOf(set, item, global);
  const outline = outlineOf(set, item, global);
  return { x: item.x, y: item.y, z: item.z, rotation: item.rotation, ...size, ...(outline ? { outline: outline.map((p) => ({ x: p.x * size.w, y: p.y * size.d })) } : {}) };
};

const hostFrame = plainFrame;

/** Where an item is. A door or window is wherever its wall says, so it follows the room when the room moves or changes size. */
export const frameOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Frame => {
  const host = item.host && set.items.find((i) => i.id === item.host!.id);
  if (!item.host || !host) return plainFrame(set, item, global);
  const size = sizeOf(set, item, global);
  const hf = hostFrame(set, host, global);
  const wall = wallsOf(hf)[item.host.wall];
  if (!wall) return plainFrame(set, item, global);
  const t = Math.min(1, Math.max(0, item.host.along));
  const at = { x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t };
  const thickness = num(paramOf(set, host, 'wallThickness', global), 0.2);
  // An outline's wall turns the opening with it.
  const rotation = hf.outline ? (((Math.round(((Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) * 180) / Math.PI) * 1e6) / 1e6) % 360) + 360) % 360 : hf.rotation + (item.host.wall % 2 === 1 ? 90 : 0);
  return { x: at.x, y: at.y, z: hf.z + item.z, rotation, w: size.w, d: thickness, h: size.h };
};

/** A hosted item's opening along its wall, from the wall's start: [from, to], and whether it fits. */
export const openingOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): { from: number; to: number; fits: boolean } | null => {
  const host = item.host && set.items.find((i) => i.id === item.host!.id);
  if (!item.host || !host) return null;
  const wall = wallsOf(hostFrame(set, host, global))[item.host.wall];
  if (!wall) return { from: 0, to: 0, fits: false };
  const w = sizeOf(set, item, global).w;
  const centre = item.host.along * wall.length;
  const from = centre - w / 2;
  const to = centre + w / 2;
  const hostH = sizeOf(set, host, global).h;
  const top = item.z + sizeOf(set, item, global).h;
  return { from, to, fits: from >= -1e-6 && to <= wall.length + 1e-6 && top <= hostH + 1e-6 };
};

const distanceToSegment = (p: Point, a: Point, b: Point): { d: number; t: number } => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { d: Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)), t };
};

/** The wall of a space on this floor nearest a point, within reach, for a door or window being placed there. */
export const nearestWall = (set: LevelSet, levelId: string, floorId: string, p: Point, reach = 1.5, global?: readonly AssetDefinition[]): HostRef | null => {
  let best: { host: HostRef; d: number } | null = null;
  for (const item of set.items) {
    if (item.levelId !== levelId || item.floorId !== floorId) continue;
    const def = assetOf(set, item, global);
    if (def.kind !== 'space' || !bool(paramOf(set, item, 'walls', global), true)) continue;
    for (const wall of wallsOf(hostFrame(set, item, global))) {
      const { d, t } = distanceToSegment(p, wall.a, wall.b);
      if (d <= reach && (!best || d < best.d)) best = { host: { id: item.id, wall: wall.index, along: t }, d };
    }
  }
  return best?.host ?? null;
};

/** The wall of one space nearest a point: where a door in it goes when the space's outline changes. */
export const wallNearest = (f: Frame, p: Point): { wall: number; along: number; d: number } | null => {
  let best: { wall: number; along: number; d: number } | null = null;
  for (const wall of wallsOf(f)) {
    const { d, t } = distanceToSegment(p, wall.a, wall.b);
    if (!best || d < best.d) best = { wall: wall.index, along: t, d };
  }
  return best;
};

/** The smallest space on this floor that holds a point: what an object is "in", for naming and links. */
export const spaceAt = (set: LevelSet, levelId: string, floorId: string, p: Point, global?: readonly AssetDefinition[]): LevelItem | undefined => {
  let best: { item: LevelItem; area: number } | undefined;
  for (const item of set.items) {
    if (item.levelId !== levelId || item.floorId !== floorId || assetOf(set, item, global).kind !== 'space') continue;
    const f = frameOf(set, item, global);
    if (contains(f, p) && (!best || areaOf(f) < best.area)) best = { item, area: areaOf(f) };
  }
  return best?.item;
};

// ---------------------------------------------------------------- 3D meshes

/** A slab is an outline (a freeform floor or ceiling) raised to its height. */
export type MeshShape = 'box' | 'cylinder' | 'sphere' | 'wedge' | 'cone' | 'slab';
export type MeshPart = 'floor' | 'wall' | 'ceiling' | 'solid' | 'volume' | 'marker' | 'light' | 'door';

/** One piece of the graybox. Coordinates are 3D: x east, y up, z south; a centre, a size, and a turn about y (radians). */
export interface Mesh {
  key: string;
  itemId: string;
  part: MeshPart;
  shape: MeshShape;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rotY: number;
  color: string;
  opacity: number;
  /** Something the player bumps into and stands on in Play Mode. */
  collide: boolean;
  /** A slab's corners around its centre, in its own frame (x, z), clockwise seen from above, and its triangles. */
  outline?: { x: number; z: number }[];
  triangles?: number[];
  /** A light this proxy stands for. */
  light?: { kind: 'point' | 'spot' | 'area'; color: string; intensity: number; range: number; angle?: number };
}

/** The graybox palette: spaces in neutral stone, everything else in its category's colour (HANDOFF tokens). */
export const CATEGORY_COLOR: Record<string, string> = {
  world: '#6fae5e',
  settlement: '#c9a45c',
  spaces: '#8b8473',
  architecture: '#9a927e',
  primitives: '#a59c86',
  props: '#4a86d8',
  lighting: '#e8c872',
  gameplay: '#6cc4d6',
  actors: '#d9607a',
  logic: '#c8bfae',
  presentation: '#9a7fc0',
  spawning: '#e07bb0',
  navigation: '#8fa8c4',
  custom: '#6fae5e',
};

const MATERIAL: Record<string, { color?: string; opacity?: number }> = {
  stone: { color: '#8a8577' },
  wood: { color: '#8a6a45' },
  metal: { color: '#8b95a0' },
  glass: { color: '#9fc6d8', opacity: 0.35 },
  water: { color: '#3f7fa0', opacity: 0.6 },
  emissive: { color: '#f3d98c' },
};

export const INVALID_COLOR = '#e5484d';

export interface MeshOptions {
  /** Show ceilings (off while editing, so you can see in). */
  ceilings?: boolean;
  /** Only this floor; every floor when absent. */
  floorId?: string;
  global?: readonly AssetDefinition[];
  /** Items to leave out: hidden, or inactive in play. */
  skip?: (item: LevelItem) => boolean;
  /** Doors standing open (Play Mode): no leaf, nothing to bump into. */
  open?: (item: LevelItem) => boolean;
}

/** The whole level as graybox pieces. */
export const meshesFor = (set: LevelSet, levelId: string, options: MeshOptions = {}): Mesh[] => {
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return [];
  const g = options.global;
  const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
  const out: Mesh[] = [];
  const items = set.items.filter((i) => i.levelId === levelId && (!options.floorId || i.floorId === options.floorId) && !i.hidden && !options.skip?.(i));
  // Openings stay cut even while their door is out of play (a door that is gone leaves a doorway).
  const openings = set.items
    .filter((i) => i.levelId === levelId && i.host && !i.hidden && set.items.some((h) => h.id === i.host!.id))
    .map((i) => ({ floorId: i.floorId, frame: frameOf(set, i, g), z: i.z }));

  for (const item of items) {
    const def = assetOf(set, item, g);
    const f = frameOf(set, item, g);
    const base = elevation.get(item.floorId) ?? 0;
    const rotY = -rad(f.rotation);
    const material = MATERIAL[String(paramOf(set, item, 'material', g) ?? '')] ?? {};
    const color = item.invalid ? INVALID_COLOR : material.color ?? CATEGORY_COLOR[def.category] ?? '#a59c86';
    const opacity = material.opacity ?? 1;
    const at = (lx: number, ly: number) => toPlan(f, lx, ly);
    const push = (m: Omit<Mesh, 'itemId' | 'rotY' | 'collide'> & { rotY?: number; collide?: boolean }) => out.push({ itemId: item.id, rotY, collide: false, ...m });

    if (def.kind === 'space') {
      const t = num(paramOf(set, item, 'wallThickness', g), 0.2);
      const y0 = base + f.z;
      // A freeform space's floor and ceiling follow its outline, out to the walls' outer faces.
      const slab = f.outline ? offsetOutline(f.outline, t / 2) : null;
      const slabShape = slab
        ? (() => {
            const b = boundsOf(slab);
            return { shape: 'slab' as const, sx: b.maxX - b.minX, sz: b.maxY - b.minY, outline: slab.map((p) => ({ x: p.x, z: p.y })), triangles: triangulate(slab) };
          })()
        : { shape: 'box' as const, sx: f.w + t, sz: f.d + t };
      if (bool(paramOf(set, item, 'floorSlab', g), true)) {
        push({ key: `${item.id}:floor`, collide: true, part: 'floor', x: f.x, y: y0 - 0.05, z: f.y, sy: 0.1, color: '#3d3727', opacity: 1, ...slabShape });
      }
      if (bool(paramOf(set, item, 'ceiling', g), true) && options.ceilings) {
        push({ key: `${item.id}:ceiling`, collide: true, part: 'ceiling', x: f.x, y: y0 + f.h + 0.05, z: f.y, sy: 0.1, color: '#5d5848', opacity: 1, ...slabShape });
      }
      if (bool(paramOf(set, item, 'walls', g), true)) {
        for (const wall of wallsOf(f)) {
          // North and south walls run the full width plus the corners; east and west fit between them.
          // An outline's walls each run half a thickness past both corners, so every corner is closed.
          const long = !!f.outline || wall.index % 2 === 0;
          const length = long ? wall.length + t : Math.max(0, wall.length - t);
          const shift = long ? t / 2 : -t / 2;
          const dir = { x: (wall.b.x - wall.a.x) / (wall.length || 1), y: (wall.b.y - wall.a.y) / (wall.length || 1) };
          const wallAngle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
          // Every door and window standing in this wall's line cuts it, whichever room it was put in:
          // two rooms that share a wall share its openings.
          const holes = openings
            .filter((o) => o.floorId === item.floorId)
            .flatMap((o) => {
              const vx = o.frame.x - wall.a.x;
              const vy = o.frame.y - wall.a.y;
              const along = vx * dir.x + vy * dir.y;
              const across = Math.abs(vx * dir.y - vy * dir.x);
              const turn = Math.abs((((o.frame.rotation - wallAngle) % 180) + 180) % 180);
              if (across > Math.max(t, 0.3) || Math.min(turn, 180 - turn) > 5 || along < -o.frame.w / 2 || along > wall.length + o.frame.w / 2) return [];
              return [{ from: Math.max(0, along - o.frame.w / 2 + shift), to: Math.min(length, along + o.frame.w / 2 + shift), bottom: o.z, top: Math.min(f.h, o.z + o.frame.h) }];
            })
            .filter((o) => o.to > o.from)
            .sort((a, b) => a.from - b.from);
          const pieces: { from: number; to: number; bottom: number; top: number }[] = [];
          let cursor = 0;
          for (const hole of holes) {
            if (hole.from > cursor) pieces.push({ from: cursor, to: hole.from, bottom: 0, top: f.h });
            const from = Math.max(cursor, hole.from);
            if (hole.to > from) {
              if (hole.bottom > 0) pieces.push({ from, to: hole.to, bottom: 0, top: hole.bottom });
              if (hole.top < f.h) pieces.push({ from, to: hole.to, bottom: hole.top, top: f.h });
            }
            cursor = Math.max(cursor, hole.to);
          }
          if (cursor < length) pieces.push({ from: cursor, to: length, bottom: 0, top: f.h });
          // A wall's local frame: from its start, along its length.
          const start = { x: wall.a.x - dir.x * (long ? t / 2 : -t / 2), y: wall.a.y - dir.y * (long ? t / 2 : -t / 2) };
          const wallRot = -Math.atan2(dir.y, dir.x);
          pieces.forEach((p, n) => {
            const mid = (p.from + p.to) / 2;
            out.push({
              key: `${item.id}:wall${wall.index}:${n}`,
              itemId: item.id,
              part: 'wall',
              shape: 'box',
              x: start.x + dir.x * mid,
              y: y0 + (p.bottom + p.top) / 2,
              z: start.y + dir.y * mid,
              sx: p.to - p.from,
              sy: p.top - p.bottom,
              sz: t,
              rotY: wallRot,
              collide: true,
              color: item.invalid ? INVALID_COLOR : material.color ?? CATEGORY_COLOR.spaces!,
              opacity,
            });
          });
        }
      }
      continue;
    }

    const y0 = base + f.z;
    if (def.kind === 'hosted') {
      // The opening is cut in the wall; a door shows as a thin leaf in it, a window as glass.
      const host = item.host && set.items.find((i) => i.id === item.host!.id);
      const hostBase = host ? elevation.get(host.floorId) ?? 0 : base;
      const open = def.role === 'door' ? String(paramOf(set, item, 'swing', g)) === 'open archway' || !!options.open?.(item) : false;
      if (!open) {
        push({
          key: `${item.id}:leaf`,
          collide: true,
          part: 'door',
          shape: 'box',
          x: f.x,
          y: hostBase + f.z + f.h / 2,
          z: f.y,
          sx: Math.max(0.05, f.w - 0.04),
          sy: f.h,
          sz: def.role === 'window' ? 0.03 : 0.06,
          color: item.invalid || (item.host && !openingOf(set, item, g)?.fits) ? INVALID_COLOR : def.role === 'window' ? '#9fc6d8' : '#8a6a45',
          opacity: def.role === 'window' ? 0.35 : 1,
        });
      }
      continue;
    }

    if (def.kind === 'volume') {
      // A state gate that blocks the way is solid while it is there.
      const blocks = def.role === 'gate' && bool(paramOf(set, item, 'blocks', g), true);
      // A freeform volume is its outline raised to its height.
      const shape = f.outline
        ? { shape: 'slab' as const, outline: f.outline.map((p) => ({ x: p.x, z: p.y })), triangles: triangulate(f.outline) }
        : { shape: 'box' as const };
      push({ key: `${item.id}:volume`, part: 'volume', x: f.x, y: y0 + f.h / 2, z: f.y, sx: f.w, sy: f.h, sz: f.d, color, opacity: 0.16, collide: blocks, ...shape });
      continue;
    }

    if (def.kind === 'marker') {
      const r = Math.min(f.w, f.d) / 2;
      push({ key: `${item.id}:body`, part: 'marker', shape: 'cylinder', x: f.x, y: y0 + f.h / 2, z: f.y, sx: r * 2, sy: f.h, sz: r * 2, color, opacity: 0.85 });
      // A nose pointing the way it faces (north in its own frame).
      const nose = at(0, -r - 0.18);
      push({ key: `${item.id}:facing`, part: 'marker', shape: 'cone', x: nose.x, y: y0 + Math.min(f.h, 1.4), z: nose.y, sx: 0.22, sy: 0.36, sz: 0.22, color, opacity: 1 });
      if (def.role === 'spawn') {
        const radius = num(paramOf(set, item, 'radius', g), 0);
        if (radius > 0) push({ key: `${item.id}:radius`, part: 'volume', shape: 'cylinder', x: f.x, y: y0 + 0.02, z: f.y, sx: radius * 2, sy: 0.04, sz: radius * 2, color, opacity: 0.18 });
      }
      continue;
    }

    if (def.kind === 'light') {
      const kind = def.id === 'light.spot' ? 'spot' : def.id === 'light.area' ? 'area' : 'point';
      push({
        key: `${item.id}:bulb`,
        part: 'light',
        shape: def.proxy === 'cylinder' ? 'cylinder' : 'sphere',
        x: f.x,
        y: y0 + f.h / 2,
        z: f.y,
        sx: f.w,
        sy: f.h,
        sz: f.d,
        color: String(paramOf(set, item, 'color', g) ?? '#ffd9a0'),
        opacity: 1,
        light: {
          kind,
          color: String(paramOf(set, item, 'color', g) ?? '#ffd9a0'),
          intensity: num(paramOf(set, item, 'intensity', g), 1),
          range: num(paramOf(set, item, 'range', g), 8),
          ...(kind === 'spot' ? { angle: num(paramOf(set, item, 'angle', g), 40) } : {}),
        },
      });
      continue;
    }

    // Solids: in the way unless their collision is off (or a trigger).
    const collision = String(paramOf(set, item, 'collision', g) ?? 'static');
    const solid = collision === 'static' || collision === 'dynamic';
    if (def.proxy === 'stairs') {
      const steps = Math.max(2, Math.round(num(paramOf(set, item, 'steps', g), 16)));
      const run = f.d / steps;
      for (let s = 0; s < steps; s++) {
        const rise = (f.h * (s + 1)) / steps;
        // The first step is at the south end; the flight climbs north.
        const c = at(0, f.d / 2 - run * (s + 0.5));
        push({ key: `${item.id}:step${s}`, collide: solid, part: 'solid', shape: 'box', x: c.x, y: y0 + rise / 2, z: c.y, sx: f.w, sy: rise, sz: run, color, opacity });
      }
      continue;
    }
    const shape: MeshShape = def.proxy === 'cylinder' ? 'cylinder' : def.proxy === 'sphere' ? 'sphere' : def.proxy === 'wedge' ? 'wedge' : 'box';
    push({ key: `${item.id}:solid`, collide: solid && def.proxy !== 'plane', part: 'solid', shape, x: f.x, y: y0 + f.h / 2, z: f.y, sx: f.w, sy: Math.max(0.01, f.h), sz: f.d, color, opacity });
  }
  return out;
};
