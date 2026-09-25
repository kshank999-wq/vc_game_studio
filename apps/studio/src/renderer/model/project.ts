import { CHARACTER_COLORS, COLORS, LANE_ACCEPTS } from './semantics';
import { NODE_GAP, laneSequence, nodeSize, spineLane, spineSequence } from './layout';
import type { Lane, LaneKind, ObjectType, Project, StoryObject } from './types';

/**
 * Operations on a project. Each takes a project and returns a new one (or the
 * same one when nothing changed), so undo is a list of past projects.
 */

const stamp = (): string => new Date().toISOString();

export const newId = (prefix: string): string => {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 12)}`;
};

const makeObject = (type: ObjectType, name: string, now: string, data: StoryObject['data'] = {}): StoryObject => ({
  id: newId(type === 'begin' || type === 'end' ? type : 'obj'),
  type,
  name,
  notes: '',
  created: now,
  modified: now,
  data,
});

/** Where a new project puts its three spine nodes. */
const START_X = 0;
const START_SPACING = 300;

/** A new project: the spine with Beginning, one plot point and Ending (spec §5). */
export const createProject = (name = 'Untitled Game', now = stamp()): Project => {
  const spine: Lane = {
    id: newId('lane'),
    kind: 'spine',
    name: 'Spine',
    subtitle: 'Main plot',
    color: COLORS.spine,
    order: 0,
    visible: true,
    locked: true,
  };
  const begin = makeObject('begin', 'Beginning', now);
  const plotPoint = makeObject('plotPoint', 'Plot Point 1', now, { code: 'PP1' });
  const end = makeObject('end', 'Ending', now);
  return {
    format: 'vcgs',
    version: 1,
    id: newId('proj'),
    name,
    objects: { [begin.id]: begin, [plotPoint.id]: plotPoint, [end.id]: end },
    lanes: [spine],
    connections: [],
    placements: {
      [begin.id]: { laneId: spine.id, x: START_X, y: 0 },
      [plotPoint.id]: { laneId: spine.id, x: START_X + START_SPACING, y: 0 },
      [end.id]: { laneId: spine.id, x: START_X + START_SPACING * 2, y: 0 },
    },
  };
};

// ---------------------------------------------------------------- codes

const CODE_FORMAT: Partial<Record<ObjectType, { prefix: string; pad: number }>> = {
  plotPoint: { prefix: 'PP', pad: 0 },
  scene: { prefix: 'SC-', pad: 2 },
  cinematic: { prefix: 'CIN-', pad: 2 },
  choice: { prefix: 'C', pad: 0 },
};
const SUBPLOT_POINT = { prefix: 'SP', pad: 0 };

const nextCode = (project: Project, format: { prefix: string; pad: number }): string => {
  const pattern = new RegExp(`^${format.prefix}(\\d+)$`);
  let highest = 0;
  for (const object of Object.values(project.objects)) {
    const match = object.data.code?.match(pattern);
    if (match?.[1]) highest = Math.max(highest, Number(match[1]));
  }
  return `${format.prefix}${String(highest + 1).padStart(format.pad, '0')}`;
};

const DEFAULT_NAME: Partial<Record<ObjectType, (code: string) => string>> = {
  plotPoint: (code) => `Plot Point ${code.replace(/\D/g, '')}`,
  scene: () => 'New scene',
  cinematic: () => 'New cinematic',
  choice: () => 'Choice',
};

// ---------------------------------------------------------------- placing

const laneById = (project: Project, laneId: string): Lane | undefined => project.lanes.find((l) => l.id === laneId);

export const canPlace = (project: Project, type: ObjectType, laneId: string): boolean => {
  const lane = laneById(project, laneId);
  if (!lane || (lane.locked && lane.kind !== 'spine')) return false;
  return LANE_ACCEPTS[lane.kind].includes(type);
};

/**
 * Keep a track in order without overlaps. Nodes are taken left to right by x
 * (on the spine Beginning is always first and Ending always last) and each is
 * pushed right just far enough to clear its neighbour. Nothing moves left.
 */
export const packLane = (project: Project, laneId: string): Project => {
  const lane = laneById(project, laneId);
  if (!lane) return project;
  const ids = laneSequence(project, laneId);
  if (lane.kind === 'spine') {
    const rank = (id: string): number => {
      const type = project.objects[id]?.type;
      return type === 'begin' ? -1 : type === 'end' ? 1 : 0;
    };
    ids.sort((a, b) => rank(a) - rank(b));
  }
  const placements = { ...project.placements };
  let changed = false;
  let edge = -Infinity;
  for (const id of ids) {
    const placement = placements[id];
    const object = project.objects[id];
    if (!placement || !object) continue;
    const x = Math.max(placement.x, edge);
    if (x !== placement.x) {
      placements[id] = { ...placement, x };
      changed = true;
    }
    edge = x + nodeSize(object.type, lane.kind).w + NODE_GAP;
  }
  return changed ? { ...project, placements } : project;
};

/** The leftmost x a spine node may take: just clear of Beginning. */
const spineFloor = (project: Project): number => {
  const beginId = spineSequence(project).find((id) => project.objects[id]?.type === 'begin');
  const begin = beginId ? project.placements[beginId] : undefined;
  return begin ? begin.x + nodeSize('begin').w + NODE_GAP : -Infinity;
};

/** Drop a new node from the palette onto a track at world x (its left edge). */
export const placeNew = (
  project: Project,
  type: ObjectType,
  laneId: string,
  x: number,
  now = stamp(),
): { project: Project; id: string } | null => {
  if (!canPlace(project, type, laneId)) return null;
  const lane = laneById(project, laneId);
  if (!lane) return null;
  const format = lane.kind === 'subplot' && type === 'plotPoint' ? SUBPLOT_POINT : CODE_FORMAT[type];
  const code = format ? nextCode(project, format) : undefined;
  const name =
    lane.kind === 'subplot' && type === 'plotPoint' ? 'Subplot beat' : (DEFAULT_NAME[type]?.(code ?? '') ?? 'Untitled');
  const object = makeObject(type, name, now, code ? { code } : {});
  const floor = lane.kind === 'spine' ? spineFloor(project) : -Infinity;
  const placed: Project = {
    ...project,
    objects: { ...project.objects, [object.id]: object },
    placements: { ...project.placements, [object.id]: { laneId, x: Math.max(Math.round(x), floor), y: 0 } },
  };
  return { project: packLane(placed, laneId), id: object.id };
};

/** Beginning and Ending are protected: their content is editable, their place is not. */
export const isProtected = (project: Project, id: string): boolean => {
  const type = project.objects[id]?.type;
  return type === 'begin' || type === 'end';
};

/** Slide a node along its track. Its new x decides its new place in the order. */
export const moveNode = (project: Project, id: string, x: number): Project => {
  const placement = project.placements[id];
  if (!placement || placement.laneId === null || isProtected(project, id)) return project;
  const lane = laneById(project, placement.laneId);
  if (!lane || (lane.locked && lane.kind !== 'spine')) return project;
  const floor = lane.kind === 'spine' ? spineFloor(project) : -Infinity;
  const nextX = Math.max(Math.round(x), floor);
  if (nextX === placement.x) return project;
  const moved = { ...project, placements: { ...project.placements, [id]: { ...placement, x: nextX } } };
  return packLane(moved, placement.laneId);
};

export const renameObject = (project: Project, id: string, name: string, now = stamp()): Project => {
  const object = project.objects[id];
  const trimmed = name.trim();
  if (!object || !trimmed || trimmed === object.name) return project;
  let next: Project = { ...project, objects: { ...project.objects, [id]: { ...object, name: trimmed, modified: now } } };
  // A character lane shows its character's name.
  if (object.type === 'character') {
    next = { ...next, lanes: next.lanes.map((l) => (l.characterId === id ? { ...l, name: trimmed } : l)) };
  }
  return next;
};

export const renameProject = (project: Project, name: string): Project => {
  const trimmed = name.trim();
  return !trimmed || trimmed === project.name ? project : { ...project, name: trimmed };
};

/** Subplot lanes whose span starts or ends at this spine node. */
export const spanDependents = (project: Project, id: string): Lane[] =>
  project.lanes.filter((l) => l.span && (l.span.startRef === id || l.span.endRef === id));

/**
 * Delete a node. A subplot that started or ended on it moves to the
 * neighbouring spine node, so no span is ever left pointing at nothing.
 */
export const removeObject = (project: Project, id: string): Project => {
  if (!project.objects[id] || isProtected(project, id)) return project;
  const sequence = spineSequence(project);
  const index = sequence.indexOf(id);
  const after = index >= 0 ? sequence[index + 1] : undefined;
  const before = index > 0 ? sequence[index - 1] : undefined;
  const lanes = project.lanes.map((lane) => {
    if (!lane.span) return lane;
    let { startRef, endRef } = lane.span;
    if (startRef === id) startRef = after ?? before ?? startRef;
    if (endRef === id) endRef = before ?? after ?? endRef;
    return startRef === lane.span.startRef && endRef === lane.span.endRef ? lane : { ...lane, span: { startRef, endRef } };
  });
  const objects = { ...project.objects };
  delete objects[id];
  const placements = { ...project.placements };
  delete placements[id];
  return {
    ...project,
    objects,
    placements,
    lanes,
    connections: project.connections.filter((c) => c.sourceId !== id && c.targetId !== id),
  };
};

// ---------------------------------------------------------------- lanes

/** Add a subplot or character lane below the others (HANDOFF: the bottom menu). */
export const addLane = (
  project: Project,
  kind: Exclude<LaneKind, 'spine'>,
  now = stamp(),
): { project: Project; laneId: string } => {
  const order = Math.max(0, ...project.lanes.map((l) => l.order)) + 1;
  const count = project.lanes.filter((l) => l.kind === kind).length + 1;
  const lane: Lane = {
    id: newId('lane'),
    kind,
    name: kind === 'subplot' ? `Subplot ${count}` : `Character ${count}`,
    subtitle: '',
    color: COLORS.subplot,
    order,
    visible: true,
    locked: false,
  };
  let objects = project.objects;
  if (kind === 'subplot') {
    // A new subplot starts at the first node after Beginning and runs to Ending;
    // its handles set where it really starts and stops.
    const sequence = spineSequence(project);
    const startRef = sequence[1] ?? sequence[0];
    const endRef = sequence[sequence.length - 1];
    if (startRef && endRef) lane.span = { startRef, endRef };
  } else {
    const used = new Set(project.lanes.map((l) => l.color.toUpperCase()));
    lane.color = CHARACTER_COLORS.find((c) => !used.has(c)) ?? CHARACTER_COLORS[count % CHARACTER_COLORS.length]!;
    // The lane follows a canonical character, which the Bible will list.
    const character = makeObject('character', lane.name, now, { color: lane.color });
    lane.characterId = character.id;
    objects = { ...objects, [character.id]: character };
  }
  return { project: { ...project, objects, lanes: [...project.lanes, lane] }, laneId: lane.id };
};

export type LanePatch = Partial<Pick<Lane, 'name' | 'subtitle' | 'visible' | 'locked'>>;

export const updateLane = (project: Project, laneId: string, patch: LanePatch, now = stamp()): Project => {
  const lane = laneById(project, laneId);
  if (!lane || lane.kind === 'spine') return project;
  const next: Lane = { ...lane, ...patch };
  if (patch.name !== undefined) {
    next.name = patch.name.trim() || lane.name;
  }
  if (patch.subtitle !== undefined) next.subtitle = patch.subtitle.trim();
  if (JSON.stringify(next) === JSON.stringify(lane)) return project;
  let result: Project = { ...project, lanes: project.lanes.map((l) => (l.id === laneId ? next : l)) };
  if (next.characterId && next.name !== lane.name) {
    result = renameObject(result, next.characterId, next.name, now);
  }
  return result;
};

/** Move one end of a subplot's span to another spine node. The start always stays before the end. */
export const setSpanEdge = (project: Project, laneId: string, edge: 'start' | 'end', ref: string): Project => {
  const lane = laneById(project, laneId);
  if (!lane?.span || lane.locked) return project;
  const sequence = spineSequence(project);
  const at = sequence.indexOf(ref);
  if (at < 0) return project;
  const span = { ...lane.span, [edge === 'start' ? 'startRef' : 'endRef']: ref };
  if (sequence.indexOf(span.startRef) >= sequence.indexOf(span.endRef)) return project;
  if (span.startRef === lane.span.startRef && span.endRef === lane.span.endRef) return project;
  return { ...project, lanes: project.lanes.map((l) => (l.id === laneId ? { ...l, span } : l)) };
};

/** Remove a lane and the nodes on it. A character lane's character stays in the project. */
export const removeLane = (project: Project, laneId: string): Project => {
  const lane = laneById(project, laneId);
  if (!lane || lane.kind === 'spine') return project;
  let next: Project = { ...project, lanes: project.lanes.filter((l) => l.id !== laneId) };
  for (const id of laneSequence(project, laneId)) next = removeObject(next, id);
  return next;
};

/** Nodes that would go with a lane, for the warning before removing it. */
export const laneNodeCount = (project: Project, laneId: string): number => laneSequence(project, laneId).length;

export { spineLane };
