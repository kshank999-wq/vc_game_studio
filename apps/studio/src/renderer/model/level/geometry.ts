import { findAsset, MISSING_ASSET } from './library';
import type { AssetDefinition, HostRef, LevelItem, LevelSet, ParamValue, Size } from './types';

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
}

// ---------------------------------------------------------------- definitions, sizes and parameters

export const assetOf = (set: LevelSet, item: LevelItem, global: readonly AssetDefinition[] = []): AssetDefinition =>
  findAsset(item.assetId, set.assets, global) ?? MISSING_ASSET;

export const sizeOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Size => ({ ...assetOf(set, item, global).size, ...item.size });

export const paramOf = (set: LevelSet, item: LevelItem, key: string, global?: readonly AssetDefinition[]): ParamValue | undefined =>
  item.params && key in item.params ? item.params[key] : assetOf(set, item, global).params.find((p) => p.key === key)?.default;

export const num = (v: ParamValue | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const bool = (v: ParamValue | undefined, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

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

export const corners = (f: Frame): Point[] => [
  toPlan(f, -f.w / 2, -f.d / 2),
  toPlan(f, f.w / 2, -f.d / 2),
  toPlan(f, f.w / 2, f.d / 2),
  toPlan(f, -f.w / 2, f.d / 2),
];

export const contains = (f: Frame, p: Point): boolean => {
  const l = toLocal(f, p);
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

/** Do two rectangles overlap by more than a sliver? (Separating axes.) */
export const overlaps = (a: Frame, b: Frame, tolerance = 0.05): boolean => {
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

/** One wall of a space: from `a` to `b` on the plan, in the space's own order (0 north, 1 east, 2 south, 3 west). */
export interface Wall {
  index: 0 | 1 | 2 | 3;
  a: Point;
  b: Point;
  length: number;
}

/** A space's four wall centre lines. North and south run west to east; east and west run north to south. */
export const wallsOf = (f: Frame): Wall[] => {
  const [nw, ne, se, sw] = corners(f) as [Point, Point, Point, Point];
  return [
    { index: 0, a: nw, b: ne, length: f.w },
    { index: 1, a: ne, b: se, length: f.d },
    { index: 2, a: sw, b: se, length: f.w },
    { index: 3, a: nw, b: sw, length: f.d },
  ];
};

const hostFrame = (set: LevelSet, host: LevelItem, global?: readonly AssetDefinition[]): Frame => {
  const size = sizeOf(set, host, global);
  return { x: host.x, y: host.y, z: host.z, rotation: host.rotation, ...size };
};

/** Where an item is. A door or window is wherever its wall says, so it follows the room when the room moves or changes size. */
export const frameOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): Frame => {
  const size = sizeOf(set, item, global);
  const host = item.host && set.items.find((i) => i.id === item.host!.id);
  if (!item.host || !host) return { x: item.x, y: item.y, z: item.z, rotation: item.rotation, ...size };
  const hf = hostFrame(set, host, global);
  const wall = wallsOf(hf)[item.host.wall]!;
  const t = Math.min(1, Math.max(0, item.host.along));
  const at = { x: wall.a.x + (wall.b.x - wall.a.x) * t, y: wall.a.y + (wall.b.y - wall.a.y) * t };
  const thickness = num(paramOf(set, host, 'wallThickness', global), 0.2);
  return { x: at.x, y: at.y, z: hf.z + item.z, rotation: hf.rotation + (item.host.wall % 2 === 1 ? 90 : 0), w: size.w, d: thickness, h: size.h };
};

/** A hosted item's opening along its wall, from the wall's start: [from, to], and whether it fits. */
export const openingOf = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): { from: number; to: number; fits: boolean } | null => {
  const host = item.host && set.items.find((i) => i.id === item.host!.id);
  if (!item.host || !host) return null;
  const wall = wallsOf(hostFrame(set, host, global))[item.host.wall]!;
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

/** The smallest space on this floor that holds a point: what an object is "in", for naming and links. */
export const spaceAt = (set: LevelSet, levelId: string, floorId: string, p: Point, global?: readonly AssetDefinition[]): LevelItem | undefined => {
  let best: { item: LevelItem; area: number } | undefined;
  for (const item of set.items) {
    if (item.levelId !== levelId || item.floorId !== floorId || assetOf(set, item, global).kind !== 'space') continue;
    const f = frameOf(set, item, global);
    if (contains(f, p) && (!best || f.w * f.d < best.area)) best = { item, area: f.w * f.d };
  }
  return best?.item;
};

// ---------------------------------------------------------------- 3D meshes

export type MeshShape = 'box' | 'cylinder' | 'sphere' | 'wedge' | 'cone';
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
  /** A light this proxy stands for. */
  light?: { kind: 'point' | 'spot' | 'area'; color: string; intensity: number; range: number; angle?: number };
}

/** The graybox palette: spaces in neutral stone, everything else in its category's colour (HANDOFF tokens). */
export const CATEGORY_COLOR: Record<string, string> = {
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
}

/** The whole level as graybox pieces. */
export const meshesFor = (set: LevelSet, levelId: string, options: MeshOptions = {}): Mesh[] => {
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return [];
  const g = options.global;
  const elevation = new Map(level.floors.map((f) => [f.id, f.elevation]));
  const out: Mesh[] = [];
  const items = set.items.filter((i) => i.levelId === levelId && (!options.floorId || i.floorId === options.floorId) && !i.hidden && !options.skip?.(i));
  const hostedBy = new Map<string, LevelItem[]>();
  for (const i of set.items) if (i.host) hostedBy.set(i.host.id, [...(hostedBy.get(i.host.id) ?? []), i]);

  for (const item of items) {
    const def = assetOf(set, item, g);
    const f = frameOf(set, item, g);
    const base = elevation.get(item.floorId) ?? 0;
    const rotY = -rad(f.rotation);
    const material = MATERIAL[String(paramOf(set, item, 'material', g) ?? '')] ?? {};
    const color = item.invalid ? INVALID_COLOR : material.color ?? CATEGORY_COLOR[def.category] ?? '#a59c86';
    const opacity = material.opacity ?? 1;
    const at = (lx: number, ly: number) => toPlan(f, lx, ly);
    const push = (m: Omit<Mesh, 'itemId' | 'rotY'> & { rotY?: number }) => out.push({ itemId: item.id, rotY, ...m });

    if (def.kind === 'space') {
      const t = num(paramOf(set, item, 'wallThickness', g), 0.2);
      const y0 = base + f.z;
      if (bool(paramOf(set, item, 'floorSlab', g), true)) {
        push({ key: `${item.id}:floor`, part: 'floor', shape: 'box', x: f.x, y: y0 - 0.05, z: f.y, sx: f.w + t, sy: 0.1, sz: f.d + t, color: '#3d3727', opacity: 1 });
      }
      if (bool(paramOf(set, item, 'ceiling', g), true) && options.ceilings) {
        push({ key: `${item.id}:ceiling`, part: 'ceiling', shape: 'box', x: f.x, y: y0 + f.h + 0.05, z: f.y, sx: f.w + t, sy: 0.1, sz: f.d + t, color: '#5d5848', opacity: 1 });
      }
      if (bool(paramOf(set, item, 'walls', g), true)) {
        const hosted = (hostedBy.get(item.id) ?? []).filter((h) => !h.hidden);
        for (const wall of wallsOf(f)) {
          // North and south walls run the full width plus the corners; east and west fit between them.
          const long = wall.index % 2 === 0;
          const length = long ? wall.length + t : Math.max(0, wall.length - t);
          const shift = long ? t / 2 : -t / 2;
          const holes = hosted
            .filter((h) => h.host!.wall === wall.index)
            .map((h) => {
              const o = openingOf(set, h, g)!;
              const hs = sizeOf(set, h, g);
              return { from: Math.max(0, o.from + shift), to: Math.min(length, o.to + shift), bottom: h.z, top: Math.min(f.h, h.z + hs.h) };
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
          const dir = { x: (wall.b.x - wall.a.x) / (wall.length || 1), y: (wall.b.y - wall.a.y) / (wall.length || 1) };
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
      const open = def.role === 'door' ? String(paramOf(set, item, 'swing', g)) === 'open archway' : false;
      if (!open) {
        push({
          key: `${item.id}:leaf`,
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
      push({ key: `${item.id}:volume`, part: 'volume', shape: 'box', x: f.x, y: y0 + f.h / 2, z: f.y, sx: f.w, sy: f.h, sz: f.d, color, opacity: 0.16 });
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

    // Solids.
    if (def.proxy === 'stairs') {
      const steps = Math.max(2, Math.round(num(paramOf(set, item, 'steps', g), 16)));
      const run = f.d / steps;
      for (let s = 0; s < steps; s++) {
        const rise = (f.h * (s + 1)) / steps;
        // The first step is at the south end; the flight climbs north.
        const c = at(0, f.d / 2 - run * (s + 0.5));
        push({ key: `${item.id}:step${s}`, part: 'solid', shape: 'box', x: c.x, y: y0 + rise / 2, z: c.y, sx: f.w, sy: rise, sz: run, color, opacity });
      }
      continue;
    }
    const shape: MeshShape = def.proxy === 'cylinder' ? 'cylinder' : def.proxy === 'sphere' ? 'sphere' : def.proxy === 'wedge' ? 'wedge' : 'box';
    push({ key: `${item.id}:solid`, part: 'solid', shape, x: f.x, y: y0 + f.h / 2, z: f.y, sx: f.w, sy: Math.max(0.01, f.h), sz: f.d, color, opacity });
  }
  return out;
};
