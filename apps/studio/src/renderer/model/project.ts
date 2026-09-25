import { BRANCH_ACCEPTS, CHARACTER_COLORS, COLORS, LANE_ACCEPTS } from './semantics';
import {
  BRANCH_CLEARANCE,
  MIN_SPAN,
  NODE_GAP,
  SPAN_PAD,
  laneSequence,
  nodeSize,
  spanRange,
  spineLane,
  spineSequence,
} from './layout';
import type { Connection, ConnectionKind, Lane, LaneKind, ObjectType, Project, StoryObject } from './types';

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

export const makeObject = (type: ObjectType, name: string, now: string, data: StoryObject['data'] = {}): StoryObject => ({
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
    lines: [],
    events: [],
    branches: [],
  };
};

// ---------------------------------------------------------------- codes

const CODE_FORMAT: Partial<Record<ObjectType, { prefix: string; pad: number }>> = {
  plotPoint: { prefix: 'PP', pad: 0 },
  scene: { prefix: 'SC-', pad: 2 },
  cinematic: { prefix: 'CIN-', pad: 2 },
  choice: { prefix: 'C', pad: 0 },
  dialogue: { prefix: 'DLG-', pad: 2 },
};
const SUBPLOT_POINT = { prefix: 'SP', pad: 0 };

export const nextCode = (project: Project, format: { prefix: string; pad: number }): string => {
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
  dialogue: () => 'New dialogue',
  arcEvent: () => 'Growth',
};

// ---------------------------------------------------------------- settling

const laneById = (project: Project, laneId: string | null): Lane | undefined =>
  laneId === null ? undefined : project.lanes.find((l) => l.id === laneId);

/**
 * Keep a track in order without overlaps. Nodes are taken left to right by x
 * (on the spine Beginning is always first and Ending always last) and each is
 * pushed right just far enough to clear its neighbour. Nothing moves left.
 */
export const packLane = (project: Project, laneId: string, floor = -Infinity): Project => {
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
  let edge = floor;
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

/** Move every spine node from `fromId` onward right by `delta`. */
const shiftSpineFrom = (project: Project, fromId: string, delta: number): Project => {
  const sequence = spineSequence(project);
  const at = sequence.indexOf(fromId);
  if (at < 0 || delta <= 0) return project;
  const placements = { ...project.placements };
  for (const id of sequence.slice(at)) {
    const placement = placements[id];
    if (placement) placements[id] = { ...placement, x: placement.x + Math.ceil(delta) };
  }
  return { ...project, placements };
};

/**
 * Bring the whole graph back into shape after any change: the spine in order,
 * and every subplot's beats inside its band. A subplot always rejoins the
 * spine, so when its beats need more room than the band has, the spine opens
 * up at the node it rejoins, and everything after that moves along.
 */
export const settle = (project: Project): Project => {
  let next = packLane(project, spineLane(project).id);
  for (let pass = 0; pass < 12; pass++) {
    let grew = false;
    const subplots = next.lanes
      .filter((l) => l.kind === 'subplot' && l.span)
      .map((l) => ({ lane: l, range: spanRange(next, l) }))
      .sort((a, b) => (a.range?.from ?? 0) - (b.range?.from ?? 0));
    for (const { lane } of subplots) {
      const range = spanRange(next, lane);
      if (!range || !lane.span) continue;
      next = packLane(next, lane.id, range.from + SPAN_PAD);
      const ids = laneSequence(next, lane.id);
      const last = ids[ids.length - 1];
      const lastPlacement = last ? next.placements[last] : undefined;
      const lastObject = last ? next.objects[last] : undefined;
      const needed =
        lastPlacement && lastObject
          ? lastPlacement.x + nodeSize(lastObject.type, 'subplot').w + SPAN_PAD
          : range.from + MIN_SPAN;
      if (needed > range.to + 0.5) {
        next = packLane(shiftSpineFrom(next, lane.span.endRef, needed - range.to), spineLane(next).id);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return next;
};

// ---------------------------------------------------------------- placing

/** `laneId` null means the open canvas above the spine, where branches float. */
export const canPlace = (project: Project, type: ObjectType, laneId: string | null): boolean => {
  if (laneId === null) return BRANCH_ACCEPTS.includes(type);
  const lane = laneById(project, laneId);
  if (!lane || (lane.locked && lane.kind !== 'spine')) return false;
  return LANE_ACCEPTS[lane.kind].includes(type);
};

/** The leftmost x a spine node may take: just clear of Beginning. */
const spineFloor = (project: Project): number => {
  const beginId = spineSequence(project).find((id) => project.objects[id]?.type === 'begin');
  const begin = beginId ? project.placements[beginId] : undefined;
  return begin ? begin.x + nodeSize('begin').w + NODE_GAP : -Infinity;
};

/** Branch nodes float above the spine, never on or below it. */
const branchY = (type: ObjectType, y: number): number => Math.min(Math.round(y), -nodeSize(type).h - BRANCH_CLEARANCE);

/** The spine node whose centre is nearest x: what an arc event ties to when it lands. */
const nearestSpineNode = (project: Project, x: number): string | undefined => {
  let best: string | undefined;
  let distance = Infinity;
  for (const id of spineSequence(project)) {
    const object = project.objects[id];
    const placement = project.placements[id];
    if (!object || !placement || object.type === 'begin' || object.type === 'end') continue;
    const d = Math.abs(placement.x + nodeSize(object.type).w / 2 - x);
    if (d < distance) {
      best = id;
      distance = d;
    }
  }
  return best;
};

/**
 * Drop a new node from the palette at world (x, y), its top-left corner. On a
 * track only x matters; above the spine it floats as a branch.
 */
export const placeNew = (
  project: Project,
  type: ObjectType,
  laneId: string | null,
  x: number,
  y = 0,
  now = stamp(),
): { project: Project; id: string } | null => {
  if (!canPlace(project, type, laneId)) return null;
  const lane = laneById(project, laneId);
  if (laneId !== null && !lane) return null;
  const inSubplot = lane?.kind === 'subplot';
  const format = inSubplot && type === 'plotPoint' ? SUBPLOT_POINT : CODE_FORMAT[type];
  const code = format ? nextCode(project, format) : undefined;
  const name = inSubplot && type === 'plotPoint' ? 'Subplot beat' : (DEFAULT_NAME[type]?.(code ?? '') ?? 'Untitled');
  const data: StoryObject['data'] = code ? { code } : {};
  if (type === 'arcEvent') data.polarity = 'up';
  const object = makeObject(type, name, now, data);

  let placeX = Math.round(x);
  if (lane?.kind === 'spine') placeX = Math.max(placeX, spineFloor(project));
  if (lane && inSubplot) {
    // Dropped past the band's end, a beat joins the end and the band grows to fit it.
    const range = spanRange(project, lane);
    if (range) placeX = Math.min(Math.max(placeX, range.from + SPAN_PAD), Math.max(range.from + SPAN_PAD, range.to - SPAN_PAD - nodeSize(type, 'subplot').w));
  }
  const placement = { laneId, x: placeX, y: laneId === null ? branchY(type, y) : 0 };
  let placed: Project = {
    ...project,
    objects: { ...project.objects, [object.id]: object },
    placements: { ...project.placements, [object.id]: placement },
  };
  if (laneId !== null) placed = packLane(placed, laneId);
  if (type === 'arcEvent') {
    const moment = nearestSpineNode(placed, placeX + nodeSize(type).w / 2);
    if (moment) {
      placed = {
        ...placed,
        connections: [...placed.connections, { id: newId('conn'), sourceId: object.id, targetId: moment, kind: 'arcEvent' }],
      };
    }
  }
  return { project: settle(placed), id: object.id };
};

/** Beginning and Ending are protected: their content is editable, their place is not. */
export const isProtected = (project: Project, id: string): boolean => {
  const type = project.objects[id]?.type;
  return type === 'begin' || type === 'end';
};

/**
 * Move a node. On a track it slides along, and its new x decides its place
 * in the order; a branch moves freely above the spine.
 */
export const moveNode = (project: Project, id: string, x: number, y?: number): Project => {
  const placement = project.placements[id];
  const object = project.objects[id];
  if (!placement || !object || isProtected(project, id)) return project;
  if (placement.laneId === null) {
    const nextX = Math.round(x);
    const nextY = branchY(object.type, y ?? placement.y);
    if (nextX === placement.x && nextY === placement.y) return project;
    return { ...project, placements: { ...project.placements, [id]: { ...placement, x: nextX, y: nextY } } };
  }
  const lane = laneById(project, placement.laneId);
  if (!lane || (lane.locked && lane.kind !== 'spine')) return project;
  const floor = lane.kind === 'spine' ? spineFloor(project) : -Infinity;
  const nextX = Math.max(Math.round(x), floor);
  if (nextX === placement.x) return project;
  const moved = { ...project, placements: { ...project.placements, [id]: { ...placement, x: nextX } } };
  return settle(packLane(moved, placement.laneId));
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

const patchData = (project: Project, id: string, patch: Partial<StoryObject['data']>, now = stamp()): Project => {
  const object = project.objects[id];
  if (!object) return project;
  const data = { ...object.data, ...patch };
  for (const key of Object.keys(patch)) if (patch[key] === undefined) delete data[key];
  return { ...project, objects: { ...project.objects, [id]: { ...object, data, modified: now } } };
};

/** Mark a branch node as an alternate ending or a game over (or clear it). */
export const setOutcome = (project: Project, id: string, outcome: 'ending' | 'gameOver' | null): Project => {
  const object = project.objects[id];
  if (!object || project.placements[id]?.laneId !== null || (object.data.outcome ?? null) === outcome) return project;
  return patchData(project, id, { outcome: outcome ?? undefined });
};

const POLARITY_NAME = { up: 'Growth', down: 'Setback', turn: 'Turning point' } as const;

/** Growth (+), setback (−) or turning point (◆). A default name follows the change. */
export const setPolarity = (project: Project, id: string, polarity: 'up' | 'down' | 'turn'): Project => {
  const object = project.objects[id];
  if (!object || object.type !== 'arcEvent' || object.data.polarity === polarity) return project;
  let next = patchData(project, id, { polarity });
  if (Object.values(POLARITY_NAME).includes(object.name as never)) next = renameObject(next, id, POLARITY_NAME[polarity]);
  return next;
};

/** Subplot lanes whose span starts or ends at this spine node. */
export const spanDependents = (project: Project, id: string): Lane[] =>
  project.lanes.filter((l) => l.span && (l.span.startRef === id || l.span.endRef === id));

/**
 * Delete a node. A subplot that started or ended on it moves to the
 * neighbouring spine node, so no span is ever left pointing at nothing, and
 * connections to it go with it.
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
    if (endRef === id) endRef = after ?? before ?? endRef;
    if (startRef === endRef) {
      // A span needs two ends; widen it by one node rather than collapse it.
      const s = sequence.filter((n) => n !== id);
      const at = s.indexOf(startRef);
      if (at < s.length - 1) endRef = s[at + 1]!;
      else if (at > 0) startRef = s[at - 1]!;
    }
    return startRef === lane.span.startRef && endRef === lane.span.endRef ? lane : { ...lane, span: { startRef, endRef } };
  });
  const objects = { ...project.objects };
  delete objects[id];
  const placements = { ...project.placements };
  delete placements[id];
  return settle({
    ...project,
    objects,
    placements,
    lanes,
    connections: project.connections.filter((c) => c.sourceId !== id && c.targetId !== id),
    // A scene's script goes with it; a deleted speaker leaves the line to be reassigned.
    lines: project.lines
      .filter((l) => l.sceneId !== id)
      .map((l) => (l.speakerId === id ? { ...l, speakerId: null } : l)),
    // Its timeline goes with a scene; an event standing for the element goes with the element.
    events: project.events.filter((e) => e.sceneId !== id && e.refId !== id),
    branches: project.branches.filter((b) => b.sceneId !== id),
  });
};

// ---------------------------------------------------------------- connections

export type ConnectResult = { project: Project; id: string } | { error: string };

const laneKindOf = (project: Project, id: string): LaneKind | 'branch' | null => {
  const placement = project.placements[id];
  if (!placement) return null;
  if (placement.laneId === null) return 'branch';
  return laneById(project, placement.laneId)?.kind ?? null;
};

/** Can a drag from `sourceId`'s port end on `targetId`? Returns why not, or null. */
export const connectionRefusal = (project: Project, sourceId: string, targetId: string): string | null => {
  const source = project.objects[sourceId];
  const target = project.objects[targetId];
  if (!source || !target) return 'Nothing to connect to';
  if (sourceId === targetId) return 'A node can’t lead to itself';
  const from = laneKindOf(project, sourceId);
  const to = laneKindOf(project, targetId);
  if (target.type === 'begin') return 'Nothing leads back to Beginning';
  if (source.type === 'end') return 'The story ends at Ending';
  if (source.type === 'arcEvent' || target.type === 'arcEvent') {
    const other = source.type === 'arcEvent' ? target : source;
    const otherLane = source.type === 'arcEvent' ? to : from;
    if (other.type === 'arcEvent' || otherLane === 'character') return 'Tie an arc event to a story moment';
    if (other.type === 'begin' || other.type === 'end') return 'Tie an arc event to a plot point, choice or scene';
  } else {
    if (from === 'character' || to === 'character') return 'Character lanes connect through arc events';
    if (from === 'spine' && to === 'spine' && source.type !== 'choice') {
      return 'Spine nodes follow each other in track order; a choice can skip ahead';
    }
    const sourceLane = project.placements[sourceId]?.laneId;
    if (from === 'subplot' && sourceLane === project.placements[targetId]?.laneId) {
      return 'Beats on a subplot follow each other in order';
    }
  }
  const [a, b] = source.type !== 'arcEvent' && target.type === 'arcEvent' ? [targetId, sourceId] : [sourceId, targetId];
  if (project.connections.some((c) => c.sourceId === a && c.targetId === b)) return 'These are already connected';
  return null;
};

const kindFor = (project: Project, sourceId: string, targetId: string): ConnectionKind => {
  if (project.objects[sourceId]?.type === 'arcEvent') return 'arcEvent';
  const from = laneKindOf(project, sourceId);
  const to = laneKindOf(project, targetId);
  if ((from === 'subplot' && to === 'spine') || (from === 'spine' && to === 'subplot')) return 'laneTie';
  return 'branch';
};

/**
 * Connect two nodes (drag from a port to a node). Branches from a choice get
 * an option label for their pill. An arc event is always the source of its tie.
 */
export const connect = (project: Project, sourceId: string, targetId: string): ConnectResult => {
  const refusal = connectionRefusal(project, sourceId, targetId);
  if (refusal) return { error: refusal };
  let [from, to] = [sourceId, targetId];
  if (project.objects[to]?.type === 'arcEvent') [from, to] = [to, from];
  const kind = kindFor(project, from, to);
  const connection: Connection = { id: newId('conn'), sourceId: from, targetId: to, kind };
  if (kind === 'branch' && project.objects[from]?.type === 'choice') {
    const options = project.connections.filter((c) => c.sourceId === from && c.kind === 'branch').length;
    connection.label = `Option ${options + 1}`;
  }
  return { project: { ...project, connections: [...project.connections, connection] }, id: connection.id };
};

export const relabelConnection = (project: Project, id: string, label: string): Project => {
  const trimmed = label.trim();
  const connection = project.connections.find((c) => c.id === id);
  if (!connection || (connection.label ?? '') === trimmed) return project;
  return {
    ...project,
    connections: project.connections.map((c) => {
      if (c.id !== id) return c;
      const next: Connection = { ...c, label: trimmed };
      if (!trimmed) delete next.label;
      return next;
    }),
  };
};

export const removeConnection = (project: Project, id: string): Project =>
  project.connections.some((c) => c.id === id)
    ? { ...project, connections: project.connections.filter((c) => c.id !== id) }
    : project;

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
    // A new subplot branches off the first node after Beginning and rejoins at
    // the next one; dropping beats in makes it longer.
    const sequence = spineSequence(project);
    const startRef = sequence[1] ?? sequence[0];
    const endRef = sequence[2] ?? sequence[sequence.length - 1];
    if (startRef && endRef && startRef !== endRef) lane.span = { startRef, endRef };
  } else {
    const used = new Set(project.lanes.map((l) => l.color.toUpperCase()));
    lane.color = CHARACTER_COLORS.find((c) => !used.has(c)) ?? CHARACTER_COLORS[count % CHARACTER_COLORS.length]!;
    // The lane follows a canonical character, which the Bible will list.
    const character = makeObject('character', lane.name, now, { color: lane.color });
    lane.characterId = character.id;
    objects = { ...objects, [character.id]: character };
  }
  return { project: settle({ ...project, objects, lanes: [...project.lanes, lane] }), laneId: lane.id };
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

/**
 * Move one end of a subplot to another spine node. The start always stays
 * before the end. The beats close up from the start, and if they still need
 * more room than the new ends give, the spine opens up to fit them.
 */
export const setSpanEdge = (project: Project, laneId: string, edge: 'start' | 'end', ref: string): Project => {
  const lane = laneById(project, laneId);
  if (!lane?.span || lane.locked) return project;
  const sequence = spineSequence(project);
  if (sequence.indexOf(ref) < 0) return project;
  const span = { ...lane.span, [edge === 'start' ? 'startRef' : 'endRef']: ref };
  if (sequence.indexOf(span.startRef) >= sequence.indexOf(span.endRef)) return project;
  if (span.startRef === lane.span.startRef && span.endRef === lane.span.endRef) return project;
  const placements = { ...project.placements };
  laneSequence(project, laneId).forEach((id, i) => (placements[id] = { ...placements[id]!, x: -1e9 + i }));
  return settle({ ...project, placements, lanes: project.lanes.map((l) => (l.id === laneId ? { ...l, span } : l)) });
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
