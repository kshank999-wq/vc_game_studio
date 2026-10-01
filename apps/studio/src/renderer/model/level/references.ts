import type { Project } from '../types';
import { boundsOf } from './hierarchy';
import { guid, levelsOf, withSet } from './level';
import type { AssetDefinition, Level, LevelSet, ReferenceImage, ReferenceKind } from './types';

/**
 * Reference images (spec V2 §10): an existing map, a floor plan, a heightmap
 * or a photo laid under a map to trace over. Each is placed and sized in
 * metres, so what is drawn over it comes out the right size. They stay in the
 * studio: the engines never get them.
 */

export const REFERENCE_KINDS: readonly { id: ReferenceKind; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'floorPlan', label: 'Floor plan' },
  { id: 'heightmap', label: 'Heightmap' },
  { id: 'photo', label: 'Photo / concept' },
];

/** What kind a file probably is, from its name. */
export const guessReferenceKind = (file: string): ReferenceKind => {
  const n = file.toLowerCase();
  if (/height|elev|dem|terrain/.test(n)) return 'heightmap';
  if (/floor|plan|blueprint|layout/.test(n)) return 'floorPlan';
  if (/photo|concept|sketch|img_|dsc/.test(n)) return 'photo';
  return 'map';
};

/** The references on a map, those on this floor (or on every floor) when one is given. */
export const referencesOf = (set: LevelSet, levelId: string, floorId?: string): ReferenceImage[] =>
  (set.levels.find((l) => l.id === levelId)?.references ?? []).filter((r) => !floorId || !r.floorId || r.floorId === floorId);

export const metresPerPixel = (r: ReferenceImage): number => (r.pixels.w > 0 ? r.width / r.pixels.w : 0);

/** How deep it is in metres: its width and the picture's proportions. */
export const referenceDepth = (r: ReferenceImage): number => (r.pixels.w > 0 ? (r.width * r.pixels.h) / r.pixels.w : r.width);

const editLevel = (project: Project, levelId: string, f: (l: Level) => Level): Project => {
  const set = levelsOf(project);
  if (!set.levels.some((l) => l.id === levelId)) return project;
  return withSet(project, { ...set, levels: set.levels.map((l) => (l.id === levelId ? f(l) : l)) });
};

/**
 * Lay a picture under a map. Unless told, it fills the map's extent (a world,
 * a region or a building's footprint) or else 50 m, centred on the map.
 */
export const addReference = (
  project: Project,
  levelId: string,
  ref: { name: string; image: string; pixels: { w: number; h: number }; kind?: ReferenceKind; floorId?: string; width?: number; x?: number; y?: number },
  global?: readonly AssetDefinition[],
): { project: Project; id: string } => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level || !ref.image) return { project, id: '' };
  const b = boundsOf(set, level, global);
  const aspect = ref.pixels.w > 0 && ref.pixels.h > 0 ? ref.pixels.h / ref.pixels.w : 1;
  // Fit the map's extent: as wide as it, or as deep, whichever the picture's shape allows.
  const width = ref.width ?? (b ? Math.min(b.w, b.d / aspect) : 50);
  const id = guid();
  const made: ReferenceImage = {
    id,
    name: ref.name || 'Reference',
    kind: ref.kind ?? guessReferenceKind(ref.name),
    image: ref.image,
    pixels: { w: Math.max(1, Math.round(ref.pixels.w)), h: Math.max(1, Math.round(ref.pixels.h)) },
    ...(ref.floorId ? { floorId: ref.floorId } : {}),
    x: ref.x ?? -(level.origin?.x ?? 0),
    y: ref.y ?? -(level.origin?.y ?? 0),
    width: Math.max(0.01, Math.round(width * 1000) / 1000),
    rotation: 0,
    opacity: 0.6,
  };
  return { project: editLevel(project, levelId, (l) => ({ ...l, references: [...(l.references ?? []), made] })), id };
};

export const updateReference = (project: Project, levelId: string, id: string, patch: Partial<Omit<ReferenceImage, 'id'>>): Project =>
  editLevel(project, levelId, (l) => ({
    ...l,
    references: (l.references ?? []).map((r) => {
      if (r.id !== id) return r;
      const next: ReferenceImage = { ...r, ...patch };
      for (const [key, value] of Object.entries(patch)) if (value === undefined) delete (next as unknown as Record<string, unknown>)[key];
      next.width = Math.max(0.01, next.width);
      next.opacity = Math.min(1, Math.max(0.05, next.opacity));
      return next;
    }),
  }));

/** Size it so this many metres is one pixel. */
export const setMetresPerPixel = (project: Project, levelId: string, id: string, mpp: number): Project => {
  const r = levelsOf(project).levels.find((l) => l.id === levelId)?.references?.find((x) => x.id === id);
  return r && mpp > 0 ? updateReference(project, levelId, id, { width: mpp * r.pixels.w }) : project;
};

/** Stretch it over the map's extent again. */
export const fitReference = (project: Project, levelId: string, id: string, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  const r = level?.references?.find((x) => x.id === id);
  const b = level && boundsOf(set, level, global);
  if (!r || !b) return project;
  const aspect = r.pixels.h / r.pixels.w;
  return updateReference(project, levelId, id, { width: Math.min(b.w, b.d / aspect), x: -(level!.origin?.x ?? 0), y: -(level!.origin?.y ?? 0), rotation: 0 });
};

export const removeReference = (project: Project, levelId: string, id: string): Project =>
  editLevel(project, levelId, (l) => {
    const left = (l.references ?? []).filter((r) => r.id !== id);
    const { references: _, ...rest } = l;
    return left.length ? { ...rest, references: left } : rest;
  });
