import { addLevel, levelsOf, updateLevel } from './level/level';
import { nodeSize, spineLane, spineSequence } from './layout';
import { bandRange, levelBands, levelLane, levelOf } from './level-of';
export { bandRange, levelBands, levelLane, levelOf } from './level-of';
import { newId, placeNew, plotStops } from './project';
import type { Lane, LevelBand, Project } from './types';

/**
 * The Level lane: the game's levels, each a band from one
 * spine plot point to another. A scene, cinematic or choice on the spine (or
 * branching off it) in that stretch happens in that level. Each level is a
 * map in the Level Designer as well, made when the level is added.
 */

const withBands = (project: Project, levels: LevelBand[]): Project => ({
  ...project,
  lanes: project.lanes.map((l) => (l.kind === 'level' ? { ...l, levels } : l)),
});

/** A spine node's centre, in world x. */
const centre = (project: Project, id: string): number | null => {
  const object = project.objects[id];
  const placement = project.placements[id];
  if (!object || !placement || placement.laneId !== spineLane(project).id) return null;
  return placement.x + nodeSize(object.type).w / 2;
};

const order = (project: Project, id: string) => spineSequence(project).indexOf(id);

/** Do two levels share any stretch of the spine? (Touching at a plot point is fine: one ends where the next begins.) */
const overlaps = (project: Project, a: { startRef: string; endRef: string }, b: { startRef: string; endRef: string }) =>
  order(project, a.startRef) < order(project, b.endRef) && order(project, b.startRef) < order(project, a.endRef);

/**
 * A new level: from where the last one ends (or Beginning) to the next plot
 * point, with its own map in the Level Designer. The spine is open until an
 * ending goes on it, so when every stretch has its level already, a new plot
 * point goes at the end of the spine for this one to run to. Null only when
 * the spine has closed on an ending and every stretch is taken.
 */
export const addLevelBand = (project: Project, name?: string): { project: Project; id: string; mapId: string } | null => {
  if (!levelLane(project)) return null;
  const stops = plotStops(project);
  const bands = levelBands(project);
  const lastEnd = bands.reduce<number>((at, b) => Math.max(at, stops.indexOf(b.endRef)), 0);
  const start = stops[lastEnd];
  let end = stops[lastEnd + 1];
  if (start && !end && project.objects[start]?.type !== 'end') {
    const at = project.placements[start]!.x + nodeSize(project.objects[start]!.type).w + 260;
    const placed = placeNew(project, 'plotPoint', spineLane(project).id, at);
    if (placed) {
      project = placed.project;
      end = placed.id;
    }
  }
  if (!start || !end) return null;
  const title = name?.trim() || `Level ${bands.length + 1}`;
  const made = addLevel(project, title);
  const band: LevelBand = { id: newId('lvl'), name: title, startRef: start, endRef: end, mapId: made.id };
  return { project: withBands(made.project, [...bands, band]), id: band.id, mapId: made.id };
};

/** Stretch one end of a level to another plot point. Refused when it would turn it inside out or run over another level. */
export const setBandEdge = (project: Project, bandId: string, edge: 'start' | 'end', ref: string): Project => {
  const bands = levelBands(project);
  const band = bands.find((b) => b.id === bandId);
  if (!band || !plotStops(project).includes(ref)) return project;
  const next = { ...band, [edge === 'start' ? 'startRef' : 'endRef']: ref };
  if (next.startRef === band.startRef && next.endRef === band.endRef) return project;
  if (order(project, next.startRef) >= order(project, next.endRef)) return project;
  if (bands.some((b) => b.id !== bandId && overlaps(project, b, next))) return project;
  return withBands(project, bands.map((b) => (b.id === bandId ? next : b)));
};

/** Rename a level, and its map with it. */
export const renameBand = (project: Project, bandId: string, name: string): Project => {
  const band = levelBands(project).find((b) => b.id === bandId);
  const title = name.trim();
  if (!band || !title || title === band.name) return project;
  let next = withBands(project, levelBands(project).map((b) => (b.id === bandId ? { ...b, name: title } : b)));
  if (band.mapId && levelsOf(next).levels.some((l) => l.id === band.mapId)) next = updateLevel(next, band.mapId, { name: title });
  return next;
};

/** Take a level off the lane. Its map stays in the Level Designer, with everything built in it. */
export const removeBand = (project: Project, bandId: string): Project => withBands(project, levelBands(project).filter((b) => b.id !== bandId));

/** The plot point nearest a world x, for dragging a level's end. */
export const nearestStop = (project: Project, x: number): string | null => {
  let best: string | null = null;
  let distance = Infinity;
  for (const id of plotStops(project)) {
    const c = centre(project, id);
    if (c === null) continue;
    const d = Math.abs(c - x);
    if (d < distance) {
      best = id;
      distance = d;
    }
  }
  return best;
};

/** What happens in a level: the story elements on the graph inside its band, left to right. */
export const inLevel = (project: Project, bandId: string): string[] =>
  Object.keys(project.placements)
    .filter((id) => levelOf(project, id)?.id === bandId)
    .sort((a, b) => project.placements[a]!.x - project.placements[b]!.x);
