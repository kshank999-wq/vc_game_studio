import { laneRows, laneSequence, nodeBox, spanRange, type Box, type LaneRow } from '../../model/layout';
import type { Connection, Project } from '../../model/types';

export interface Point {
  x: number;
  y: number;
}

type Side = 'top' | 'bottom' | 'left' | 'right';

const DIRECTION: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const anchor = (box: Box, side: Side): Point => {
  switch (side) {
    case 'top':
      return { x: box.x + box.w / 2, y: box.y };
    case 'bottom':
      return { x: box.x + box.w / 2, y: box.y + box.h };
    case 'left':
      return { x: box.x, y: box.y + box.h / 2 };
    case 'right':
      return { x: box.x + box.w, y: box.y + box.h / 2 };
  }
};

export interface Curve {
  d: string;
  mid: Point;
}

/** A cubic from a to b leaving and arriving along the given sides. */
export const curve = (a: Point, from: Side, b: Point, to: Side, bend?: number): Curve => {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const k = bend ?? Math.max(36, distance / 2.4);
  const da = DIRECTION[from];
  const db = DIRECTION[to];
  const c1 = { x: a.x + da.x * k, y: a.y + da.y * k };
  const c2 = { x: b.x + db.x * k, y: b.y + db.y * k };
  const mid = {
    x: 0.125 * a.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * b.x,
    y: 0.125 * a.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * b.y,
  };
  return { d: `M${a.x} ${a.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`, mid };
};

const isOnTrack = (project: Project, id: string): boolean => (project.placements[id]?.laneId ?? null) !== null;

/**
 * How a connection is drawn. Ties between tracks run vertically between a
 * node's bottom and the node below; branches leave a track node from its top
 * when they go up into the branch space, and arrive at a track node's top when
 * they rejoin; between branch nodes they run port (right) to left edge.
 */
export const connectionCurve = (project: Project, connection: Connection, rows: LaneRow[] = laneRows(project)): Curve | null => {
  const s = nodeBox(project, connection.sourceId, rows);
  const t = nodeBox(project, connection.targetId, rows);
  if (!s || !t) return null;
  if (connection.kind === 'arcEvent' || connection.kind === 'laneTie') {
    // Upper node's bottom to lower node's top.
    // Ties are short links between tracks, so they bend only as far as the gap is tall.
    const [upper, lower] = s.y <= t.y ? [s, t] : [t, s];
    const a = anchor(upper, 'bottom');
    const b = anchor(lower, 'top');
    return curve(a, 'bottom', b, 'top', Math.max(12, Math.abs(b.y - a.y) / 2));
  }
  const goingUp = t.y + t.h < s.y;
  const comingDown = s.y + s.h < t.y;
  const fromSide: Side = isOnTrack(project, connection.sourceId) && goingUp ? 'top' : 'right';
  const toSide: Side = isOnTrack(project, connection.targetId) && comingDown ? 'top' : 'left';
  return curve(anchor(s, fromSide), fromSide, anchor(t, toSide), toSide);
};

/** A connector being dragged out of a port, to the pointer. */
export const draftCurve = (source: Box, to: Point): Curve => {
  const a = anchor(source, 'right');
  return curve(a, 'right', to, to.x >= a.x ? 'left' : 'right');
};

export interface SubplotPath {
  laneId: string;
  color: string;
  /** Leaving the spine and coming back to it. */
  branchOff: string;
  rejoin: string;
  /** Through the band, beat to beat. */
  through: string;
  empty: boolean;
}

/** A subplot leaves the spine at its start node and always comes back at its end node. */
export const subplotPath = (project: Project, row: LaneRow, rows: LaneRow[]): SubplotPath | null => {
  const range = spanRange(project, row.lane);
  const span = row.lane.span;
  if (!range || !span) return null;
  const start = nodeBox(project, span.startRef, rows);
  const end = nodeBox(project, span.endRef, rows);
  if (!start || !end) return null;
  const y = row.top + row.height / 2;
  const r = 14;
  const down = anchor(start, 'bottom');
  const up = anchor(end, 'bottom');
  // Straight down out of the start node, round the corner into the band;
  // out of the band's far end, round the corner and straight back up.
  const branchOff = `M${down.x} ${down.y} V${y - r} Q${down.x} ${y} ${down.x + r} ${y}`;
  const rejoin = `M${up.x - r} ${y} Q${up.x} ${y} ${up.x} ${y - r} V${up.y}`;
  const beats = laneSequence(project, row.lane.id)
    .map((id) => nodeBox(project, id, rows))
    .filter((b): b is Box => b !== null);
  const points: string[] = [];
  let at = down.x + r;
  for (const beat of beats) {
    points.push(`M${at} ${y} H${beat.x}`);
    at = beat.x + beat.w;
  }
  points.push(`M${at} ${y} H${up.x - r}`);
  return {
    laneId: row.lane.id,
    color: row.lane.color,
    branchOff,
    rejoin,
    through: points.join(' '),
    empty: beats.length === 0,
  };
};
