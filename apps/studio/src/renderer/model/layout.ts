import type { Lane, ObjectType, Project } from './types';

/**
 * Track geometry in world units (1 unit = 1px at 100% zoom). The Level lane's
 * top edge is y = 0 with the spine right under it; branches float above
 * (negative y), lanes stack below.
 */
export const SPINE_HEIGHT = 150;
export const LANE_GAP = 16;
export const LANE_HEIGHT: Record<Lane['kind'], number> = { spine: SPINE_HEIGHT, subplot: 100, character: 80, level: 64 };

/** The gap packing keeps between neighbours on a track. */
export const NODE_GAP = 20;

/** Room kept before the first beat on an empty subplot lane. */
export const SPAN_PAD = 28;

/** Branch nodes stay at least this far above the spine. */
export const BRANCH_CLEARANCE = 24;

export interface Size {
  w: number;
  h: number;
}

export const nodeSize = (type: ObjectType, laneKind: Lane['kind'] = 'spine'): Size => {
  switch (type) {
    case 'choice':
      return { w: 32, h: 32 };
    case 'arcEvent':
      return { w: 100, h: 34 };
    // The Beginning and the Ending are plot points like the rest.
    case 'begin':
    case 'end':
    case 'plotPoint':
      return laneKind === 'subplot' ? { w: 120, h: 56 } : { w: 100, h: 64 };
    default:
      return laneKind === 'subplot' ? { w: 120, h: 56 } : { w: 120, h: 64 };
  }
};

export interface LaneRow {
  lane: Lane;
  top: number;
  height: number;
}

/** Which kind goes first when two lanes share an order. */
const LANE_RANK: Record<Lane['kind'], number> = { spine: 0, subplot: 1, character: 1, level: 2 };

/** Visible tracks top to bottom, in the order they have been arranged in (they can be dragged). */
export const laneRows = (project: Project): LaneRow[] => {
  const rows: LaneRow[] = [];
  let top = 0;
  const lanes = [...project.lanes]
    .filter((lane) => lane.visible || lane.kind === 'spine' || lane.kind === 'level')
    .sort((a, b) => a.order - b.order || LANE_RANK[a.kind] - LANE_RANK[b.kind]);
  for (const lane of lanes) {
    const height = LANE_HEIGHT[lane.kind];
    rows.push({ lane, top, height });
    top += height + LANE_GAP;
  }
  return rows;
};

export const spineLane = (project: Project): Lane => {
  const lane = project.lanes.find((l) => l.kind === 'spine');
  if (!lane) throw new Error('A project always has a spine');
  return lane;
};

/** The ids on a track, in narrative (left-to-right) order. */
export const laneSequence = (project: Project, laneId: string): string[] =>
  Object.entries(project.placements)
    .filter(([id, p]) => p.laneId === laneId && project.objects[id])
    .sort(([, a], [, b]) => a.x - b.x)
    .map(([id]) => id);

export const spineSequence = (project: Project): string[] => laneSequence(project, spineLane(project).id);

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far right of everything else the Endings column stands, and the gap between its endings. */
export const ENDINGS_GAP = 200;
export const ENDING_STEP = 84;
/** How wide the Endings column is drawn, around its endings. */
export const ENDINGS_WIDTH = 210;

/** An ending in the Endings column: an Ending off every track, which the story ties into. */
export const isColumnEnding = (project: Project, id: string): boolean => project.objects[id]?.type === 'end' && project.placements[id]?.laneId === null;

/** The endings in the column, top to bottom (by where each was put). */
export const columnEndings = (project: Project): string[] =>
  Object.keys(project.placements)
    .filter((id) => isColumnEnding(project, id))
    .sort((a, b) => project.placements[a]!.y - project.placements[b]!.y || a.localeCompare(b));

/**
 * The Endings column (a vertical lane at the right of the story): where it
 * stands, beyond everything on the tracks and branches, and its endings top
 * to bottom. Worked out once per project.
 */
/**
 * The Endings rail: on the story graph the endings stand in a panel at the
 * right of the screen, whatever the pan and zoom, so the canvas gives the
 * column's place in world units for its current view (rows carry it).
 */
export interface EndingsRail {
  x: number;
  top: number;
  step: number;
  w: number;
  h: number;
}
export type RailRows = LaneRow[] & { rail?: EndingsRail };
export const withRail = (rows: LaneRow[], rail: EndingsRail | undefined): RailRows => (rail ? Object.assign([...rows], { rail }) : rows);

const columns = new WeakMap<Project, { x: number; top: number; ids: string[] }>();
export const endingsColumn = (project: Project, rows: RailRows = laneRows(project)): { x: number; top: number; ids: string[]; step?: number; w?: number; h?: number } => {
  if (rows.rail) return { ...rows.rail, ids: columnEndings(project) };
  const known = columns.get(project);
  if (known) return known;
  let right = 0;
  for (const [id, p] of Object.entries(project.placements)) {
    const o = project.objects[id];
    if (!o || isColumnEnding(project, id)) continue;
    if (p.laneId === null) right = Math.max(right, p.x + nodeSize(o.type).w);
    else {
      const row = rows.find((r) => r.lane.id === p.laneId);
      if (row) right = Math.max(right, p.x + nodeSize(o.type, row.lane.kind).w);
    }
  }
  const column = { x: right + ENDINGS_GAP, top: (rows[0]?.top ?? 0) + 12, ids: columnEndings(project) };
  columns.set(project, column);
  return column;
};

/** A node's box in world units. Track nodes are centred vertically in their band. */
export const nodeBox = (project: Project, id: string, rows: LaneRow[] = laneRows(project)): Box | null => {
  const object = project.objects[id];
  const placement = project.placements[id];
  if (!object || !placement) return null;
  if (placement.laneId === null && object.type === 'end') {
    const column = endingsColumn(project, rows);
    const at = column.ids.indexOf(id);
    const size = nodeSize('end');
    return { x: column.x, y: column.top + Math.max(0, at) * (column.step ?? ENDING_STEP), w: column.w ?? size.w, h: column.h ?? size.h };
  }
  if (placement.laneId === null) {
    const size = nodeSize(object.type);
    return { x: placement.x, y: placement.y, ...size };
  }
  const row = rows.find((r) => r.lane.id === placement.laneId);
  if (!row) return null;
  const size = nodeSize(object.type, row.lane.kind);
  return { x: placement.x, y: row.top + (row.height - size.h) / 2, ...size };
};

/** The world x range a subplot's span covers: centre of its start node to centre of its end node. */
export const spanRange = (project: Project, lane: Lane): { from: number; to: number } | null => {
  if (!lane.span) return null;
  const spineId = spineLane(project).id;
  const centre = (id: string): number | null => {
    const object = project.objects[id];
    const placement = project.placements[id];
    if (!object || !placement || placement.laneId !== spineId) return null;
    return placement.x + nodeSize(object.type).w / 2;
  };
  const from = centre(lane.span.startRef);
  const to = centre(lane.span.endRef);
  return from === null || to === null ? null : { from, to };
};

/**
 * The stretch of the spine a subplot runs alongside: the spine node at or
 * before its first beat to the one at or after its last. Null with no beats.
 */
export const subplotReach = (project: Project, lane: Lane): { startRef: string; endRef: string } | null => {
  if (lane.span) return lane.span;
  const beats = laneSequence(project, lane.id);
  const spine = spineSequence(project).filter((id) => project.objects[id]?.data.opening !== true);
  if (!beats.length || !spine.length) return null;
  const centre = (id: string, kind: Lane['kind']) => project.placements[id]!.x + nodeSize(project.objects[id]!.type, kind).w / 2;
  const first = centre(beats[0]!, 'subplot');
  const last = centre(beats[beats.length - 1]!, 'subplot');
  const before = [...spine].reverse().find((id) => centre(id, 'spine') <= first) ?? spine[0]!;
  const after = spine.find((id) => centre(id, 'spine') >= last) ?? spine[spine.length - 1]!;
  return { startRef: before, endRef: after };
};

/** Everything placed, for fitting the view. */
export const contentBounds = (project: Project): Box => {
  const rows = laneRows(project);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = 0;
  for (const id of Object.keys(project.placements)) {
    // The endings stand in their rail at the side of the screen, not in the story's space.
    if (isColumnEnding(project, id)) continue;
    const box = nodeBox(project, id, rows);
    if (!box) continue;
    minX = Math.min(minX, box.x);
    maxX = Math.max(maxX, box.x + box.w);
    minY = Math.min(minY, box.y);
  }
  const last = rows[rows.length - 1];
  const maxY = last ? last.top + last.height : SPINE_HEIGHT;
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 600, h: maxY };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};
