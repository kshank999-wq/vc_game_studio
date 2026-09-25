import type { Lane, ObjectType, Project } from './types';

/**
 * Track geometry in world units (1 unit = 1px at 100% zoom). The spine's top
 * edge is y = 0; branches float above it (negative y), lanes stack below.
 */
export const SPINE_HEIGHT = 150;
export const LANE_GAP = 16;
export const LANE_HEIGHT: Record<Lane['kind'], number> = { spine: SPINE_HEIGHT, subplot: 100, character: 80 };

/** The gap packing keeps between neighbours on a track. */
export const NODE_GAP = 20;

/** Room a subplot band keeps between its ends and its first and last beat. */
export const SPAN_PAD = 28;
/** The shortest a subplot band gets, so an empty one can still be dropped into. */
export const MIN_SPAN = 180;

/** Branch nodes stay at least this far above the spine. */
export const BRANCH_CLEARANCE = 24;

export interface Size {
  w: number;
  h: number;
}

export const nodeSize = (type: ObjectType, laneKind: Lane['kind'] = 'spine'): Size => {
  switch (type) {
    case 'begin':
    case 'end':
      return { w: 86, h: 36 };
    case 'choice':
      return { w: 32, h: 32 };
    case 'arcEvent':
      return { w: 100, h: 34 };
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

/** Visible tracks top to bottom: the spine first, then lanes by order. */
export const laneRows = (project: Project): LaneRow[] => {
  const rows: LaneRow[] = [];
  let top = 0;
  const lanes = [...project.lanes]
    .filter((lane) => lane.visible || lane.kind === 'spine')
    .sort((a, b) => (a.kind === 'spine' ? -1 : b.kind === 'spine' ? 1 : a.order - b.order));
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

/** A node's box in world units. Track nodes are centred vertically in their band. */
export const nodeBox = (project: Project, id: string, rows: LaneRow[] = laneRows(project)): Box | null => {
  const object = project.objects[id];
  const placement = project.placements[id];
  if (!object || !placement) return null;
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

/** Everything placed, for fitting the view. */
export const contentBounds = (project: Project): Box => {
  const rows = laneRows(project);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = 0;
  for (const id of Object.keys(project.placements)) {
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
