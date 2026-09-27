import type { Project } from '../types';
import { assetOf, boundsOf, corners, frameOf, nearestWall, openingOf, OUTLINED_KINDS, outlineOf, selfIntersects, sizeOf, tidyOutline, toLocal, toPlan, wallNearest, type Point } from './geometry';
import { findAsset } from './library';
import { forgetPlaces } from './places';
import { defaultSettings } from './naming';
import type { AssemblyPart, AssetDefinition, AssetSnapshot, Floor, Level, LevelItem, LevelSet, LevelSettings, NamingClass, OutlinePoint, ParamValue, Size } from './types';

/**
 * Every change to levels (spec §3–§5). Each takes the project and returns a
 * new one, so one call is one undo step: a drag, a resize and the walls it
 * regenerates, a paste. GUIDs never change once given.
 */

export const guid = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (globalThis.crypto.getRandomValues(new Uint8Array(1))[0]! % 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });

export const emptyLevels = (): LevelSet => ({ settings: defaultSettings(), levels: [], items: [], assets: [], counters: {} });

const EMPTY = emptyLevels();
const normalised = new WeakMap<LevelSet, LevelSet>();

/**
 * The project's levels, with anything a file left out filled in (an older
 * file, or one edited by hand). The same stored object always gives back the
 * same result, so views that memoise on it don't redo their work.
 */
export const levelsOf = (project: Project): LevelSet => {
  const set = project.levels;
  if (!set) return EMPTY;
  let out = normalised.get(set);
  if (!out) {
    const base = defaultSettings();
    const complete =
      Array.isArray(set.levels) && Array.isArray(set.items) && Array.isArray(set.assets) && set.counters && set.settings?.prefixes && set.settings.template !== undefined;
    out = complete
      ? set
      : {
          levels: Array.isArray(set.levels) ? set.levels : [],
          items: Array.isArray(set.items) ? set.items : [],
          assets: Array.isArray(set.assets) ? set.assets : [],
          counters: set.counters ?? {},
          ...(set.manifest ? { manifest: set.manifest } : {}),
          settings: { ...base, ...set.settings, prefixes: { ...base.prefixes, ...set.settings?.prefixes } },
        };
    normalised.set(set, out);
  }
  return out;
};

export const withSet = (project: Project, set: LevelSet): Project => ({ ...project, levels: set });

const next = (set: LevelSet, cls: NamingClass): { serial: number; counters: LevelSet['counters'] } => {
  const serial = (set.counters[cls] ?? 0) + 1;
  return { serial, counters: { ...set.counters, [cls]: serial } };
};

/** Snap a length to the grid when snapping is on. */
export const snap = (set: LevelSet, value: number, force?: boolean): number => {
  if (!(force ?? set.settings.snap)) return Math.round(value * 1000) / 1000;
  const g = set.settings.grid || 0.5;
  return Math.round(Math.round(value / g) * g * 1000) / 1000;
};

// ---------------------------------------------------------------- levels and floors

export const addLevel = (project: Project, name?: string): { project: Project; id: string } => {
  const set = levelsOf(project);
  const { serial, counters } = next(set, 'level');
  const level: Level = {
    id: guid(),
    name: name ?? (set.levels.length ? `Level ${set.levels.length + 1}` : project.name || 'Level 1'),
    serial,
    floors: [{ id: guid(), name: 'Ground floor', elevation: 0, height: 3 }],
  };
  return { project: withSet(project, { ...set, counters, levels: [...set.levels, level] }), id: level.id };
};

export const updateLevel = (project: Project, id: string, patch: Partial<Pick<Level, 'name' | 'notes' | 'links'>>): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, levels: set.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
};

export const removeLevel = (project: Project, id: string): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, levels: set.levels.filter((l) => l.id !== id), items: set.items.filter((i) => i.levelId !== id) });
};

/** A floor above the top one, as tall as it. */
export const addFloor = (project: Project, levelId: string): { project: Project; id: string } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level) return { project, id: '' };
  const top = [...level.floors].sort((a, b) => b.elevation - a.elevation)[0];
  const floor: Floor = { id: guid(), name: `Floor ${level.floors.length + 1}`, elevation: top ? top.elevation + top.height : 0, height: top?.height ?? 3 };
  return {
    project: withSet(project, { ...set, levels: set.levels.map((l) => (l.id === levelId ? { ...l, floors: [...l.floors, floor] } : l)) }),
    id: floor.id,
  };
};

export const updateFloor = (project: Project, levelId: string, floorId: string, patch: Partial<Omit<Floor, 'id'>>): Project => {
  const set = levelsOf(project);
  return withSet(project, {
    ...set,
    levels: set.levels.map((l) => (l.id === levelId ? { ...l, floors: l.floors.map((f) => (f.id === floorId ? { ...f, ...patch } : f)) } : l)),
  });
};

/** A level keeps at least one floor; a floor's items go with it. */
export const removeFloor = (project: Project, levelId: string, floorId: string): Project => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level || level.floors.length <= 1) return project;
  return withSet(project, {
    ...set,
    levels: set.levels.map((l) => (l.id === levelId ? { ...l, floors: l.floors.filter((f) => f.id !== floorId) } : l)),
    items: set.items.filter((i) => !(i.levelId === levelId && i.floorId === floorId)),
  });
};

export const updateSettings = (project: Project, patch: Partial<LevelSettings>): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, settings: { ...set.settings, ...patch, prefixes: { ...set.settings.prefixes, ...patch.prefixes } } });
};

// ---------------------------------------------------------------- placing

const uniqueName = (set: LevelSet, levelId: string, base: string): string => {
  const taken = new Set(set.items.filter((i) => i.levelId === levelId).map((i) => i.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
};

export interface PlaceOptions {
  name?: string;
  rotation?: number;
  global?: readonly AssetDefinition[];
}

/**
 * Put an asset on a floor at a plan point (its centre). A door or window goes
 * into the nearest wall; an assembly places all its parts, grouped.
 */
export const placeAsset = (
  project: Project,
  levelId: string,
  floorId: string,
  assetId: string,
  at: Point,
  options: PlaceOptions = {},
): { project: Project; ids: string[] } => {
  let set = levelsOf(project);
  const def = findAsset(assetId, set.assets, options.global);
  if (!def || !set.levels.some((l) => l.id === levelId)) return { project, ids: [] };

  if (def.kind === 'assembly' && def.parts?.length) {
    const groupId = guid();
    const ids: string[] = [];
    const turn = options.rotation ?? 0;
    const c = Math.cos((turn * Math.PI) / 180);
    const s = Math.sin((turn * Math.PI) / 180);
    const made: LevelItem[] = [];
    for (const part of def.parts) {
      const partDef = findAsset(part.assetId, set.assets, options.global);
      if (!partDef) continue;
      const { serial, counters } = next(set, partDef.naming);
      set = { ...set, counters };
      const item: LevelItem = {
        id: guid(),
        levelId,
        floorId,
        assetId: part.assetId,
        assetVersion: partDef.version,
        name: uniqueName({ ...set, items: [...set.items, ...made] }, levelId, part.name),
        serial,
        x: snap(set, at.x + part.dx * c - part.dy * s, false),
        y: snap(set, at.y + part.dx * s + part.dy * c, false),
        z: part.dz,
        rotation: (part.rotation + turn) % 360,
        groupId,
        ...(part.size ? { size: part.size } : {}),
        ...(part.params ? { params: part.params } : {}),
        ...(part.outline ? { outline: part.outline } : {}),
      };
      made.push(item);
      ids.push(item.id);
    }
    // Doors and windows in the assembly go back into the walls they were saved in.
    const placed = rehostAll({ ...set, items: [...set.items, ...made] }, ids, options.global);
    return { project: withSet(project, placed), ids };
  }

  const { serial, counters } = next(set, def.naming);
  set = { ...set, counters };
  const item: LevelItem = {
    id: guid(),
    levelId,
    floorId,
    assetId,
    assetVersion: def.version,
    name: options.name ?? uniqueName(set, levelId, def.name),
    serial,
    x: snap(set, at.x),
    y: snap(set, at.y),
    z: 0,
    rotation: options.rotation ?? 0,
  };
  if (def.kind === 'hosted') {
    const host = nearestWall(set, levelId, floorId, at, 1.5, options.global);
    if (host) {
      item.host = host;
      item.z = def.role === 'window' ? Number(def.params.find((p) => p.key === 'sill')?.default ?? 0.9) : 0;
    } else {
      item.invalid = 'Not in a wall. Drag it onto a room’s wall.';
    }
  }
  let placed: LevelSet = { ...set, items: [...set.items, item] };
  if (item.host) placed = revalidate(placed, [item.id], options.global);
  return { project: withSet(project, placed), ids: [item.id] };
};

// ---------------------------------------------------------------- editing

export const itemById = (project: Project, id: string): LevelItem | undefined => project.levels?.items.find((i) => i.id === id);

const mapItems = (set: LevelSet, ids: readonly string[], change: (item: LevelItem) => LevelItem): LevelSet => {
  const wanted = new Set(ids);
  let changed = false;
  const items = set.items.map((i) => {
    if (!wanted.has(i.id)) return i;
    const n = change(i);
    if (n !== i) changed = true;
    return n;
  });
  return changed ? { ...set, items } : set;
};

/** Doors and windows that no longer fit their wall are flagged, never deleted (spec §5.3). */
const revalidate = (set: LevelSet, hostIds: readonly string[], global?: readonly AssetDefinition[]): LevelSet => {
  const hosts = new Set(hostIds);
  return {
    ...set,
    items: set.items.map((i) => {
      if (!i.host || !(hosts.has(i.host.id) || hosts.has(i.id))) return i;
      const host = set.items.find((h) => h.id === i.host!.id);
      const opening = openingOf(set, i, global);
      const problem = !host ? 'Its wall is gone.' : opening && !opening.fits ? 'It no longer fits its wall. Make the wall longer or the opening smaller.' : undefined;
      if (problem === i.invalid) return i;
      const next = { ...i };
      if (problem) next.invalid = problem;
      else delete next.invalid;
      return next;
    }),
  };
};

export const updateItem = (project: Project, id: string, patch: Partial<Omit<LevelItem, 'id' | 'serial'>>, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const changed = mapItems(set, [id], (i) => ({ ...i, ...patch }));
  return changed === set ? project : withSet(project, revalidate(changed, [id], global));
};

/** Change sizes; walls and openings follow, and doors that stop fitting are flagged. One undo step. */
export const resizeItem = (project: Project, id: string, size: Partial<Size>, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === id);
  if (!item) return project;
  const changed = mapItems(set, [id], (i) => withSize(i, assetOf(set, i, global), size));
  return withSet(project, revalidate(changed, [id], global));
};

/** An item with a new size, storing only what differs from its definition. */
const withSize = (item: LevelItem, def: AssetDefinition, size: Partial<Size>): LevelItem => {
  const clean: Partial<Size> = {};
  for (const axis of ['w', 'd', 'h'] as const) {
    const v = size[axis] ?? item.size?.[axis];
    if (v === undefined) continue;
    const value = Math.max(0.01, Math.round(v * 1000) / 1000);
    if (value !== def.size[axis]) clean[axis] = value;
  }
  const n = { ...item };
  if (Object.keys(clean).length) n.size = clean;
  else delete n.size;
  return n;
};

// ---------------------------------------------------------------- freeform outlines (spec §3.1)

const RECTANGLE: OutlinePoint[] = [
  { x: -0.5, y: -0.5 },
  { x: 0.5, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
];

/** Doors and windows of these spaces, and where each stands now: to put them back after the outline changes. */
const openingsIn = (set: LevelSet, hostIds: ReadonlySet<string>, global?: readonly AssetDefinition[]) =>
  set.items.filter((i) => i.host && hostIds.has(i.host.id)).map((i) => ({ id: i.id, hostId: i.host!.id, at: frameOf(set, i, global) as Point }));

/** Each opening goes into its space's wall nearest where it stood. */
const rehostOpenings = (set: LevelSet, openings: { id: string; hostId: string; at: Point }[], global?: readonly AssetDefinition[]): LevelSet => {
  let out = set;
  for (const o of openings) {
    const host = out.items.find((i) => i.id === o.hostId);
    if (!host) continue;
    const near = wallNearest(frameOf(out, host, global), o.at);
    if (near) out = mapItems(out, [o.id], (i) => ({ ...i, host: { id: o.hostId, wall: near.wall, along: Math.round(near.along * 1000) / 1000 } }));
  }
  return revalidate(out, [...new Set(openings.map((o) => o.hostId))], global);
};

/**
 * Give a space or volume the outline through these plan corners. Its centre and size
 * become the outline's bounds, its facing stays, and its doors and windows go
 * into the nearest of its new walls. Refused (no change) when the corners
 * don't make a shape that can be walled: fewer than three, or edges crossing.
 */
export const setOutline = (project: Project, id: string, points: readonly Point[], global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === id);
  if (!item || item.locked || !OUTLINED_KINDS.has(assetOf(set, item, global).kind)) return project;
  const f = frameOf(set, item, global);
  const local = tidyOutline(points.map((p) => toLocal(f, p)));
  if (local.length < 3 || selfIntersects(local)) return project;
  const b = boundsOf(local);
  const w = b.maxX - b.minX;
  const d = b.maxY - b.minY;
  if (w < 0.1 || d < 0.1) return project;
  const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const centre = toPlan(f, c.x, c.y);
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  const outline = local.map((p) => ({ x: r((p.x - c.x) / w), y: r((p.y - c.y) / d) }));
  const openings = openingsIn(set, new Set([id]), global);
  const changed = mapItems(set, [id], (i) => ({
    ...withSize(i, assetOf(set, i, global), { w, d }),
    x: Math.round(centre.x * 1000) / 1000,
    y: Math.round(centre.y * 1000) / 1000,
    outline,
  }));
  return withSet(project, rehostOpenings(changed, openings, global));
};

/** A space's corners on the plan: its outline, or its rectangle's four. */
export const outlineCorners = (project: Project, id: string, global?: readonly AssetDefinition[]): Point[] => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === id);
  return item ? corners(frameOf(set, item, global)) : [];
};

const snapped = (set: LevelSet, p: Point): Point => ({ x: snap(set, p.x), y: snap(set, p.y) });

/** Drag one corner of a space's outline (a rectangle becomes an outline). */
export const moveCorner = (project: Project, id: string, index: number, to: Point, global?: readonly AssetDefinition[]): Project => {
  const points = outlineCorners(project, id, global);
  if (!points[index]) return project;
  points[index] = snapped(levelsOf(project), to);
  return setOutline(project, id, points, global);
};

/** Add a corner in a wall of a space's outline, at a plan point. */
export const insertCorner = (project: Project, id: string, wall: number, at: Point, global?: readonly AssetDefinition[]): Project => {
  const points = outlineCorners(project, id, global);
  if (wall < 0 || wall >= points.length) return project;
  points.splice(wall + 1, 0, snapped(levelsOf(project), at));
  return setOutline(project, id, points, global);
};

/** Take a corner out of a space's outline (three is the fewest). */
export const removeCorner = (project: Project, id: string, index: number, global?: readonly AssetDefinition[]): Project => {
  const points = outlineCorners(project, id, global);
  if (points.length <= 3 || !points[index]) return project;
  points.splice(index, 1);
  return setOutline(project, id, points, global);
};

/** Back to a plain rectangle of the same bounds; doors go into its nearest walls. */
export const makeRectangular = (project: Project, id: string, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === id);
  if (!item || !outlineOf(set, item, global)) return project;
  const def = assetOf(set, item, global);
  const openings = openingsIn(set, new Set([id]), global);
  const changed = mapItems(set, [id], (i) => {
    const n = { ...i };
    // A space whose definition has an outline keeps an explicit rectangle.
    if (def.outline) n.outline = RECTANGLE.map((p) => ({ ...p }));
    else delete n.outline;
    return n;
  });
  return withSet(project, rehostOpenings(changed, openings, global));
};

/**
 * Move items by a plan offset. A door or window being moved slides along its
 * wall, or into another wall it is dragged to; the rest follow the pointer.
 */
export const moveItems = (project: Project, ids: readonly string[], dx: number, dy: number, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const moving = new Set(ids);
  let changed = mapItems(set, ids, (i) => {
    if (i.locked) return i;
    if (i.host) {
      // Its host moves too: it rides along.
      if (moving.has(i.host.id)) return i;
      const f = frameOf(set, i, global);
      const target = { x: f.x + dx, y: f.y + dy };
      const host = nearestWall(set, i.levelId, i.floorId, target, 1.5, global);
      if (!host) return i;
      return { ...i, host: { ...host, along: Math.round(host.along * 1000) / 1000 } };
    }
    return { ...i, x: snap(set, i.x + dx), y: snap(set, i.y + dy) };
  });
  changed = revalidate(changed, ids, global);
  return changed === set ? project : withSet(project, changed);
};

/** Put items at exact plan positions (the inspector's X and Y). */
export const placeAt = (project: Project, id: string, at: Partial<Point & { z: number; rotation: number }>): Project =>
  updateItem(project, id, {
    ...(at.x !== undefined ? { x: at.x } : {}),
    ...(at.y !== undefined ? { y: at.y } : {}),
    ...(at.z !== undefined ? { z: at.z } : {}),
    ...(at.rotation !== undefined ? { rotation: ((at.rotation % 360) + 360) % 360 } : {}),
  });

/** Turn items about their shared centre. */
export const rotateItems = (project: Project, ids: readonly string[], degrees: number, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const free = set.items.filter((i) => ids.includes(i.id) && !i.host && !i.locked);
  if (!free.length) return project;
  const b = boundsOf(free.map((i) => ({ x: i.x, y: i.y })));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const c = Math.cos((degrees * Math.PI) / 180);
  const s = Math.sin((degrees * Math.PI) / 180);
  const changed = mapItems(set, free.map((i) => i.id), (i) => ({
    ...i,
    x: Math.round((cx + (i.x - cx) * c - (i.y - cy) * s) * 1000) / 1000,
    y: Math.round((cy + (i.x - cx) * s + (i.y - cy) * c) * 1000) / 1000,
    rotation: (((i.rotation + degrees) % 360) + 360) % 360,
  }));
  return withSet(project, revalidate(changed, ids, global));
};

/** Flip items across their shared centre line. Doors on a flipped room swap to the opposite wall. */
export const mirrorItems = (project: Project, ids: readonly string[], axis: 'x' | 'y'): Project => {
  const set = levelsOf(project);
  const free = set.items.filter((i) => ids.includes(i.id) && !i.host && !i.locked);
  if (!free.length) return project;
  const b = boundsOf(free.map((i) => ({ x: i.x, y: i.y })));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const flipped = new Set(free.map((i) => i.id));
  // Openings in outlined spaces go back into the wall nearest their mirrored place.
  const outlined = new Set(free.filter((i) => outlineOf(set, i)).map((i) => i.id));
  const reopen = openingsIn(set, outlined).map((o) => ({ ...o, at: axis === 'x' ? { x: 2 * cx - o.at.x, y: o.at.y } : { x: o.at.x, y: 2 * cy - o.at.y } }));
  const items = set.items.map((i) => {
    if (flipped.has(i.id)) {
      const moved = axis === 'x' ? { ...i, x: 2 * cx - i.x, rotation: (360 - i.rotation) % 360 } : { ...i, y: 2 * cy - i.y, rotation: (360 - i.rotation) % 360 };
      const outline = outlineOf(set, i);
      // Flipping the plan flips the outline in the space's own frame; it is put back clockwise.
      if (outline) moved.outline = tidyOutline(outline.map((p) => (axis === 'x' ? { x: -p.x, y: p.y } : { x: p.x, y: -p.y })));
      return moved;
    }
    if (i.host && outlined.has(i.host.id)) return i;
    if (i.host && flipped.has(i.host.id)) {
      // Mirroring east–west swaps the east and west walls and reverses north and south along their length.
      const w = i.host.wall;
      const across = axis === 'x' ? w === 1 || w === 3 : w === 0 || w === 2;
      const wall = across ? (w + 2) % 4 : w;
      const along = across ? i.host.along : 1 - i.host.along;
      return { ...i, host: { ...i.host, wall, along } };
    }
    return i;
  });
  return withSet(project, reopen.length ? rehostOpenings({ ...set, items }, reopen) : { ...set, items });
};

export type Alignment = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

/** Line items up by their edges or centres (plan outlines). */
export const alignItems = (project: Project, ids: readonly string[], how: Alignment, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const free = set.items.filter((i) => ids.includes(i.id) && !i.host && !i.locked);
  if (free.length < 2) return project;
  const boxes = new Map(free.map((i) => [i.id, boundsOf(corners(frameOf(set, i, global)))]));
  const all = boundsOf([...boxes.values()].flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]));
  const changed = mapItems(set, free.map((i) => i.id), (i) => {
    const b = boxes.get(i.id)!;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const dx = how === 'left' ? all.minX - b.minX : how === 'right' ? all.maxX - b.maxX : how === 'centre' ? (all.minX + all.maxX) / 2 - (b.minX + w / 2) : 0;
    const dy = how === 'top' ? all.minY - b.minY : how === 'bottom' ? all.maxY - b.maxY : how === 'middle' ? (all.minY + all.maxY) / 2 - (b.minY + h / 2) : 0;
    return dx || dy ? { ...i, x: Math.round((i.x + dx) * 1000) / 1000, y: Math.round((i.y + dy) * 1000) / 1000 } : i;
  });
  return withSet(project, changed);
};

/** Space items evenly between the outermost two, by centre. */
export const distributeItems = (project: Project, ids: readonly string[], axis: 'x' | 'y'): Project => {
  const set = levelsOf(project);
  const free = set.items.filter((i) => ids.includes(i.id) && !i.host && !i.locked).sort((a, b) => a[axis] - b[axis]);
  if (free.length < 3) return project;
  const first = free[0]![axis];
  const step = (free[free.length - 1]![axis] - first) / (free.length - 1);
  const at = new Map(free.map((i, n) => [i.id, Math.round((first + step * n) * 1000) / 1000]));
  return withSet(project, mapItems(set, [...at.keys()], (i) => ({ ...i, [axis]: at.get(i.id)! })));
};

/** Copies with new GUIDs and serials, offset so they can be seen. A room's doors come with it. */
export const duplicateItems = (project: Project, ids: readonly string[], offset: Point = { x: 1, y: 1 }): { project: Project; ids: string[] } => {
  let set = levelsOf(project);
  const chosen = new Set(ids);
  // Doors and windows of chosen rooms come along.
  for (const i of set.items) if (i.host && chosen.has(i.host.id)) chosen.add(i.id);
  const originals = set.items.filter((i) => chosen.has(i.id));
  const idMap = new Map(originals.map((i) => [i.id, guid()]));
  const groupMap = new Map<string, string>();
  const copies: LevelItem[] = [];
  for (const o of originals) {
    const def = findAsset(o.assetId, set.assets);
    const { serial, counters } = next(set, def?.naming ?? 'prop');
    set = { ...set, counters };
    const copy: LevelItem = {
      ...o,
      id: idMap.get(o.id)!,
      serial,
      name: uniqueName({ ...set, items: [...set.items, ...copies] }, o.levelId, o.name.replace(/ \d+$/, '')),
      x: o.host ? o.x : Math.round((o.x + offset.x) * 1000) / 1000,
      y: o.host ? o.y : Math.round((o.y + offset.y) * 1000) / 1000,
    };
    delete copy.exportName;
    if (o.host) copy.host = { ...o.host, id: idMap.get(o.host.id) ?? o.host.id };
    if (o.groupId) {
      if (!groupMap.has(o.groupId)) groupMap.set(o.groupId, guid());
      copy.groupId = groupMap.get(o.groupId)!;
    }
    copies.push(copy);
  }
  const made = [...set.items, ...copies];
  return { project: withSet(project, revalidate({ ...set, items: made }, copies.map((c) => c.id))), ids: ids.map((id) => idMap.get(id)).filter((id): id is string => !!id) };
};

/** What removing these items takes with it: the doors and windows in rooms being removed. */
export const removalOf = (project: Project, ids: readonly string[]): LevelItem[] => {
  const set = levelsOf(project);
  const gone = new Set(ids);
  return set.items.filter((i) => i.host && gone.has(i.host.id) && !gone.has(i.id));
};

export const removeItems = (project: Project, ids: readonly string[]): Project => {
  const set = levelsOf(project);
  const gone = new Set(ids);
  for (const i of set.items) if (i.host && gone.has(i.host.id)) gone.add(i.id);
  if (!set.items.some((i) => gone.has(i.id))) return project;
  // Rules elsewhere that act on a removed item are left to validation to point out;
  // timeline events that happened there lose the place.
  return forgetPlaces(withSet(project, { ...set, items: set.items.filter((i) => !gone.has(i.id)) }), gone);
};

export const groupItems = (project: Project, ids: readonly string[]): Project => {
  if (ids.length < 2) return project;
  const groupId = guid();
  const set = levelsOf(project);
  return withSet(project, mapItems(set, ids, (i) => ({ ...i, groupId })));
};

export const ungroupItems = (project: Project, ids: readonly string[]): Project => {
  const set = levelsOf(project);
  return withSet(project, mapItems(set, ids, (i) => {
    if (!i.groupId) return i;
    const n = { ...i };
    delete n.groupId;
    return n;
  }));
};

/** Everything in the same groups as these items: clicking one picks up the group. */
export const withGroups = (project: Project, ids: readonly string[]): string[] => {
  const set = levelsOf(project);
  const groups = new Set(set.items.filter((i) => ids.includes(i.id) && i.groupId).map((i) => i.groupId));
  return [...new Set([...ids, ...set.items.filter((i) => i.groupId && groups.has(i.groupId)).map((i) => i.id)])];
};

// ---------------------------------------------------------------- inherited and overridden values

export const setParam = (project: Project, id: string, key: string, value: ParamValue, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === id);
  if (!item) return project;
  const def = assetOf(set, item, global).params.find((p) => p.key === key);
  const params = { ...item.params };
  // Setting a value back to what the library says is the same as resetting it.
  if (def && def.default === value) delete params[key];
  else params[key] = value;
  return updateItem(project, id, { params }, global);
};

export const resetParam = (project: Project, id: string, key: string, global?: readonly AssetDefinition[]): Project => {
  const item = itemById(project, id);
  if (!item?.params || !(key in item.params)) return project;
  const params = { ...item.params };
  delete params[key];
  return updateItem(project, id, { params }, global);
};

/** Back to the library's size on one axis, or all. */
export const resetSize = (project: Project, id: string, axis?: keyof Size, global?: readonly AssetDefinition[]): Project => {
  const item = itemById(project, id);
  if (!item?.size) return project;
  const size = { ...item.size };
  if (axis) delete size[axis];
  const set = levelsOf(project);
  const changed = mapItems(set, [id], (i) => {
    const n = { ...i };
    if (axis && Object.keys(size).length) n.size = size;
    else delete n.size;
    return n;
  });
  return withSet(project, revalidate(changed, [id], global));
};

export const isOverridden = (item: LevelItem, key: string): boolean => !!item.params && key in item.params;

// ---------------------------------------------------------------- the story

export const linkItem = (project: Project, id: string, objectId: string): Project => {
  const item = itemById(project, id);
  if (!item || !project.objects[objectId] || item.links?.includes(objectId)) return project;
  return updateItem(project, id, { links: [...(item.links ?? []), objectId] });
};

export const unlinkItem = (project: Project, id: string, objectId: string): Project => {
  const item = itemById(project, id);
  if (!item?.links?.includes(objectId)) return project;
  return updateItem(project, id, { links: item.links.filter((l) => l !== objectId) });
};

/** Items (and levels) that link to a story element, for "where it is in the levels". */
export const linkedTo = (project: Project, objectId: string): { items: LevelItem[]; levels: Level[] } => {
  const set = project.levels;
  if (!set) return { items: [], levels: [] };
  return {
    items: set.items.filter((i) => i.links?.includes(objectId) || Object.values(i.params ?? {}).includes(objectId)),
    levels: set.levels.filter((l) => l.links?.includes(objectId)),
  };
};

// ---------------------------------------------------------------- the project library (spec §4.4)

/**
 * Save items as a project asset. One item becomes a template with its
 * changes as the new defaults; several become an assembly placed as a group.
 */
export const saveToLibrary = (project: Project, ids: readonly string[], name: string, global?: readonly AssetDefinition[]): { project: Project; assetId: string } => {
  const set = levelsOf(project);
  const chosen = new Set(ids);
  for (const i of set.items) if (i.host && chosen.has(i.host.id)) chosen.add(i.id);
  const items = set.items.filter((i) => chosen.has(i.id));
  if (!items.length) return { project, assetId: '' };
  const id = `project.${guid().slice(0, 8)}`;
  let asset: AssetDefinition;
  if (items.length === 1 && !items[0]!.host) {
    const item = items[0]!;
    const def = assetOf(set, item, global);
    asset = {
      ...def,
      id,
      name,
      category: 'custom',
      source: 'project',
      version: 1,
      size: sizeOf(set, item, global),
      ...(outlineOf(set, item, global) ? { outline: outlineOf(set, item, global) } : {}),
      params: def.params.map((p) => (item.params && p.key in item.params ? { ...p, default: item.params[p.key]! } : p)),
      description: `Saved from ${item.name} (${def.name}).`,
    };
  } else {
    const frames = items.filter((i) => !i.host).map((i) => frameOf(set, i, global));
    const b = boundsOf(frames.flatMap(corners));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const parts: AssemblyPart[] = items.map((i) => {
      const f = frameOf(set, i, global);
      return {
        assetId: i.assetId,
        name: i.name,
        dx: Math.round((f.x - cx) * 1000) / 1000,
        dy: Math.round((f.y - cy) * 1000) / 1000,
        dz: i.z,
        rotation: i.host ? 0 : i.rotation,
        ...(i.size ? { size: i.size } : {}),
        ...(i.params ? { params: i.params } : {}),
        ...(i.outline ? { outline: i.outline } : {}),
      };
    });
    const tallest = Math.max(...items.map((i) => sizeOf(set, i, global).h));
    asset = {
      id,
      name,
      category: 'custom',
      kind: 'assembly',
      role: 'assembly',
      naming: 'prop',
      size: { w: Math.round((b.maxX - b.minX) * 100) / 100, d: Math.round((b.maxY - b.minY) * 100) / 100, h: tallest },
      proxy: 'none',
      params: [],
      engine: { godot: 'Packed scene of its parts', unity: 'Prefab of its parts', unreal: 'Level instance / Blueprint of its parts' },
      description: `${items.length} pieces: ${[...new Set(items.map((i) => assetOf(set, i, global).name))].join(', ')}.`,
      source: 'project',
      version: 1,
      parts,
    };
  }
  return { project: withSet(project, { ...set, assets: [...set.assets, asset] }), assetId: id };
};

/**
 * Change a project asset's defaults. Instances keep what they changed; the
 * rest follows (spec §4.3). What the version gave before is kept, so items
 * placed from it can be shown what changed and keep what they had.
 */
export const updateAsset = (project: Project, assetId: string, patch: Partial<Pick<AssetDefinition, 'name' | 'size' | 'params' | 'description' | 'outline'>>): Project => {
  const set = levelsOf(project);
  const snapshot = (a: AssetDefinition): AssetSnapshot => ({
    version: a.version,
    size: { ...a.size },
    defaults: Object.fromEntries(a.params.map((p) => [p.key, p.default])),
    ...(a.outline ? { outline: a.outline.map((p) => ({ ...p })) } : {}),
  });
  return withSet(project, {
    ...set,
    assets: set.assets.map((a) => {
      if (a.id !== assetId) return a;
      const next: AssetDefinition = { ...a, ...patch, version: a.version + 1, history: [...(a.history ?? []), snapshot(a)].slice(-20) };
      if ('outline' in patch && !patch.outline) delete next.outline;
      return next;
    }),
  });
};

export const removeAsset = (project: Project, assetId: string): Project => {
  const set = levelsOf(project);
  return withSet(project, { ...set, assets: set.assets.filter((a) => a.id !== assetId) });
};

/** Put doors and windows of a freshly placed assembly back into the nearest walls. */
const rehostAll = (set: LevelSet, ids: readonly string[], global?: readonly AssetDefinition[]): LevelSet => {
  let out = set;
  for (const id of ids) {
    const item = out.items.find((i) => i.id === id)!;
    const def = assetOf(out, item, global);
    if (def.kind !== 'hosted') continue;
    const host = nearestWall({ ...out, items: out.items.filter((i) => ids.includes(i.id) || !i.host) }, item.levelId, item.floorId, item, 0.6, global);
    out = mapItems(out, [id], (i) => (host ? { ...i, host } : { ...i, invalid: 'Not in a wall. Drag it onto a room’s wall.' }));
  }
  return revalidate(out, ids, global);
};
