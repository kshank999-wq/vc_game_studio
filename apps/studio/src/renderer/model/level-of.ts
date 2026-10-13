import { nodeSize, spineLane } from './layout';
import type { Lane, LevelBand, Project } from './types';

/** Which level of the Level lane things on the story graph happen in (light enough for any panel to use). */

export const levelLane = (project: Project): Lane | undefined => project.lanes.find((l) => l.kind === 'level');

export const levelBands = (project: Project): LevelBand[] => levelLane(project)?.levels ?? [];

/** A spine node's centre, in world x. */
const centre = (project: Project, id: string): number | null => {
  const object = project.objects[id];
  const placement = project.placements[id];
  if (!object || !placement || placement.laneId !== spineLane(project).id) return null;
  return placement.x + nodeSize(object.type).w / 2;
};

/** Where a level's band runs, in world x: from its first plot point's centre to its last one's. */
export const bandRange = (project: Project, band: LevelBand): { from: number; to: number } | null => {
  const from = centre(project, band.startRef);
  const to = centre(project, band.endRef);
  return from === null || to === null || to <= from ? null : { from, to };
};

/**
 * The level something on the story graph happens in: the band its middle
 * falls in. A plot point where one level ends and the next begins belongs to
 * the one it begins.
 */
export const levelOf = (project: Project, id: string): LevelBand | undefined => {
  const placement = project.placements[id];
  const object = project.objects[id];
  if (!placement || !object) return undefined;
  const x = placement.x + nodeSize(object.type).w / 2;
  const hits = levelBands(project).filter((b) => {
    const r = bandRange(project, b);
    return r && x >= r.from - 0.5 && x <= r.to + 0.5;
  });
  return hits.find((b) => b.startRef === id) ?? hits[0];
};


/**
 * Where each level ends on the spine, left to right: the plot point it ends
 * at, and the level that starts there (the transition), if one does.
 */
export const levelEnds = (project: Project): { id: string; name: string; at: string; x: number; next?: LevelBand }[] => {
  const bands = levelBands(project);
  return bands
    .map((band) => ({ band, range: bandRange(project, band) }))
    .filter((b): b is { band: LevelBand; range: { from: number; to: number } } => !!b.range)
    .sort((a, b) => a.range.from - b.range.from)
    .map(({ band, range }) => {
      const next = bands.find((b) => b.id !== band.id && b.startRef === band.endRef);
      return { id: band.id, name: band.name, at: band.endRef, x: range.to, ...(next ? { next } : {}) };
    });
};
