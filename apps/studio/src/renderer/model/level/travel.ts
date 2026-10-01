import type { Project } from '../types';
import { evaluate, isEmpty, type PlayState } from '../rules';
import { frameOf, type Point } from './geometry';
import { guid, levelsOf, withSet } from './level';
import type { AssetDefinition, LevelSet, TravelKind, TravelLink, TravelTransition } from './types';

/**
 * Travel links (Level Designer spec V2 §5, §13): roads, trails, rivers,
 * routes, fast travel, progression paths, doors, elevators, portals,
 * cinematics and loading transitions. A link is a line on one map; its ends
 * can be tied to items there (and follow them when they move), and it can
 * take the player to another map. Locked, it opens when its rule holds.
 */

export const TRAVEL_KINDS: readonly { id: TravelKind; label: string; transition: TravelTransition; hint: string }[] = [
  { id: 'road', label: 'Road', transition: 'walk', hint: 'a made way, walked or ridden' },
  { id: 'trail', label: 'Trail', transition: 'walk', hint: 'a path on foot' },
  { id: 'river', label: 'River', transition: 'sail', hint: 'water: a barrier, or a way by boat' },
  { id: 'route', label: 'Route', transition: 'walk', hint: 'a way between places, any kind' },
  { id: 'progression', label: 'Progression path', transition: 'walk', hint: 'the order the story takes the player' },
  { id: 'fastTravel', label: 'Fast travel', transition: 'fade', hint: 'straight there once discovered' },
  { id: 'door', label: 'Door', transition: 'walk', hint: 'through a door to another place' },
  { id: 'elevator', label: 'Elevator / lift', transition: 'ride', hint: 'up or down' },
  { id: 'portal', label: 'Portal', transition: 'instant', hint: 'from one place to another at once' },
  { id: 'cinematic', label: 'Cinematic', transition: 'cinematic', hint: 'a cutscene takes the player there' },
  { id: 'loading', label: 'Loading transition', transition: 'loading', hint: 'a loading screen to a separate map' },
];

export const TRANSITIONS: readonly { id: TravelTransition; label: string }[] = [
  { id: 'walk', label: 'Walk / drive along it' },
  { id: 'ride', label: 'Ride (a lift, a cart)' },
  { id: 'sail', label: 'Sail' },
  { id: 'fade', label: 'Fade out and in' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'loading', label: 'Loading screen' },
  { id: 'instant', label: 'Instant' },
];

export const kindLabelOf = (kind: TravelKind): string => TRAVEL_KINDS.find((k) => k.id === kind)?.label ?? 'Route';

export const travelOf = (set: LevelSet, levelId: string): TravelLink[] => (set.travel ?? []).filter((t) => t.levelId === levelId);

export const travelById = (set: LevelSet, id: string): TravelLink | undefined => (set.travel ?? []).find((t) => t.id === id);

/** The links with an end at this item. */
export const travelAt = (set: LevelSet, itemId: string): TravelLink[] => (set.travel ?? []).filter((t) => t.from === itemId || t.to === itemId);

/** A link's points as drawn now: its ends where their items are (an end whose item is gone stays where it was). */
export const travelPoints = (set: LevelSet, link: TravelLink, global?: readonly AssetDefinition[]): Point[] => {
  const at = (id: string | undefined, fallback: Point | undefined): Point | undefined => {
    const item = id ? set.items.find((i) => i.id === id) : undefined;
    if (!item) return fallback;
    const f = frameOf(set, item, global);
    return { x: f.x, y: f.y };
  };
  const pts = link.points.map((p) => ({ ...p }));
  if (!pts.length) return pts;
  pts[0] = at(link.from, pts[0])!;
  pts[pts.length - 1] = at(link.to, pts[pts.length - 1])!;
  return pts;
};

/** How long it is along its points, in metres. */
export const travelLength = (points: readonly Point[]): number => points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);

/** Draw a link (spec V2 §5): two points or more, its ends tied to the items they were put on. */
export const addTravel = (
  project: Project,
  link: { levelId: string; floorId?: string; kind: TravelKind; points: Point[]; from?: string; to?: string; name?: string },
): { project: Project; id: string } => {
  const set = levelsOf(project);
  if (link.points.length < 2 || !set.levels.some((l) => l.id === link.levelId)) return { project, id: '' };
  const id = guid();
  const made: TravelLink = {
    id,
    levelId: link.levelId,
    ...(link.floorId ? { floorId: link.floorId } : {}),
    kind: link.kind,
    points: link.points.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 })),
    ...(link.from ? { from: link.from } : {}),
    ...(link.to && link.to !== link.from ? { to: link.to } : {}),
    ...(link.name ? { name: link.name } : {}),
    transition: TRAVEL_KINDS.find((k) => k.id === link.kind)?.transition ?? 'walk',
  };
  return { project: withSet(project, { ...set, travel: [...(set.travel ?? []), made] }), id };
};

export const updateTravel = (project: Project, id: string, patch: Partial<Omit<TravelLink, 'id' | 'levelId'>>): Project => {
  const set = levelsOf(project);
  return withSet(project, {
    ...set,
    travel: (set.travel ?? []).map((t) => {
      if (t.id !== id) return t;
      const next: TravelLink = { ...t, ...patch };
      for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
      return next;
    }),
  });
};

/** Move one of a link's points; an end moved by hand lets go of its item. */
export const moveTravelPoint = (project: Project, id: string, index: number, to: Point): Project => {
  const link = travelById(levelsOf(project), id);
  if (!link || !link.points[index]) return project;
  const points = link.points.map((p, i) => (i === index ? { x: Math.round(to.x * 1000) / 1000, y: Math.round(to.y * 1000) / 1000 } : p));
  return updateTravel(project, id, { points, ...(index === 0 ? { from: undefined } : {}), ...(index === points.length - 1 ? { to: undefined } : {}) });
};

export const removeTravel = (project: Project, ids: readonly string[]): Project => {
  const set = levelsOf(project);
  if (!(set.travel ?? []).some((t) => ids.includes(t.id))) return project;
  return withSet(project, { ...set, travel: (set.travel ?? []).filter((t) => !ids.includes(t.id)) });
};

/**
 * Whether the player can take it now (spec V2 §13): unlocked, or locked and
 * its rule holds (a link locked without a rule stays shut).
 */
export const canTravel = (link: TravelLink, state: PlayState): boolean => !link.locked || (!!link.unlockWhen && !isEmpty(link.unlockWhen) && evaluate(link.unlockWhen, state));

/** What a link is called on the map: its name, or its kind and where it goes. */
export const travelLabel = (set: LevelSet, link: TravelLink): string => {
  if (link.name) return link.name;
  const name = (id?: string) => (id ? set.items.find((i) => i.id === id)?.name : undefined);
  const a = name(link.from);
  const b = link.toMap ? set.levels.find((l) => l.id === link.toMap)?.name : name(link.to);
  return a && b ? `${kindLabelOf(link.kind)}: ${a} → ${b}` : kindLabelOf(link.kind);
};
