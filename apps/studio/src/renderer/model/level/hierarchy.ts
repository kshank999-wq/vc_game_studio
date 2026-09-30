import type { Project } from '../types';
import { assetOf, frameOf } from './geometry';
import { guid, levelsOf, withSet } from './level';
import type { AssetDefinition, Floor, Level, LevelItem, LevelSet, MapBoundary, MapKind, MapStatus } from './types';

/**
 * The spatial hierarchy (Level Designer spec V2 §4): a world holds regions,
 * a region levels, a level districts and buildings, a building its floors and
 * rooms. Every map is a Level; a child map says which map it is part of and
 * which item on that map it details, so its place and size come from there.
 * Everything here takes the project and returns a new one, one undo step each.
 */

export const MAP_KINDS: readonly { id: MapKind; label: string; plural: string }[] = [
  { id: 'world', label: 'World', plural: 'Worlds' },
  { id: 'region', label: 'Region', plural: 'Regions' },
  { id: 'level', label: 'Level', plural: 'Levels' },
  { id: 'district', label: 'District / town / dungeon', plural: 'Districts' },
  { id: 'building', label: 'Building / structure', plural: 'Buildings' },
  { id: 'interior', label: 'Interior', plural: 'Interiors' },
];

export const BOUNDARIES: readonly { id: MapBoundary; label: string; hint: string }[] = [
  { id: 'continuous', label: 'Continuous', hint: 'part of its parent’s space, always there' },
  { id: 'streamed', label: 'Streamed', hint: 'part of its parent’s space, loaded as the player nears it' },
  { id: 'instanced', label: 'Instanced', hint: 'its own copy for each visit (a dungeon run)' },
  { id: 'transition', label: 'Loaded by transition', hint: 'a separate map, reached through a door, portal or loading screen' },
  { id: 'mapOnly', label: 'Map only', hint: 'on the map for planning; never loaded' },
];

export const STATUSES: readonly { id: MapStatus; label: string }[] = [
  { id: 'empty', label: 'Empty' },
  { id: 'grayboxed', label: 'Grayboxed' },
  { id: 'detailed', label: 'Detailed' },
  { id: 'gameplay', label: 'Gameplay complete' },
  { id: 'final', label: 'Final' },
];

/** World sizes to start from (spec V2 §3): editable, and no engine limit. */
export interface WorldPreset {
  id: 'small' | 'medium' | 'large' | 'custom';
  label: string;
  size: number;
  grid: number;
  use: string;
}

export const WORLD_PRESETS: readonly WorldPreset[] = [
  { id: 'small', label: 'Small world / region', size: 10_000, grid: 100, use: 'one city, island, valley or district' },
  { id: 'medium', label: 'Medium world', size: 40_000, grid: 250, use: 'several towns, biomes and major destinations' },
  { id: 'large', label: 'Large world', size: 100_000, grid: 500, use: 'a large open world, divided into regions' },
  { id: 'custom', label: 'Custom', size: 5_000, grid: 50, use: 'any size you give it' },
];

export const kindOf = (level: Level | undefined): MapKind => level?.kind ?? 'level';
export const kindLabel = (kind: MapKind): string => MAP_KINDS.find((k) => k.id === kind)?.label.split(' /')[0] ?? 'Map';

/** What a child of this kind of map usually is (spec V2 §4): the next scale down. */
export const kindBelow = (kind: MapKind): MapKind => {
  const order: MapKind[] = ['world', 'region', 'level', 'district', 'building', 'interior'];
  return order[Math.min(order.length - 1, order.indexOf(kind) + 1)]!;
};

/** A new map's snap step, by its size: a hundredth of it, in a round number. */
const gridFor = (size: number): number => {
  const raw = size / 100;
  for (const step of [0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]) if (step >= raw) return step;
  return 1000;
};

export const parentOf = (set: LevelSet, id: string): Level | undefined => {
  const parentId = set.levels.find((l) => l.id === id)?.parentId;
  return parentId ? set.levels.find((l) => l.id === parentId) : undefined;
};

/** The maps directly inside this one. */
export const childrenOf = (set: LevelSet, id: string): Level[] => set.levels.filter((l) => l.parentId === id);

/** Every map under this one, at any depth. */
export const descendantsOf = (set: LevelSet, id: string): Level[] => {
  const out: Level[] = [];
  const walk = (at: string) => {
    for (const c of set.levels.filter((l) => l.parentId === at)) {
      if (out.includes(c) || c.id === id) continue;
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
};

/** From the top of the hierarchy down to this map: the breadcrumbs. */
export const pathTo = (set: LevelSet, id: string): Level[] => {
  const out: Level[] = [];
  let at = set.levels.find((l) => l.id === id);
  while (at && !out.includes(at)) {
    out.unshift(at);
    at = at.parentId ? set.levels.find((l) => l.id === at!.parentId) : undefined;
  }
  return out;
};

/** The map an item opens into (its child map), if any. */
export const childOfItem = (set: LevelSet, itemId: string): Level | undefined => set.levels.find((l) => l.anchorId === itemId);

/** The item on the parent map that stands for this map, if any. */
export const anchorOf = (set: LevelSet, level: Level): LevelItem | undefined => (level.anchorId ? set.items.find((i) => i.id === level.anchorId && i.levelId === level.parentId) : undefined);

/**
 * A map's extent, in metres: its own, or its anchor's size on the parent map
 * (so a region drawn 3 km across on the world is 3 km across when opened), or
 * none for a map without either.
 */
export const boundsOf = (set: LevelSet, level: Level, global?: readonly AssetDefinition[]): { w: number; d: number } | undefined => {
  if (level.width && level.depth) return { w: level.width, d: level.depth };
  const anchor = anchorOf(set, level);
  if (anchor) {
    const f = frameOf(set, anchor, global);
    return { w: level.width ?? f.w, d: level.depth ?? f.d };
  }
  return undefined;
};

/** A map's snap step: its own, or the project's. */
export const gridOf = (set: LevelSet, levelId: string | undefined): number => set.levels.find((l) => l.id === levelId)?.grid || set.settings.grid || 0.5;

/** Whether distances on this map read best in kilometres (spec V2 §12). */
export const isWorldScale = (set: LevelSet, level: Level | undefined, global?: readonly AssetDefinition[]): boolean => {
  if (!level) return false;
  const kind = kindOf(level);
  if (kind === 'world' || kind === 'region') return true;
  const b = boundsOf(set, level, global);
  return !!b && Math.max(b.w, b.d) >= 2000;
};

/**
 * How far along a map is (spec V2 §6), when not set by hand: empty with
 * nothing in it; grayboxed with spaces and solids; detailed once it has props
 * or lights; gameplay complete with a player start and something to do.
 */
export const statusOf = (set: LevelSet, level: Level, global?: readonly AssetDefinition[]): MapStatus => {
  if (level.status) return level.status;
  const items = set.items.filter((i) => i.levelId === level.id);
  const children = set.levels.filter((l) => l.parentId === level.id);
  if (!items.length && !children.length) return 'empty';
  const cats = new Set(items.map((i) => assetOf(set, i, global).category));
  const roles = new Set(items.map((i) => assetOf(set, i, global).role));
  if (roles.has('playerStart') && (cats.has('gameplay') || cats.has('logic') || cats.has('actors'))) return 'gameplay';
  if (cats.has('props') || cats.has('lighting')) return 'detailed';
  return 'grayboxed';
};

const addMap = (set: LevelSet, level: Omit<Level, 'serial'>): LevelSet => {
  const serial = (set.counters.level ?? 0) + 1;
  return { ...set, counters: { ...set.counters, level: serial }, levels: [...set.levels, { ...level, serial }] };
};

const groundFloor = (height = 3): Floor => ({ id: guid(), name: 'Ground', elevation: 0, height });

/** Start a world (spec V2 §3) from a preset, or a size of your own. */
export const createWorld = (
  project: Project,
  options: { preset: WorldPreset['id']; name?: string; width?: number; depth?: number; grid?: number; origin?: { x: number; y: number } },
): { project: Project; id: string } => {
  const preset = WORLD_PRESETS.find((p) => p.id === options.preset) ?? WORLD_PRESETS[0]!;
  const width = Math.max(1, options.width ?? preset.size);
  const depth = Math.max(1, options.depth ?? options.width ?? preset.size);
  const id = guid();
  const set = addMap(levelsOf(project), {
    id,
    name: options.name?.trim() || 'World',
    kind: 'world',
    width,
    depth,
    grid: options.grid ?? (options.preset === 'custom' ? gridFor(Math.max(width, depth)) : preset.grid),
    ...(options.origin ? { origin: options.origin } : {}),
    boundary: 'continuous',
    floors: [groundFloor(50)],
  });
  return { project: withSet(project, set), id };
};

/** A new map inside another, not tied to an item on it. */
export const addChildMap = (project: Project, parentId: string | undefined, kind?: MapKind, name?: string): { project: Project; id: string } => {
  const set = levelsOf(project);
  const parent = parentId ? set.levels.find((l) => l.id === parentId) : undefined;
  const k = kind ?? (parent ? kindBelow(kindOf(parent)) : 'level');
  const id = guid();
  const siblings = set.levels.filter((l) => l.parentId === parentId && kindOf(l) === k).length;
  return {
    project: withSet(project, addMap(set, { id, name: name?.trim() || `${kindLabel(k)} ${siblings + 1}`, kind: k, ...(parent ? { parentId: parent.id } : {}), floors: [groundFloor()] })),
    id,
  };
};

/**
 * Open an item as its own map (spec V2 §5, §8): its child map if it has one,
 * or a new one of the next scale down, named after it, the item's size, part
 * of the item's map. A building opens as one floor; add more there.
 */
export const openChildMap = (project: Project, itemId: string, kind?: MapKind, global?: readonly AssetDefinition[]): { project: Project; id: string; made: boolean } => {
  const set = levelsOf(project);
  const existing = childOfItem(set, itemId);
  if (existing) return { project, id: existing.id, made: false };
  const item = set.items.find((i) => i.id === itemId);
  const parent = item && set.levels.find((l) => l.id === item.levelId);
  if (!item || !parent) return { project, id: '', made: false };
  const k = kind ?? kindFromItem(set, item, parent, global);
  const f = frameOf(set, item, global);
  const id = guid();
  const floors = k === 'building' || k === 'interior' ? [{ ...groundFloor(Math.min(4, Math.max(2.4, f.h))), name: 'Ground floor' }] : [groundFloor()];
  return {
    project: withSet(
      project,
      addMap(set, {
        id,
        name: item.name,
        kind: k,
        parentId: parent.id,
        anchorId: item.id,
        grid: gridFor(Math.max(f.w, f.d)),
        boundary: k === 'building' || k === 'interior' ? 'continuous' : k === 'world' || k === 'region' ? 'streamed' : 'transition',
        floors,
      }),
    ),
    id,
    made: true,
  };
};

/** What an item on a map opens into: a building or room opens as a building, anything else the scale below its map. */
const kindFromItem = (set: LevelSet, item: LevelItem, parent: Level, global?: readonly AssetDefinition[]): MapKind => {
  const def = assetOf(set, item, global);
  const hint = String(item.params?.opens ?? '').trim();
  if (MAP_KINDS.some((k) => k.id === hint)) return hint as MapKind;
  if (def.role === 'room' || def.role === 'stairwell' || def.role === 'corridor' || def.role === 'arena') return 'interior';
  return kindBelow(kindOf(parent));
};

export const updateMap = (project: Project, id: string, patch: Partial<Omit<Level, 'id' | 'serial' | 'floors'>>): Project => {
  const set = levelsOf(project);
  return withSet(project, {
    ...set,
    levels: set.levels.map((l) => {
      if (l.id !== id) return l;
      const next: Level = { ...l, ...patch };
      for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
      return next;
    }),
  });
};

/**
 * Move a map under another (or to the top). A map can't go inside itself or
 * one of its own; it lets go of the item it detailed, which was on its old parent.
 */
export const moveMap = (project: Project, id: string, parentId: string | undefined): Project => {
  const set = levelsOf(project);
  if (id === parentId || (parentId && descendantsOf(set, id).some((d) => d.id === parentId))) return project;
  const level = set.levels.find((l) => l.id === id);
  if (!level || level.parentId === parentId) return project;
  return updateMap(project, id, { parentId, anchorId: undefined });
};

/** What deleting a map takes with it (spec V2 §15: warn first): its child maps, and every item on them all. */
export const removalOfMap = (set: LevelSet, id: string): { maps: Level[]; items: number } => {
  const maps = [set.levels.find((l) => l.id === id)!, ...descendantsOf(set, id)].filter(Boolean);
  const ids = new Set(maps.map((m) => m.id));
  return { maps, items: set.items.filter((i) => ids.has(i.levelId)).length };
};

/** Delete a map, its child maps and their items. */
export const removeMap = (project: Project, id: string): Project => {
  const set = levelsOf(project);
  const ids = new Set(removalOfMap(set, id).maps.map((m) => m.id));
  return withSet(project, { ...set, levels: set.levels.filter((l) => !ids.has(l.id)), items: set.items.filter((i) => !ids.has(i.levelId)) });
};

/** The child maps these items open into, which deleting the items would leave without their place. */
export const mapsOwnedBy = (set: LevelSet, itemIds: readonly string[]): Level[] => set.levels.filter((l) => l.anchorId && itemIds.includes(l.anchorId));

/**
 * A copy of a map and its items, beside the original under the same parent,
 * with new GUIDs (doors keep to their copied walls). Child maps stay with the original.
 */
export const duplicateMap = (project: Project, id: string): { project: Project; id: string } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === id);
  if (!level) return { project, id: '' };
  const floorIds = new Map(level.floors.map((f) => [f.id, guid()]));
  const itemIds = new Map(set.items.filter((i) => i.levelId === id).map((i) => [i.id, guid()]));
  const groupIds = new Map<string, string>();
  const copyId = guid();
  const items: LevelItem[] = set.items
    .filter((i) => i.levelId === id)
    .map((i) => {
      const { exportName: _e, ...rest } = i;
      const groupId = i.groupId ? (groupIds.get(i.groupId) ?? (groupIds.set(i.groupId, guid()), groupIds.get(i.groupId)!)) : undefined;
      return {
        ...rest,
        id: itemIds.get(i.id)!,
        levelId: copyId,
        floorId: floorIds.get(i.floorId) ?? i.floorId,
        ...(i.host ? { host: { ...i.host, id: itemIds.get(i.host.id) ?? i.host.id } } : {}),
        ...(groupId ? { groupId } : {}),
      };
    });
  const { anchorId: _a, ...rest } = level;
  const copy = addMap({ ...set, items: [...set.items, ...items] }, { ...rest, id: copyId, name: `${level.name} copy`, floors: level.floors.map((f) => ({ ...f, id: floorIds.get(f.id)! })) });
  return { project: withSet(project, copy), id: copyId };
};

// ---------------------------------------------------------------- the navigator tree (spec V2 §6)

export interface TreeNode {
  kind: 'map' | 'floor' | 'room';
  id: string;
  /** The map it is in (itself, for a map). */
  levelId: string;
  floorId?: string;
  name: string;
  mapKind?: MapKind;
  status?: MapStatus;
  favorite?: boolean;
  hidden?: boolean;
  locked?: boolean;
  children: TreeNode[];
}

/**
 * World › Region › Level › Building › Floor › Room. A map lists its child
 * maps; a map of more than one floor, or a building or interior, lists its
 * floors, and each floor its rooms (the spaces on it).
 */
export const navigatorTree = (set: LevelSet, global?: readonly AssetDefinition[]): TreeNode[] => {
  const seen = new Set<string>();
  const mapNode = (l: Level): TreeNode => {
    seen.add(l.id);
    const kind = kindOf(l);
    const rooms = (floorId: string): TreeNode[] =>
      set.items
        .filter((i) => i.levelId === l.id && i.floorId === floorId && assetOf(set, i, global).kind === 'space' && !childOfItem(set, i.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => ({ kind: 'room' as const, id: i.id, levelId: l.id, floorId, name: i.name, ...(i.hidden ? { hidden: true } : {}), ...(i.locked ? { locked: true } : {}), children: [] }));
    const floors = [...l.floors].sort((a, b) => b.elevation - a.elevation);
    const showFloors = floors.length > 1 || kind === 'building' || kind === 'interior';
    const inner: TreeNode[] = showFloors
      ? floors.map((f) => ({ kind: 'floor' as const, id: f.id, levelId: l.id, floorId: f.id, name: f.name, children: rooms(f.id) }))
      : kind === 'world' || kind === 'region'
        ? []
        : rooms(floors[0]?.id ?? '');
    const kids = set.levels.filter((c) => c.parentId === l.id && !seen.has(c.id)).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.serial - b.serial);
    return {
      kind: 'map',
      id: l.id,
      levelId: l.id,
      name: l.name,
      mapKind: kind,
      status: statusOf(set, l, global),
      ...(l.favorite ? { favorite: true } : {}),
      ...(l.hidden ? { hidden: true } : {}),
      ...(l.locked ? { locked: true } : {}),
      children: [...kids.map(mapNode), ...inner],
    };
  };
  const roots = set.levels.filter((l) => !l.parentId || !set.levels.some((p) => p.id === l.parentId));
  return roots.sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite) || a.serial - b.serial).map(mapNode);
};

/** The tree with only what matches a search (and what leads to it), ignoring case. */
export const filterTree = (nodes: readonly TreeNode[], query: string, only?: { favorites?: boolean }): TreeNode[] => {
  const q = query.trim().toLowerCase();
  const keep = (n: TreeNode): TreeNode | null => {
    const children = n.children.map(keep).filter((c): c is TreeNode => !!c);
    const hit = (!q || n.name.toLowerCase().includes(q)) && (!only?.favorites || n.kind !== 'map' || !!n.favorite);
    return hit || children.length ? { ...n, children } : null;
  };
  return q || only?.favorites ? nodes.map(keep).filter((c): c is TreeNode => !!c) : [...nodes];
};
