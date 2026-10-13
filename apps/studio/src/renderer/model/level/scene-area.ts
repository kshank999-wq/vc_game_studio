import { addChildMap, anchorOf, boundsOf, createWorld, kindOf, parentOf, pathTo, scaleOf, updateMap, type WorldPreset } from './hierarchy';
import { levelsOf, placeAsset, updateItem, withSet } from './level';
import type { AssetDefinition, Level, LevelItem, MapKind } from './types';
import type { ObjectType, Project } from '../types';

/**
 * Where a scene happens (the macro-to-micro flow): every scene is set in an
 * area of the game's maps (a level, a town, a building, a room inside a
 * region of the world). What the scene holds (its characters, objects,
 * choices, puzzles, logic) stands on that area's map, linked both ways. The
 * scene's pin goes on the map the area is part of (the region, the world), so
 * the scene shows up there to be placed and joined to other places by paths.
 */

/** The tag on the item that marks where a scene happens on its map. */
export const SCENE_PIN = 'scene-pin';

/** The map a scene is set in, if it has one that still exists. */
export const sceneMapOf = (project: Project, sceneId: string): Level | undefined => {
  const id = project.objects[sceneId]?.data.mapId;
  return typeof id === 'string' ? project.levels?.levels.find((l) => l.id === id) : undefined;
};

/** Where a scene's pin goes: the map its area is part of, or the area itself when that is the top. */
export const pinMapOf = (project: Project, sceneId: string): Level | undefined => {
  const map = sceneMapOf(project, sceneId);
  return map && project.levels ? (parentOf(project.levels, map.id) ?? map) : map;
};

/** The scene's pin. */
export const scenePinOf = (project: Project, sceneId: string): LevelItem | undefined => {
  const map = pinMapOf(project, sceneId);
  return map ? project.levels?.items.find((i) => i.levelId === map.id && i.tags?.includes(SCENE_PIN) && i.links?.includes(sceneId)) : undefined;
};

/** The middle of a map, in its own coordinates. */
const middleOf = (map: Level): { x: number; y: number } => ({ x: -(map.origin?.x ?? 0), y: -(map.origin?.y ?? 0) });

/** What stands for each kind of scene element on a map. */
export const MARKER_FOR: Partial<Record<ObjectType, string>> = {
  character: 'actor.npc',
  object: 'logic.interaction',
  inventory: 'play.item',
  choice: 'pres.dialogue',
  dialogue: 'pres.dialogue',
  puzzle: 'logic.puzzle',
  trigger: 'logic.trigger',
  gate: 'logic.gate',
  cinematic: 'pres.cinematic',
};

/** At a world's or a region's scale a pin is a destination; closer in, a route end. */
const pinAsset = (map: Level): string => (scaleOf(kindOf(map)) === 'world' ? 'world.destination' : 'nav.destination');

/**
 * Set a scene in a map. Its pin goes on the map that one is part of: on the
 * area's own spot there if it has one, else near the middle, clear of other
 * scenes' pins (drag it where the scene is). A pin it had elsewhere goes;
 * whatever else was placed for the scene stays where it is.
 */
export const setSceneMap = (project: Project, sceneId: string, mapId: string, global?: readonly AssetDefinition[]): Project => {
  const scene = project.objects[sceneId];
  const set = levelsOf(project);
  const map = set.levels.find((l) => l.id === mapId);
  if (!scene || !map) return project;
  if (scene.data.mapId === mapId && scenePinOf(project, sceneId)) return project;
  const items = set.items.filter((i) => !(i.tags?.includes(SCENE_PIN) && i.links?.includes(sceneId)));
  let next: Project = withSet(
    { ...project, objects: { ...project.objects, [sceneId]: { ...scene, data: { ...scene.data, mapId } } } },
    { ...set, items, levels: set.levels.map((l) => (l.id === mapId && !l.links?.includes(sceneId) ? { ...l, links: [...(l.links ?? []), sceneId] } : l)) },
  );
  const on = pinMapOf(next, sceneId)!;
  const floor = on.floors[0];
  if (!floor) return next;
  const anchor = on.id !== map.id ? anchorOf(levelsOf(next), map) : undefined;
  const others = levelsOf(next).items.filter((i) => i.levelId === on.id && i.tags?.includes(SCENE_PIN)).length;
  const span = boundsOf(levelsOf(next), on, global);
  const step = span ? Math.min(span.w, span.d) / 16 : 40;
  const middle = middleOf(on);
  const at = anchor ? { x: anchor.x, y: anchor.y } : { x: middle.x + step * (others % 4), y: middle.y + step * Math.floor(others / 4) };
  const placed = placeAsset(next, on.id, floor.id, pinAsset(on), at, { global });
  const pin = placed.ids[0];
  if (!pin) return next;
  next = updateItem(placed.project, pin, { name: scene.name, links: [sceneId], tags: [SCENE_PIN] }, global);
  return next;
};

/** How big a new area starts, by what it is, in metres, and its snap step. */
const AREA_SIZE: Partial<Record<MapKind, { w: number; grid: number }>> = {
  region: { w: 8000, grid: 50 },
  level: { w: 300, grid: 1 },
  district: { w: 600, grid: 2 },
  building: { w: 40, grid: 0.5 },
  interior: { w: 16, grid: 0.25 },
};

/** A new area for a scene, inside another map (or on its own), named after the scene by default. */
export const newSceneArea = (
  project: Project,
  sceneId: string,
  parentId: string | undefined,
  kind: MapKind,
  name?: string,
  global?: readonly AssetDefinition[],
): { project: Project; mapId: string } => {
  const made = addChildMap(project, parentId, kind, name?.trim() || project.objects[sceneId]?.name);
  const size = AREA_SIZE[kind];
  const sized = size ? updateMap(made.project, made.id, { width: size.w, depth: size.w, grid: size.grid }) : made.project;
  return { project: setSceneMap(sized, sceneId, made.id, global), mapId: made.id };
};

/** The world the game is set in, made first when there are no maps at all. */
export const newWorld = (project: Project, name: string, preset: WorldPreset['id']): { project: Project; mapId: string } => {
  const made = createWorld(project, { preset, name });
  return { project: made.project, mapId: made.id };
};

/** "World › Northern Forest › Cave Mouth": the map and the ones it is part of. */
export const areaPath = (project: Project, mapId: string): Level[] => (project.levels ? pathTo(project.levels, mapId) : []);

/** Items on a map that stand for one of this scene's elements (not its pin). */
export const placedFor = (project: Project, sceneId: string, mapId: string, elementId: string): LevelItem[] =>
  project.levels?.items.filter((i) => i.levelId === mapId && !i.tags?.includes(SCENE_PIN) && i.links?.includes(elementId) && i.links.includes(sceneId)) ?? [];

/** Put one of the scene's elements on its map, where it stands in the scene; null when the map is gone or the element has no marker. */
export const placeElement = (
  project: Project,
  sceneId: string,
  elementId: string,
  at: { x: number; y: number },
  global?: readonly AssetDefinition[],
): { project: Project; itemId: string } | null => {
  const map = sceneMapOf(project, sceneId);
  const element = project.objects[elementId];
  const asset = element && MARKER_FOR[element.type];
  const floor = map?.floors[0];
  if (!map || !element || !asset || !floor) return null;
  const placed = placeAsset(project, map.id, floor.id, asset, at, { global });
  const itemId = placed.ids[0];
  if (!itemId) return null;
  return { project: updateItem(placed.project, itemId, { name: element.name, links: [elementId, sceneId] }, global), itemId };
};

/** Where to put the next element on the map: around the middle (or the pin, when it is on the same map), a step apart, so they don't stack. */
export const nextSpot = (project: Project, sceneId: string, global?: readonly AssetDefinition[]): { x: number; y: number } => {
  const map = sceneMapOf(project, sceneId);
  if (!map || !project.levels) return { x: 0, y: 0 };
  const pin = scenePinOf(project, sceneId);
  const centre = pin && pin.levelId === map.id ? { x: pin.x, y: pin.y } : middleOf(map);
  const bounds = boundsOf(project.levels, map, global);
  const step = Math.max(1.5, (bounds ? Math.min(bounds.w, bounds.d) : 20) / 12);
  const taken = project.levels.items.filter((i) => i.levelId === map.id && i.links?.includes(sceneId) && !i.tags?.includes(SCENE_PIN)).length;
  const ring = Math.ceil(taken / 8) || 1;
  const angle = ((taken % 8) / 8) * Math.PI * 2;
  return { x: Math.round((centre.x + Math.cos(angle) * step * ring) * 100) / 100, y: Math.round((centre.y + Math.sin(angle) * step * ring) * 100) / 100 };
};
