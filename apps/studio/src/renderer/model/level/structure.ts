import type { Project } from '../types';
import { assetOf, contains, corners, frameOf, num, paramOf, pointInPolygon, spaceAt, toPlan, type Frame, type Point } from './geometry';
import { doorRules } from './doors';
import { addMap, gridFor, kindOf } from './hierarchy';
import { guid, levelsOf, placeAsset, withSet } from './level';
import type { AssetDefinition, Floor, FloorKind, Level, LevelItem, LevelSet, OutlinePoint, StructureInfo, StructureType, TraversalStyle } from './types';

/**
 * The Structure Creator (structure spec): pyramids, temples, fortresses,
 * offices, bunkers and dungeons as mini-levels inside a level. A structure is
 * a building map (spec V2 §8) with a little more: what it is and how it is
 * played (`Level.structure`), floors from basements to the roof, a footprint
 * on each floor, and its structure graph — rooms as nodes, doors, stairs,
 * ladders and lifts as edges — that the validator walks. The map, the 3D
 * graybox, Play Mode and the engines read the same items as before: nothing
 * is kept twice (spec §3, §12).
 */

// ---------------------------------------------------------------- presets (spec §5)

export type FootprintShape = 'rectangle' | 'l' | 'u' | 'cross' | 'octagon';

export interface StructurePreset {
  id: StructureType;
  label: string;
  /** The mass on the parent map. */
  asset: string;
  w: number;
  d: number;
  above: number;
  below: number;
  floorHeight: number;
  roof: boolean;
  shape: FootprintShape;
  /** Each floor above the ground drawn in this far on every side (a stepped pyramid), in metres. */
  step: number;
  traversal: TraversalStyle;
  purpose: string;
}

export const STRUCTURE_PRESETS: readonly StructurePreset[] = [
  { id: 'pyramid', label: 'Pyramid / tomb', asset: 'struct.pyramid', w: 60, d: 60, above: 3, below: 1, floorHeight: 6, roof: false, shape: 'rectangle', step: 8, traversal: 'mixed', purpose: 'A tomb to explore: halls, false chambers, shafts and a hidden burial chamber.' },
  { id: 'temple', label: 'Ancient temple', asset: 'struct.temple', w: 24, d: 36, above: 1, below: 1, floorHeight: 10, roof: true, shape: 'rectangle', step: 0, traversal: 'stairs', purpose: 'A great hall over a crypt.' },
  { id: 'fortress', label: 'Fortress / castle', asset: 'struct.castle', w: 40, d: 40, above: 3, below: 1, floorHeight: 4, roof: true, shape: 'u', step: 0, traversal: 'stairs', purpose: 'Wings around a yard, with a dungeon below and the walls on top.' },
  { id: 'office', label: 'Modern office', asset: 'struct.mass', w: 30, d: 20, above: 5, below: 1, floorHeight: 3.5, roof: true, shape: 'rectangle', step: 0, traversal: 'accessible', purpose: 'Floors of offices round a core of stairs and lifts, with parking below.' },
  { id: 'apartment', label: 'Apartment block / hotel', asset: 'struct.mass', w: 24, d: 16, above: 6, below: 0, floorHeight: 3, roof: true, shape: 'l', step: 0, traversal: 'stairs', purpose: 'A corridor of rooms on every floor.' },
  { id: 'industrial', label: 'Industrial facility', asset: 'struct.mass', w: 40, d: 30, above: 2, below: 0, floorHeight: 6, roof: true, shape: 'rectangle', step: 0, traversal: 'ladders', purpose: 'A tall shop floor with gantries and a control room.' },
  { id: 'bunker', label: 'Underground bunker', asset: 'struct.mass', w: 20, d: 20, above: 1, below: 3, floorHeight: 3, roof: false, shape: 'rectangle', step: 0, traversal: 'ladders', purpose: 'A blockhouse at the surface, levels going down.' },
  { id: 'dungeon', label: 'Dungeon / ruin', asset: 'struct.dungeonModule', w: 30, d: 30, above: 1, below: 2, floorHeight: 4, roof: false, shape: 'cross', step: 0, traversal: 'mixed', purpose: 'Chambers and passages, collapsed in places.' },
  { id: 'custom', label: 'Blank structure', asset: 'struct.mass', w: 16, d: 12, above: 2, below: 0, floorHeight: 3, roof: false, shape: 'rectangle', step: 0, traversal: 'stairs', purpose: '' },
];

export const presetOf = (type: StructureType | undefined): StructurePreset => STRUCTURE_PRESETS.find((p) => p.id === type) ?? STRUCTURE_PRESETS[STRUCTURE_PRESETS.length - 1]!;

export const TRAVERSAL_STYLES: readonly { id: TraversalStyle; label: string; hint: string }[] = [
  { id: 'stairs', label: 'Stairs', hint: 'Floors are joined by stairs and ramps.' },
  { id: 'ladders', label: 'Ladders and stairs', hint: 'Ladders count as a way between floors.' },
  { id: 'mixed', label: 'Anything climbable', hint: 'Stairs, ladders, lifts, ramps and traversal links.' },
  { id: 'accessible', label: 'Step-free', hint: 'Only lifts and ramps join floors. A design option, not building-code compliance.' },
];

export const FOOTPRINT_SHAPES: readonly { id: FootprintShape; label: string }[] = [
  { id: 'rectangle', label: 'Rectangle' },
  { id: 'l', label: 'L-shape' },
  { id: 'u', label: 'U-shape (open yard)' },
  { id: 'cross', label: 'Cross' },
  { id: 'octagon', label: 'Octagon' },
];

/** A footprint shape's corners, as fractions of its width and depth, clockwise seen from above (x east, y south). */
export const shapeOutline = (shape: FootprintShape): OutlinePoint[] | undefined => {
  const t = 1 / 6;
  const o = 0.5 - 0.5 * Math.tan(Math.PI / 8);
  switch (shape) {
    case 'l':
      return [{ x: -0.5, y: -0.5 }, { x: 0, y: -0.5 }, { x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
    case 'u':
      return [{ x: -0.5, y: -0.5 }, { x: -0.15, y: -0.5 }, { x: -0.15, y: 0.15 }, { x: 0.15, y: 0.15 }, { x: 0.15, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
    case 'cross':
      return [
        { x: -t, y: -0.5 }, { x: t, y: -0.5 }, { x: t, y: -t }, { x: 0.5, y: -t }, { x: 0.5, y: t }, { x: t, y: t },
        { x: t, y: 0.5 }, { x: -t, y: 0.5 }, { x: -t, y: t }, { x: -0.5, y: t }, { x: -0.5, y: -t }, { x: -t, y: -t },
      ].map((p) => ({ x: round(p.x), y: round(p.y) }));
    case 'octagon':
      return [
        { x: -0.5 + o, y: -0.5 }, { x: 0.5 - o, y: -0.5 }, { x: 0.5, y: -0.5 + o }, { x: 0.5, y: 0.5 - o },
        { x: 0.5 - o, y: 0.5 }, { x: -0.5 + o, y: 0.5 }, { x: -0.5, y: 0.5 - o }, { x: -0.5, y: -0.5 + o },
      ].map((p) => ({ x: round(p.x), y: round(p.y) }));
    default:
      return undefined;
  }
};

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------- floors (spec §8)

/** What a floor is: set by the Structure Creator, or worked out from its elevation. */
export const floorKindOf = (floor: Floor): FloorKind => floor.kind ?? (floor.elevation < -1e-6 ? 'basement' : 'upper');

/**
 * Each floor's short code (spec §8): B2, B1 below ground, G for the lowest
 * floor at or above it, then 2, 3 … and R for the roof. Floors ordered by elevation.
 */
export const floorCodes = (level: Level): Map<string, string> => {
  const sorted = [...level.floors].sort((a, b) => a.elevation - b.elevation);
  const out = new Map<string, string>();
  const basements = sorted.filter((f) => floorKindOf(f) === 'basement');
  basements.forEach((f, i) => out.set(f.id, `B${basements.length - i}`));
  let n = 0;
  for (const f of sorted) {
    const k = floorKindOf(f);
    if (k === 'basement') continue;
    if (k === 'roof') out.set(f.id, 'R');
    else out.set(f.id, n++ === 0 ? 'G' : String(n));
  }
  return out;
};

/** The floors that count as storeys of the mass: not basements, not the roof. */
export const storeysOf = (level: Level): Floor[] => level.floors.filter((f) => floorKindOf(f) !== 'basement' && floorKindOf(f) !== 'roof');

/** Floors for a new structure: basements, the ground and floors above it, and a roof. */
export const structureFloors = (above: number, below: number, height: number, roof: boolean): Floor[] => {
  const floors: Floor[] = [];
  for (let b = below; b >= 1; b--) floors.push({ id: guid(), name: `Basement ${b}`, elevation: r3(-b * height), height, kind: 'basement' });
  for (let n = 0; n < Math.max(1, above); n++) floors.push({ id: guid(), name: n === 0 ? 'Ground floor' : `Floor ${n + 1}`, elevation: r3(n * height), height, kind: n === 0 ? 'ground' : 'upper' });
  if (roof) floors.push({ id: guid(), name: 'Roof', elevation: r3(Math.max(1, above) * height), height: 3, kind: 'roof' });
  return floors;
};

/** A basement under the lowest floor (one undo step). */
export const addBasement = (project: Project, levelId: string): { project: Project; id: string } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return { project, id: '' };
  const low = [...level.floors].sort((a, b) => a.elevation - b.elevation)[0]!;
  const count = level.floors.filter((f) => floorKindOf(f) === 'basement').length;
  const height = low.height;
  const floor: Floor = { id: guid(), name: `Basement ${count + 1}`, elevation: r3(Math.min(0, low.elevation) - height), height, kind: 'basement' };
  // A floor that was "the ground" by elevation alone keeps being it.
  const floors = level.floors.map((f) => (!f.kind && f.elevation >= 0 && f.id === low.id ? { ...f, kind: 'ground' as const } : f));
  return { project: withSet(project, { ...set, levels: set.levels.map((l) => (l.id === levelId ? { ...l, floors: [...floors, floor] } : l)) }), id: floor.id };
};

/** A roof on top of the highest floor, if there isn't one (one undo step). */
export const addRoof = (project: Project, levelId: string): { project: Project; id: string } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return { project, id: '' };
  const existing = level.floors.find((f) => floorKindOf(f) === 'roof');
  if (existing) return { project, id: existing.id };
  const top = Math.max(...level.floors.map((f) => f.elevation + f.height));
  const floor: Floor = { id: guid(), name: 'Roof', elevation: r3(top), height: 3, kind: 'roof' };
  return { project: withSet(project, { ...set, levels: set.levels.map((l) => (l.id === levelId ? { ...l, floors: [...l.floors, floor] } : l)) }), id: floor.id };
};

// ---------------------------------------------------------------- creating a structure (spec §2, §5)

export interface NewStructure {
  parentId: string;
  floorId: string;
  at: Point;
  type: StructureType;
  name?: string;
  w?: number;
  d?: number;
  above?: number;
  below?: number;
  floorHeight?: number;
  roof?: boolean;
  shape?: FootprintShape;
  /** Each floor up drawn in this far on every side (a stepped pyramid). */
  step?: number;
  traversal?: TraversalStyle;
  purpose?: string;
  seed?: number;
  scene?: string;
}

/**
 * Add a structure to a map (spec §2): its mass on the parent map, and its
 * building map with every floor, the footprint drawn on each, and what it is.
 * One undo step. The mass and the map stay in step as building masses do.
 */
export const createStructure = (project: Project, spec: NewStructure, global?: readonly AssetDefinition[]): { project: Project; id: string; massId: string } => {
  const preset = presetOf(spec.type);
  const above = Math.max(1, Math.min(200, Math.round(spec.above ?? preset.above)));
  const below = Math.max(0, Math.min(20, Math.round(spec.below ?? preset.below)));
  const height = Math.max(2, spec.floorHeight ?? preset.floorHeight);
  const w = Math.max(2, spec.w ?? preset.w);
  const d = Math.max(2, spec.d ?? preset.d);
  const shape = spec.shape ?? preset.shape;
  const step = Math.max(0, spec.step ?? preset.step);
  const name = spec.name?.trim() || preset.label.split(' /')[0]!;
  const placed = placeAsset(project, spec.parentId, spec.floorId, preset.asset, spec.at, { global, name });
  const massId = placed.ids[0];
  if (!massId) return { project, id: '', massId: '' };
  let set = levelsOf(placed.project);
  set = { ...set, items: set.items.map((i) => (i.id === massId ? { ...i, size: { w, d, h: r3(above * height) }, params: { ...i.params, floors: above, floorHeight: height } } : i)) };
  const floors = structureFloors(above, below, height, spec.roof ?? preset.roof);
  const id = guid();
  const structure: StructureInfo = {
    type: preset.id,
    purpose: spec.purpose ?? preset.purpose,
    tags: [],
    author: '',
    traversal: spec.traversal ?? preset.traversal,
    seed: spec.seed ?? 1 + Math.floor(Math.random() * 99999),
    ...(spec.scene ? { scene: spec.scene } : {}),
  };
  set = addMap(set, { id, name, kind: 'building', parentId: spec.parentId, anchorId: massId, grid: gridFor(Math.max(w, d)), boundary: 'continuous', floors, structure });
  let next = withSet(placed.project, set);
  // A footprint on every floor: stepped in on the floors above the ground for a pyramid.
  const outline = shapeOutline(shape);
  const storeys = floors.filter((f) => f.kind !== 'basement' && f.kind !== 'roof');
  for (const floor of floors) {
    const up = floor.kind === 'roof' ? storeys.length - 1 : Math.max(0, storeys.indexOf(floor));
    const inset = Math.min(step * up, Math.min(w, d) / 2 - 1);
    const fw = r3(w - 2 * inset);
    const fd = r3(d - 2 * inset);
    const made = placeAsset(next, id, floor.id, 'struct.footprint', { x: 0, y: 0 }, { global, name: `Footprint ${floor.name}` });
    const fid = made.ids[0]!;
    const s2 = levelsOf(made.project);
    next = withSet(made.project, { ...s2, items: s2.items.map((i) => (i.id === fid ? { ...i, x: 0, y: 0, size: { w: fw, d: fd, h: floor.height }, ...(outline ? { outline } : {}) } : i)) });
  }
  return { project: next, id, massId };
};

/** Change what a structure is (one undo step); turns a plain building map into a structure. */
export const updateStructure = (project: Project, levelId: string, patch: Partial<StructureInfo>): Project => {
  const set = levelsOf(project);
  return withSet(project, {
    ...set,
    levels: set.levels.map((l) => {
      if (l.id !== levelId) return l;
      const base: StructureInfo = l.structure ?? { type: 'custom', purpose: '', tags: [], author: '', traversal: 'stairs', seed: 1 };
      const next = { ...base, ...patch };
      if (patch.scene === '') delete next.scene;
      return { ...l, structure: next };
    }),
  });
};

/** Whether a map is a structure: made with the Structure Creator, or any building map. */
export const isStructure = (level: Level | undefined): boolean => !!level && (!!level.structure || kindOf(level) === 'building');

// ---------------------------------------------------------------- the structure graph (spec §8, §13)

export type ConnectionKind = 'door' | 'opening' | 'stairs' | 'ramp' | 'ladder' | 'elevator' | 'traversal' | 'portal';

export interface StructureNode {
  /** The space's item id, or OUTSIDE. */
  id: string;
  name: string;
  floorId: string;
  role: string;
  x: number;
  y: number;
}

export interface StructureEdge {
  id: string;
  from: string;
  to: string;
  /** The item that joins them: the door, the stairs, the ladder. */
  via: string;
  kind: ConnectionKind;
  /** Between floors. */
  vertical: boolean;
  /** Closed until something opens it: a key, a condition, a puzzle (the solvability check works out when). */
  gated: boolean;
  /** One way (structure spec §7): it can be gone through from `from` to `to` only (once open, it is open both ways, but by then the player has come from `from`). */
  oneWay?: boolean;
  /** A secret door: the wall until it is searched. */
  secret?: boolean;
}

export const OUTSIDE = 'outside';

export interface StructureGraph {
  nodes: StructureNode[];
  edges: StructureEdge[];
  /** Rooms the player can't get to from an entrance (or the player start). */
  unreachable: string[];
  /** Where the walk starts: OUTSIDE when there is an entrance, a player start's room, or nothing. */
  start: string | null;
}

const VERTICAL: Record<string, ConnectionKind> = { stairs: 'stairs', ramp: 'ramp', ladder: 'ladder', elevator: 'elevator', traversal: 'traversal' };

/** Which ways between floors count, for the structure's traversal style (spec §15). */
const allowed = (style: TraversalStyle | undefined, kind: ConnectionKind): boolean => {
  if (kind === 'door' || kind === 'opening' || kind === 'portal') return true;
  switch (style ?? 'mixed') {
    case 'stairs':
      return kind === 'stairs' || kind === 'ramp' || kind === 'elevator';
    case 'ladders':
      return kind !== 'traversal';
    case 'accessible':
      return kind === 'ramp' || kind === 'elevator';
    default:
      return true;
  }
};

const floorAt = (level: Level, elevation: number): Floor | undefined => level.floors.find((f) => Math.abs(f.elevation - elevation) <= 0.35);

/** The footprint polygon of a floor, in plan metres: its footprint item, or the map's extent. */
export const footprintOf = (set: LevelSet, level: Level, floorId: string, global?: readonly AssetDefinition[]): Point[] | undefined => {
  const item = set.items.find((i) => i.levelId === level.id && i.floorId === floorId && assetOf(set, i, global).role === 'footprint');
  return item ? corners(frameOf(set, item, global)) : undefined;
};

export const insidePolygon = (p: Point, poly: readonly Point[], tolerance = 0.05): boolean => {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)));
    if (Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))) <= tolerance) return true;
  }
  return false;
};

const isGated = (set: LevelSet, item: LevelItem, global?: readonly AssetDefinition[]): boolean =>
  !!item.activeWhen || !!String(paramOf(set, item, 'keyItem', global) ?? '').trim() || paramOf(set, item, 'locked', global) === true || !!item.puzzles?.some((b) => b.role === 'gate');

/**
 * The structure graph of a map (spec §8): its spaces on every floor as nodes,
 * and what joins them as edges — a door between two rooms (or a room and the
 * outside: an entrance), an open space overlapping another, stairs and ramps
 * from where they start to the floor they rise to, ladders, lifts over their
 * travel, traversal links and portals out. Worked out from the items, so it is
 * never out of step with the plan.
 */
export const structureGraph = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): StructureGraph => {
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return { nodes: [], edges: [], unreachable: [], start: null };
  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const role = (i: LevelItem) => assetOf(set, i, global).role;
  const kind = (i: LevelItem) => assetOf(set, i, global).kind;
  const spaces = items.filter((i) => kind(i) === 'space');
  const nodes: StructureNode[] = spaces.map((s) => {
    const f = frameOf(set, s, global);
    return { id: s.id, name: s.name, floorId: s.floorId, role: role(s), x: f.x, y: f.y };
  });
  const edges: StructureEdge[] = [];
  const elevationOf = new Map(level.floors.map((f) => [f.id, f.elevation]));
  const style = level.structure?.traversal;
  const add = (e: Omit<StructureEdge, 'id'>) => {
    if (e.from === e.to || !allowed(style, e.kind)) return;
    edges.push({ ...e, id: `${e.via}:${e.from}>${e.to}` });
  };
  const at = (floorId: string, p: Point, except?: string) => {
    const s = spaceAt({ ...set, items: items.filter((i) => i.id !== except) }, levelId, floorId, p, global);
    return s?.id;
  };

  for (const item of items) {
    const r = role(item);
    const f = frameOf(set, item, global);
    if (r === 'door' && item.host) {
      // The two sides of the wall: the room it is in, and whatever is beyond.
      const host = items.find((i) => i.id === item.host!.id);
      if (!host) continue;
      const hf = frameOf(set, host, global);
      const rad = (f.rotation * Math.PI) / 180;
      const n = { x: -Math.sin(rad), y: Math.cos(rad) };
      const reach = f.d / 2 + 0.35;
      const a = { x: f.x + n.x * reach, y: f.y + n.y * reach };
      const b = { x: f.x - n.x * reach, y: f.y - n.y * reach };
      const beyond = contains(hf, a) ? b : a;
      const other = at(item.floorId, beyond, host.id) ?? OUTSIDE;
      const rules = doorRules(set, item, global);
      const gated = isGated(set, item, global);
      // A one-way door goes from the side it opens from.
      if (rules.oneWay === 'outside') add({ from: other, to: host.id, via: item.id, kind: 'door', vertical: false, gated, oneWay: true, ...(rules.secret ? { secret: true } : {}) });
      else add({ from: host.id, to: other, via: item.id, kind: 'door', vertical: false, gated, ...(rules.oneWay ? { oneWay: true } : {}), ...(rules.secret ? { secret: true } : {}) });
      continue;
    }
    const vk = VERTICAL[r];
    if (vk === 'stairs' || vk === 'ramp' || vk === 'ladder' || vk === 'traversal') {
      // From where it starts to the floor its top reaches (stairs and ramps rise to the north).
      const base = elevationOf.get(item.floorId) ?? 0;
      const top = floorAt(level, base + f.z + f.h);
      const lowEnd = vk === 'ladder' || vk === 'traversal' ? { x: f.x, y: f.y } : toPlan(f, 0, f.d / 2);
      const highEnd = vk === 'ladder' || vk === 'traversal' ? { x: f.x, y: f.y } : toPlan(f, 0, -f.d / 2 - 0.3);
      const from = at(item.floorId, lowEnd) ?? at(item.floorId, { x: f.x, y: f.y });
      const to = top && top.id !== item.floorId ? (at(top.id, highEnd) ?? at(top.id, { x: f.x, y: f.y })) : undefined;
      if (from && to) add({ from, to, via: item.id, kind: vk, vertical: true, gated: isGated(set, item, global) });
      continue;
    }
    if (vk === 'elevator') {
      // A lift stops at every floor within its travel.
      const base = elevationOf.get(item.floorId) ?? 0;
      const travel = num(paramOf(set, item, 'travel', global), 3);
      const stops = level.floors
        .filter((fl) => fl.elevation >= base - 0.35 && fl.elevation <= base + travel + 0.35)
        .sort((x, y) => x.elevation - y.elevation)
        .map((fl) => at(fl.id, { x: f.x, y: f.y }))
        .filter((s): s is string => !!s);
      for (let i = 1; i < stops.length; i++) add({ from: stops[i - 1]!, to: stops[i]!, via: item.id, kind: 'elevator', vertical: true, gated: isGated(set, item, global) });
      continue;
    }
    if (r === 'portal') {
      const room = at(item.floorId, { x: f.x, y: f.y });
      if (room) add({ from: room, to: OUTSIDE, via: item.id, kind: 'portal', vertical: false, gated: isGated(set, item, global) });
    }
  }
  // Open spaces (no walls) join whatever they overlap or touch on their floor.
  for (const s of spaces) {
    if (paramOf(set, s, 'walls', global) !== false) continue;
    const box = bbox(frameOf(set, s, global));
    for (const o of spaces) {
      if (o.id === s.id || o.floorId !== s.floorId) continue;
      const ob = bbox(frameOf(set, o, global));
      if (box.x0 <= ob.x1 + 0.1 && ob.x0 <= box.x1 + 0.1 && box.y0 <= ob.y1 + 0.1 && ob.y0 <= box.y1 + 0.1) add({ from: s.id, to: o.id, via: s.id, kind: 'opening', vertical: false, gated: false });
    }
  }

  // Walk from the outside (or the player start's room), through doors (one-way doors only their way) and up and down.
  const startItem = items.find((i) => role(i) === 'playerStart');
  const start = edges.some((e) => e.to === OUTSIDE || e.from === OUTSIDE) ? OUTSIDE : startItem ? (at(startItem.floorId, { x: startItem.x, y: startItem.y }) ?? null) : null;
  const reached = new Set<string>();
  if (start) {
    const queue = [start];
    reached.add(start);
    while (queue.length) {
      const here = queue.shift()!;
      for (const e of edges) {
        const there = e.from === here ? e.to : e.to === here && !e.oneWay ? e.from : null;
        if (there && !reached.has(there)) {
          reached.add(there);
          queue.push(there);
        }
      }
    }
  }
  const unreachable = start ? spaces.filter((s) => !reached.has(s.id)).map((s) => s.id) : [];
  return { nodes, edges, unreachable, start };
};

const bbox = (f: Frame) => {
  const c = corners(f);
  return { x0: Math.min(...c.map((p) => p.x)), x1: Math.max(...c.map((p) => p.x)), y0: Math.min(...c.map((p) => p.y)), y1: Math.max(...c.map((p) => p.y)) };
};

// ---------------------------------------------------------------- validation (spec §8, §15)

export interface StructureIssue {
  severity: 'error' | 'warning' | 'info';
  /** The item it is about, or the map. */
  id: string;
  message: string;
}

/**
 * What is wrong with a structure (spec §8 and §15, geometry): floors that
 * overlap in height, rooms outside their floor's footprint, stairs and
 * ladders that reach no floor or land outside every room, no way in, rooms
 * no one can get to, doors that open onto nothing.
 */
export const structureIssues = (set: LevelSet, levelId: string, global?: readonly AssetDefinition[]): StructureIssue[] => {
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return [];
  const out: StructureIssue[] = [];
  const say = (severity: StructureIssue['severity'], id: string, message: string) => out.push({ severity, id, message });
  const codes = floorCodes(level);
  const floorName = (id: string) => {
    const f = level.floors.find((x) => x.id === id);
    return f ? `${f.name} (${codes.get(f.id)})` : 'a floor';
  };

  const sorted = [...level.floors].sort((a, b) => a.elevation - b.elevation);
  for (let i = 1; i < sorted.length; i++) {
    const below = sorted[i - 1]!;
    const above = sorted[i]!;
    if (above.elevation < below.elevation + below.height - 0.01) say('error', level.id, `${above.name} starts ${r3(below.elevation + below.height - above.elevation)} m inside ${below.name}: their heights overlap.`);
  }

  const items = set.items.filter((i) => i.levelId === levelId && !i.hidden);
  const role = (i: LevelItem) => assetOf(set, i, global).role;
  const footprints = new Map<string, Point[] | undefined>(level.floors.map((f) => [f.id, footprintOf(set, level, f.id, global)]));
  if (level.structure && ![...footprints.values()].some(Boolean)) say('info', level.id, `${level.name} has no footprint: drag a Structure footprint onto a floor to say where its walls stand.`);

  for (const item of items) {
    const def = assetOf(set, item, global);
    if (def.kind !== 'space') continue;
    const poly = footprints.get(item.floorId);
    if (!poly) continue;
    const out1 = corners(frameOf(set, item, global)).filter((c) => !insidePolygon(c, poly, 0.1));
    if (out1.length) say('warning', item.id, `${item.name} goes outside the footprint of ${floorName(item.floorId)}.`);
  }

  const elevationOf = new Map(level.floors.map((f) => [f.id, f.elevation]));
  for (const item of items) {
    const r = role(item);
    if (r !== 'stairs' && r !== 'ramp' && r !== 'ladder') continue;
    const f = frameOf(set, item, global);
    const base = elevationOf.get(item.floorId) ?? 0;
    const top = floorAt(level, base + f.z + f.h);
    if (!top || top.id === item.floorId) {
      if (level.floors.length > 1) say('warning', item.id, `${item.name} rises ${r3(f.z + f.h)} m and reaches no floor: line its height up with the floor above.`);
      continue;
    }
    const highEnd = r === 'ladder' ? { x: f.x, y: f.y } : toPlan(f, 0, -f.d / 2 - 0.3);
    if (!spaceAt(set, levelId, top.id, highEnd, global) && !spaceAt(set, levelId, top.id, { x: f.x, y: f.y }, global)) say('warning', item.id, `${item.name} comes up on ${floorName(top.id)} outside every room.`);
  }

  const graph = structureGraph(set, levelId, global);
  const spaces = items.filter((i) => assetOf(set, i, global).kind === 'space');
  if (spaces.length && !graph.start) say('warning', level.id, `${level.name} has no way in: put a door in an outside wall, a portal, or a player start.`);
  for (const id of graph.unreachable) {
    const s = items.find((i) => i.id === id)!;
    say('warning', id, `No way to reach ${s.name} on ${floorName(s.floorId)}${level.structure?.traversal && level.structure.traversal !== 'mixed' ? ` (with ${TRAVERSAL_STYLES.find((t) => t.id === level.structure!.traversal)!.label.toLowerCase()} only)` : ''}.`);
  }
  for (const e of graph.edges) {
    if (e.kind !== 'door' || e.to !== OUTSIDE) continue;
    const door = items.find((i) => i.id === e.via)!;
    const poly = footprints.get(door.floorId);
    const f = frameOf(set, door, global);
    if (poly && pointInPolygon({ x: f.x, y: f.y }, poly)) {
      // Inside the footprint with no room beyond: it opens onto unplanned space.
      const rad = (f.rotation * Math.PI) / 180;
      const probe = [1, -1].map((s) => ({ x: f.x - Math.sin(rad) * s * (f.d / 2 + 0.6), y: f.y + Math.cos(rad) * s * (f.d / 2 + 0.6) }));
      if (probe.every((p) => insidePolygon(p, poly, 0))) say('info', door.id, `${door.name} opens onto unplanned space inside ${floorName(door.floorId)}.`);
    }
  }
  return out;
};
