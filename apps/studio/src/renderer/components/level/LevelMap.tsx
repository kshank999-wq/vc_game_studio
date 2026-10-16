import { patrolStops } from '../../model/level/actors';
import { levelCast } from '../../model/level/play';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { areaOf, assetOf, boundsOf, CATEGORY_COLOR, contains, corners, frameOf, INVALID_COLOR, meshesFor, num, outlineOf, paramOf, selfIntersects, toLocal, toPlan, triangulate, type Frame, type Point } from '../../model/level/geometry';
import { insertCorner, levelsOf, mapGrid, moveCorner, pivotPoint, moveItems, placeAsset, placeAt, removeCorner, resizeItem, setOutline, snap, withGroups } from '../../model/level/level';
import type { AssetCategory, AssetDefinition, LevelItem, LevelSet, TravelKind, TravelLink } from '../../model/level/types';
import { spineSequence } from '../../model/layout';
import { boundsOf as mapBoundsOf, itemsInRoom } from '../../model/level/hierarchy';
import { referenceDepth, referencesOf } from '../../model/level/references';
import { roleOf, type PuzzleOverlay } from '../../model/level/puzzles';
import { addTravel, moveTravelPoint, travelLabel, travelLength, travelPoints } from '../../model/level/travel';
import { addHallway, hallwayRuns, squareUp } from '../../model/level/hallway';
import { boxOf, edgeLines, mergeBox, snapBox, snapEdges, snapsByEdge, type Box, type Guide } from '../../model/level/edges';
import type { Project } from '../../model/types';
import { useDragPan, useWheelPanZoom } from '../../use-pan-zoom';
import type { View } from '../../view';
import { formatLength } from './units';
import { pathBetween } from '../../model/level/nav';
import { streamLayout } from '../../model/level/streaming';

/** Pixels per metre at zoom 1. */
export const PX = 24;

export interface MapApi {
  /** The plan point under a screen point, or null when it is outside the map. */
  worldAt: (clientX: number, clientY: number) => Point | null;
  /** Bring these items (or the whole floor) into view. */
  frame: (ids?: readonly string[]) => void;
  /** How near (in plan) an edge has to come to snap to another, at this zoom. */
  snapTolerance: () => number;
}

/** Select and move; drag out a rectangle; click the corners of a freeform outline; or draw a route between places. */
export type MapTool = 'select' | 'draw' | 'outline' | 'route' | 'hallway' | 'path';

interface Props {
  project: Project;
  levelId: string;
  floorId: string;
  global: readonly AssetDefinition[];
  selection: readonly string[];
  onSelect: (ids: string[]) => void;
  onCommit: (project: Project) => void;
  view: View;
  setView: (update: (view: View) => View) => void;
  hidden: ReadonlySet<AssetCategory>;
  overlays: { story: boolean; dims: boolean; ghost: boolean; cast?: boolean };
  tool: MapTool;
  /** What the draw tool draws. */
  drawAsset: string;
  /** What the route tool draws (spec V2 §5). */
  routeKind?: TravelKind;
  /** How wide the hallway tool draws (metres). */
  hallWidth?: number;
  /** A hallway was just drawn: its corridors and openings. */
  onHallway?: (ids: string[]) => void;
  /** A room being detailed (spec V2 §7): the rest of the floor dims and stays put. */
  focusRoom?: string | null;
  /** An asset picked up from the library: the next click puts it down. */
  placing: string | null;
  onPlace: (at: Point) => void;
  onOpen3D: (id: string) => void;
  onHover: (at: Point | null) => void;
  issues: ReadonlyMap<string, string>;
  /** Puzzles to show the parts of (spec V2 §14): entries, required objects, clues, gates and outputs. */
  puzzles?: readonly PuzzleOverlay[];
  /** Items that are part of a puzzle, and which: each gets a small badge (puzzle spec §12). */
  badges?: ReadonlyMap<string, string[]>;
  /** Points the guided generator asks for (the way in, the stairs), drawn as pins. */
  markers?: readonly { x: number; y: number; label: string }[];
}

/** An item made to fill a box (its size along its own axes, turned square to the map), centred in it. */
const fitBox = (project: Project, id: string, rotation: number, b: Box): Project => {
  const across = ((rotation % 180) + 180) % 180 === 90;
  const w = Math.round((b.maxX - b.minX) * 1000) / 1000;
  const d = Math.round((b.maxY - b.minY) * 1000) / 1000;
  return placeAt(resizeItem(project, id, across ? { w: d, d: w } : { w, d }), id, { x: Math.round(((b.minX + b.maxX) / 2) * 1000) / 1000, y: Math.round(((b.minY + b.maxY) / 2) * 1000) / 1000 });
};

type Drag =
  | { kind: 'move'; ids: string[]; start: Point; moved: boolean }
  | { kind: 'resize'; id: string; handle: string; start: Point; frame: Frame }
  | { kind: 'rotate'; id: string; frame: Frame }
  | { kind: 'draw'; start: Point; at: Point }
  | { kind: 'corner'; id: string; index: number; moved: boolean }
  | { kind: 'insert'; id: string; wall: number; at: Point; moved: boolean }
  | { kind: 'marquee'; start: Point; at: Point; base: string[] }
  | { kind: 'routePoint'; id: string; index: number; moved: boolean };

const HANDLES: { key: string; lx: number; ly: number }[] = [
  { key: 'nw', lx: -1, ly: -1 },
  { key: 'n', lx: 0, ly: -1 },
  { key: 'ne', lx: 1, ly: -1 },
  { key: 'e', lx: 1, ly: 0 },
  { key: 'se', lx: 1, ly: 1 },
  { key: 's', lx: 0, ly: 1 },
  { key: 'sw', lx: -1, ly: 1 },
  { key: 'w', lx: -1, ly: 0 },
];

/** How each kind of route is drawn (spec V2 §5): roads wide, trails dashed, rivers blue, fast travel dotted. */
const ROUTE_STYLE: Partial<Record<TravelKind, { color: string; width: number; dash?: number[]; opacity?: number }>> = {
  road: { color: '#c2a56c', width: 4 },
  trail: { color: '#a8916a', width: 2, dash: [6, 4] },
  river: { color: '#5e9fc0', width: 6, opacity: 0.75 },
  route: { color: '#c9a45c', width: 2.5 },
  progression: { color: '#d9607a', width: 2.5, dash: [10, 5] },
  fastTravel: { color: '#b07fd0', width: 2.5, dash: [2, 5] },
  door: { color: '#8fa8c4', width: 2, dash: [8, 4, 2, 4] },
  elevator: { color: '#8fa8c4', width: 2, dash: [8, 4, 2, 4] },
  portal: { color: '#6cc4d6', width: 2, dash: [8, 4, 2, 4] },
  cinematic: { color: '#9a7fc0', width: 2, dash: [8, 4, 2, 4] },
  loading: { color: '#8a8a8a', width: 2, dash: [8, 4, 2, 4] },
};

const midpoint = (pts: readonly Point[]): Point => {
  const total = travelLength(pts);
  let left = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d >= left && d > 0) return { x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d };
    left -= d;
  }
  return pts[0]!;
};

/** Markers that are places on a map (spec V2 §5): their names are drawn beside them. */
const NAMED_MARKERS = new Set(['destination', 'landmark', 'portal', 'waypoint']);

const ROLE_GLYPH: Partial<Record<string, string>> = {
  landmark: '▲',
  playerStart: 'P',
  npc: 'N',
  companion: 'C',
  enemy: 'E',
  neutral: 'A',
  patrolNode: '•',
  spawn: 'S',
  camera: '◉',
  audio: '♪',
  dialogue: '“',
  objective: '★',
  cover: '▮',
  waypoint: 'W',
  traversal: '⤴',
  destination: '⚑',
  prerequisite: '?',
  puzzle: '✦',
  checkpoint: 'R',
};

const pointsAttr = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

/** Where a space's name goes: its middle, or inside it when the middle isn't (an L's corner). */
const labelPoint = (f: Frame): Point => {
  if (!f.outline || contains(f, f)) return f;
  const c = corners(f);
  const t = triangulate(c);
  let best = { x: f.x, y: f.y, area: -1 };
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, d] = [c[t[i]!]!, c[t[i + 1]!]!, c[t[i + 2]!]!];
    const area = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x));
    if (area > best.area) best = { x: (a.x + b.x + d.x) / 3, y: (a.y + b.y + d.y) / 3, area };
  }
  return best;
};

/**
 * The top-down map (spec §3): the floor's spaces with their walls cut by
 * doors and windows, everything placed in them, and handles to move, resize
 * and turn. It draws from the same geometry as the 3D graybox.
 */
export const LevelMap = forwardRef<MapApi, Props>((props, ref) => {
  const { project, levelId, floorId, global, selection, view, setView } = props;
  const root = useRef<HTMLDivElement>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const [preview, setPreviewState] = useState<Project | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const previewRef = useRef<Project | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };
  const setPreview = (p: Project | null) => {
    previewRef.current = p;
    setPreviewState(p);
  };
  // The outline being drawn: the corners clicked so far, and where the pointer is.
  const [draftCorners, setDraftCorners] = useState<Point[]>([]);
  // The route being drawn (spec V2 §5): its points, and the items its ends are on.
  const [draftRoute, setDraftRoute] = useState<{ points: Point[]; from?: string } | null>(null);
  // The Path tool (navmesh, spec §19): two points, and the way people would walk between them.
  const [pathEnds, setPathEnds] = useState<Point[]>([]);
  useEffect(() => {
    if (props.tool !== 'path') setPathEnds([]);
  }, [props.tool]);
  // The hallway being drawn: its points, squared up along the axes.
  const [draftHall, setDraftHall] = useState<Point[] | null>(null);
  // Edges snapped to while dragging (rooms, hallways and buildings pull flush), drawn as guides.
  const [guides, setGuides] = useState<Guide[]>([]);
  const [drawBox, setDrawBox] = useState<Box | null>(null);
  /** A rectangle dragged out: edges near a neighbour's edge go flush against it, the others to the grid. */
  const drawnBox = (start: Point, at: Point, tol: number) => {
    const s = levelsOf(project);
    const grid = boundsOf([{ x: snap(s, start.x, undefined, levelId), y: snap(s, start.y, undefined, levelId) }, { x: snap(s, at.x, undefined, levelId), y: snap(s, at.y, undefined, levelId) }]);
    if (!(tol > 0)) return { box: grid, guides: [] as Guide[] };
    const raw = boundsOf([start, at]);
    const sn = snapEdges(raw, { minX: true, maxX: true, minY: true, maxY: true }, edgeLines(s, levelId, floorId, [], global), tol);
    return { box: mergeBox(sn.box, sn.hit, grid), guides: sn.guides };
  };
  /** How near an edge has to come to snap to it: a few pixels on screen, whatever the zoom. Alt held: no edge snapping. */
  const edgeTol = (e: { altKey: boolean }) => (e.altKey ? 0 : Math.max(12 / scale, 0.75 * mapGrid(set, levelId)));
  const [pointer, setPointer] = useState<Point | null>(null);
  const shown = preview ?? project;
  const set = levelsOf(shown);
  const level = set.levels.find((l) => l.id === levelId);
  // A world or region is kilometres across (spec V2 §3): its base scale fits it on screen as a room's does a room.
  const extentOf = (s: LevelSet) => {
    const l = s.levels.find((x) => x.id === levelId);
    const b = l && mapBoundsOf(s, l, global);
    return b ? { ...b, ox: l!.origin?.x ?? 0, oy: l!.origin?.y ?? 0 } : undefined;
  };
  const extent = extentOf(set);
  // Pictures to trace over (spec V2 §10), under everything.
  const references = referencesOf(set, levelId, floorId).filter((r) => !r.hidden);
  const basePx = (e = extent) => PX * (e && Math.max(e.w, e.d) > 200 ? 200 / Math.max(e.w, e.d) : 1);
  const scale = basePx() * view.zoom;

  useWheelPanZoom(root, setView);
  const pan = useDragPan(view, setView, () => props.onSelect([]));

  const toWorld = (clientX: number, clientY: number): Point => {
    const r = root.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.panX) / scale, y: (clientY - r.top - view.panY) / scale };
  };

  const frameIds = (ids?: readonly string[]) => {
    const s = levelsOf(project);
    const items = s.items.filter((i) => i.levelId === levelId && i.floorId === floorId && (!ids?.length || ids.includes(i.id)));
    const r = root.current?.getBoundingClientRect();
    if (!r) return;
    const e = extentOf(s);
    const unit = basePx(e);
    // An empty map frames its extent, when it has one.
    if (!items.length && !e) {
      setView(() => ({ zoom: 1, panX: r.width / 2, panY: r.height / 2 }));
      return;
    }
    const b = items.length ? boundsOf(items.flatMap((i) => corners(frameOf(s, i, global)))) : { minX: -e!.w / 2 - e!.ox, maxX: e!.w / 2 - e!.ox, minY: -e!.d / 2 - e!.oy, maxY: e!.d / 2 - e!.oy };
    const w = Math.max(4, b.maxX - b.minX);
    const h = Math.max(4, b.maxY - b.minY);
    const zoom = Math.min(4, Math.max(0.02, Math.min((r.width - 120) / (w * unit), (r.height - 120) / (h * unit))));
    setView(() => ({ zoom, panX: r.width / 2 - ((b.minX + b.maxX) / 2) * unit * zoom, panY: r.height / 2 - ((b.minY + b.maxY) / 2) * unit * zoom }));
  };

  useImperativeHandle(ref, () => ({
    worldAt: (clientX, clientY) => {
      const r = root.current?.getBoundingClientRect();
      if (!r || clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
      return toWorld(clientX, clientY);
    },
    frame: frameIds,
    snapTolerance: () => Math.max(12 / scale, 0.75 * mapGrid(set, levelId)),
  }));

  const items = useMemo(
    () =>
      set.items.filter((i) => i.levelId === levelId && i.floorId === floorId && !i.hidden && !props.hidden.has(assetOf(set, i, global).category)),
    [set, levelId, floorId, props.hidden, global],
  );
  const floors = [...(level?.floors ?? [])].sort((a, b) => a.elevation - b.elevation);
  const below = floors[floors.findIndex((f) => f.id === floorId) - 1];
  const ghost = props.overlays.ghost && below ? set.items.filter((i) => i.levelId === levelId && i.floorId === below.id && !i.hidden) : [];

  // Walls as the graybox cuts them, seen from above: full-height pieces only, so openings show as gaps.
  const walls = useMemo(
    () => meshesFor(set, levelId, { floorId, global, skip: (i) => props.hidden.has(assetOf(set, i, global).category) }).filter((m) => m.part === 'wall' && m.y - m.sy / 2 <= (level?.floors.find((f) => f.id === floorId)?.elevation ?? 0) + 0.01),
    [set, levelId, floorId, global, props.hidden, level],
  );

  // ------------------------------------------------------------ pointer work

  const beginWindowDrag = (d: Drag) => {
    setDrag(d);
    // The window the map is in: this one, or its own (popped out to another screen).
    const win = root.current?.ownerDocument.defaultView ?? window;
    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const at = toWorld(e.clientX, e.clientY);
      if (cur.kind === 'move') {
        const dx = at.x - cur.start.x;
        const dy = at.y - cur.start.y;
        const moved = cur.moved || Math.hypot(dx, dy) * scale > 3;
        if (moved) {
          let next = moveItems(project, cur.ids, dx, dy, global);
          // Flush against a neighbour's edge, if one is near where it is dragged (the grid for a way that isn't).
          const raw = moveItems(project, cur.ids, dx, dy, global, true);
          const s1 = levelsOf(raw);
          const movers = s1.items.filter((i) => cur.ids.includes(i.id) && snapsByEdge(s1, i, global));
          const tol = edgeTol(e);
          if (movers.length && tol > 0) {
            const box = boundsOf(movers.flatMap((i) => { const b = boxOf(s1, i, global); return [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]; }));
            const sn = snapBox(box, edgeLines(levelsOf(project), levelId, floorId, cur.ids, global), tol);
            if (sn.hitX || sn.hitY) next = moveItems(project, cur.ids, sn.hitX ? dx + sn.dx : dx, sn.hitY ? dy + sn.dy : dy, global, { x: sn.hitX, y: sn.hitY });
            setGuides(sn.guides);
          } else setGuides([]);
          setPreview(next);
        }
        if (moved !== cur.moved) setDrag({ ...cur, moved });
      } else if (cur.kind === 'resize') {
        const f = cur.frame;
        const h = HANDLES.find((x) => x.key === cur.handle)!;
        const d0 = toLocal({ ...f, x: 0, y: 0 }, { x: at.x - cur.start.x, y: at.y - cur.start.y });
        const s = levelsOf(project);
        const step = s.settings.snap ? mapGrid(s, levelId) : 0.01;
        const w = h.lx ? Math.max(step, snap(s, f.w + h.lx * d0.x, undefined, levelId)) : f.w;
        const dd = h.ly ? Math.max(step, snap(s, f.d + h.ly * d0.y, undefined, levelId)) : f.d;
        // The opposite edge stays where it is.
        const shift = toPlan({ ...f, x: 0, y: 0 }, (h.lx * (w - f.w)) / 2, (h.ly * (dd - f.d)) / 2);
        let next = placeAt(resizeItem(project, cur.id, { w, d: dd }, global), cur.id, { x: Math.round((f.x + shift.x) * 1000) / 1000, y: Math.round((f.y + shift.y) * 1000) / 1000 });
        // The edge being pulled snaps onto a neighbour's edge, if one is near.
        const item = levelsOf(next).items.find((i) => i.id === cur.id);
        const tol = edgeTol(e);
        if (item && tol > 0 && snapsByEdge(levelsOf(next), item, global)) {
          const b0 = boundsOf(corners(f));
          const b1 = boxOf(levelsOf(next), item, global);
          // Where the edge is dragged to, before the grid: what is near that snaps.
          const wr = h.lx ? Math.max(0.1, f.w + h.lx * d0.x) : f.w;
          const dr = h.ly ? Math.max(0.1, f.d + h.ly * d0.y) : f.d;
          const sr = toPlan({ ...f, x: 0, y: 0 }, (h.lx * (wr - f.w)) / 2, (h.ly * (dr - f.d)) / 2);
          const braw = boundsOf(corners({ ...f, w: wr, d: dr, x: f.x + sr.x, y: f.y + sr.y }));
          const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
          const moved = { minX: !near(b0.minX, braw.minX), maxX: !near(b0.maxX, braw.maxX), minY: !near(b0.minY, braw.minY), maxY: !near(b0.maxY, braw.maxY) };
          const sn = snapEdges(braw, moved, edgeLines(s, levelId, floorId, [cur.id], global), tol);
          setGuides(sn.guides);
          if (sn.guides.length) {
            // Edges that caught on a neighbour go there; the rest stay on the grid.
            next = fitBox(next, cur.id, item.rotation, mergeBox(sn.box, sn.hit, b1));
          }
        } else setGuides([]);
        setPreview(next);
      } else if (cur.kind === 'routePoint') {
        setPreview(moveTravelPoint(project, cur.id, cur.index, snapPoint(at)));
        if (!cur.moved) setDrag({ ...cur, moved: true });
      } else if (cur.kind === 'corner') {
        setPreview(moveCorner(project, cur.id, cur.index, at, global));
        if (!cur.moved) setDrag({ ...cur, moved: true });
      } else if (cur.kind === 'insert') {
        setPreview(insertCorner(project, cur.id, cur.wall, at, global));
        if (!cur.moved) setDrag({ ...cur, moved: true });
      } else if (cur.kind === 'rotate') {
        let deg = (Math.atan2(at.y - cur.frame.y, at.x - cur.frame.x) * 180) / Math.PI + 90;
        if (!e.shiftKey) deg = Math.round(deg / 15) * 15;
        setPreview(placeAt(project, cur.id, { rotation: Math.round(deg * 10) / 10 }));
      } else if (cur.kind === 'marquee') {
        const b = boundsOf([cur.start, at]);
        const s = levelsOf(project);
        const hit = s.items
          .filter((i) => i.levelId === levelId && i.floorId === floorId && !i.hidden && !props.hidden.has(assetOf(s, i, global).category))
          .filter((i) => {
            const f = frameOf(s, i, global);
            return f.x >= b.minX && f.x <= b.maxX && f.y >= b.minY && f.y <= b.maxY;
          })
          .map((i) => i.id);
        props.onSelect([...new Set([...cur.base, ...hit])]);
        setDrag({ ...cur, at });
      } else {
        if (cur.kind === 'draw') {
          const tol = edgeTol(e);
          const s = levelsOf(project);
          const sn = drawnBox(cur.start, at, tol);
          setGuides(sn.guides);
          setDrawBox(sn.box);
        }
        setDrag({ ...cur, at });
      }
    };
    const up = (e: PointerEvent) => {
      win.removeEventListener('pointermove', move);
      win.removeEventListener('pointerup', up);
      win.removeEventListener('pointercancel', up);
      const cur = dragRef.current;
      const done = previewRef.current;
      setDrag(null);
      setPreview(null);
      setGuides([]);
      setDrawBox(null);
      if (cur?.kind === 'draw') {
        const at = toWorld(e.clientX, e.clientY);
        const s = levelsOf(project);
        // Drawn up against a neighbour: its edges snap flush.
        const b = drawnBox(cur.start, at, edgeTol(e)).box;
        const w = b.maxX - b.minX;
        const h = b.maxY - b.minY;
        if (w >= 0.5 && h >= 0.5) {
          const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
          const placed = placeAsset(project, levelId, floorId, props.drawAsset, centre, { global });
          const id = placed.ids[0];
          if (id) {
            props.onCommit(placeAt(resizeItem(placed.project, id, { w, d: h }, global), id, centre));
            props.onSelect([id]);
          }
        }
        return;
      }
      // A click on a wall's middle handle adds a corner there.
      if (cur?.kind === 'insert' && !cur.moved) {
        const added = insertCorner(project, cur.id, cur.wall, cur.at, global);
        if (added !== project) props.onCommit(added);
        return;
      }
      if (done) props.onCommit(done);
    };
    win.addEventListener('pointermove', move);
    win.addEventListener('pointerup', up);
    win.addEventListener('pointercancel', up);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const at = toWorld(e.clientX, e.clientY);
    if (e.button === 0 && props.placing) {
      props.onPlace(at);
      return;
    }
    if (e.button === 0 && props.tool === 'draw') {
      beginWindowDrag({ kind: 'draw', start: at, at });
      return;
    }
    if (e.button === 0 && props.tool === 'outline') {
      addDraftCorner(at, e.clientX, e.clientY);
      return;
    }
    if (e.button === 0 && props.tool === 'route') {
      addRoutePoint(snapPoint(at));
      return;
    }
    if (e.button === 0 && props.tool === 'hallway') {
      addHallPoint(snapPoint(at));
      return;
    }
    if (e.button === 0 && props.tool === 'path') {
      // Once a click, whether it lands on an item or the ground.
      e.stopPropagation();
      setPathEnds((ends) => (ends.length === 1 ? [ends[0]!, at] : [at]));
      return;
    }
    if (e.button === 0 && e.shiftKey) {
      beginWindowDrag({ kind: 'marquee', start: at, at, base: [...selection] });
      return;
    }
    pan(e);
  };

  const onItemDown = (e: React.PointerEvent, item: LevelItem) => {
    if (e.button !== 0) return;
    // Drawing a route: a place clicked is an end (or a stop on the way), tied to it.
    if (props.tool === 'route' && !props.placing) {
      e.stopPropagation();
      const f = frameOf(levelsOf(project), item, global);
      addRoutePoint({ x: f.x, y: f.y }, item.id);
      return;
    }
    if (props.placing || props.tool !== 'select') {
      onBackgroundDown(e);
      return;
    }
    e.stopPropagation();
    const group = withGroups(project, [item.id]);
    let ids: string[];
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ids = selection.includes(item.id) ? selection.filter((id) => !group.includes(id)) : [...selection, ...group];
      props.onSelect(ids);
      return;
    }
    ids = selection.includes(item.id) ? [...selection] : group;
    if (!selection.includes(item.id)) props.onSelect(ids);
    const s = levelsOf(project);
    const movable = ids.filter((id) => !s.items.find((i) => i.id === id)?.locked);
    if (movable.length) beginWindowDrag({ kind: 'move', ids: movable, start: toWorld(e.clientX, e.clientY), moved: false });
  };

  const onHandleDown = (e: React.PointerEvent, item: LevelItem, handle: string) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const f = frameOf(levelsOf(project), item, global);
    if (handle === 'rotate') beginWindowDrag({ kind: 'rotate', id: item.id, frame: f });
    else beginWindowDrag({ kind: 'resize', id: item.id, handle, start: toWorld(e.clientX, e.clientY), frame: f });
  };

  // ------------------------------------------------------------ drawing an outline

  const snapPoint = (p: Point): Point => {
    const s = levelsOf(project);
    return { x: snap(s, p.x, undefined, levelId), y: snap(s, p.y, undefined, levelId) };
  };

  const finishOutline = (points: Point[]) => {
    setDraftCorners([]);
    if (points.length < 3) return;
    const b = boundsOf(points);
    const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const placed = placeAsset(project, levelId, floorId, props.drawAsset, centre, { global });
    const id = placed.ids[0];
    if (!id) return;
    const outlined = setOutline(placed.project, id, points, global);
    // An outline that can't be walled (edges crossing, no area) is not made.
    if (outlined === placed.project) return;
    props.onCommit(outlined);
    props.onSelect([id]);
  };

  const addDraftCorner = (at: Point, clientX: number, clientY: number) => {
    const p = snapPoint(at);
    const first = draftCorners[0];
    // Clicking the first corner again closes the outline.
    if (first && draftCorners.length >= 3) {
      const r = root.current!.getBoundingClientRect();
      const fx = first.x * scale + view.panX + r.left;
      const fy = first.y * scale + view.panY + r.top;
      if (Math.hypot(clientX - fx, clientY - fy) <= 10) {
        finishOutline(draftCorners);
        return;
      }
    }
    const last = draftCorners[draftCorners.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) return;
    setDraftCorners([...draftCorners, p]);
  };

  // ------------------------------------------------------------ drawing a route (spec V2 §5)

  const finishRoute = (route: { points: Point[]; from?: string }, to?: string) => {
    setDraftRoute(null);
    if (route.points.length < 2) return;
    const made = addTravel(project, { levelId, floorId, kind: props.routeKind ?? 'route', points: route.points, from: route.from, to });
    if (!made.id) return;
    props.onCommit(made.project);
    props.onSelect([made.id]);
  };

  /** A point on the route: on a place, the first ties the start there and any after it finishes the route there. */
  const addRoutePoint = (p: Point, itemId?: string) => {
    if (!draftRoute) {
      setDraftRoute({ points: [p], ...(itemId ? { from: itemId } : {}) });
      return;
    }
    const last = draftRoute.points[draftRoute.points.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) return;
    if (itemId && itemId !== draftRoute.from) {
      finishRoute({ ...draftRoute, points: [...draftRoute.points, p] }, itemId);
      return;
    }
    setDraftRoute({ ...draftRoute, points: [...draftRoute.points, p] });
  };

  // ------------------------------------------------------------ drawing a hallway

  const hallAhead = (points: Point[], at: Point | null) => (at && points.length ? [...points, squareUp(points[points.length - 1]!, snapPoint(at))] : points);

  const finishHall = (points: Point[]) => {
    setDraftHall(null);
    if (points.length < 2) return;
    const made = addHallway(project, levelId, floorId, points, props.hallWidth ?? 2.4384, global);
    if (!made.ids.length) return;
    props.onCommit(made.project);
    props.onSelect(made.ids.filter((id) => levelsOf(made.project).items.find((i) => i.id === id)?.assetId === 'space.corridor'));
    props.onHallway?.(made.ids);
  };

  /** A point along the hallway: straight on from the last, along or across the map. */
  const addHallPoint = (p: Point) => {
    if (!draftHall) {
      setDraftHall([p]);
      return;
    }
    const q = squareUp(draftHall[draftHall.length - 1]!, p);
    const last = draftHall[draftHall.length - 1]!;
    if (Math.hypot(last.x - q.x, last.y - q.y) < 1e-6) return;
    setDraftHall([...draftHall, q]);
  };

  // While a hallway is drawn: Enter or a double-click ends it, Backspace takes back a point, Escape drops it.
  useEffect(() => {
    if (props.tool !== 'hallway') {
      if (draftHall) setDraftHall(null);
      return;
    }
    if (!draftHall) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') finishHall(draftHall);
      else if (e.key === 'Backspace' || e.key === 'Delete') setDraftHall(draftHall.length > 1 ? draftHall.slice(0, -1) : null);
      else if (e.key === 'Escape') setDraftHall(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const win = root.current?.ownerDocument.defaultView ?? window;
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  });

  // While a route is drawn: Enter or a double-click ends it where it is, Backspace takes back a point, Escape drops it.
  useEffect(() => {
    if (props.tool !== 'route') {
      if (draftRoute) setDraftRoute(null);
      return;
    }
    if (!draftRoute) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') finishRoute(draftRoute);
      else if (e.key === 'Backspace' || e.key === 'Delete') setDraftRoute(draftRoute.points.length > 1 ? { ...draftRoute, points: draftRoute.points.slice(0, -1) } : null);
      else if (e.key === 'Escape') setDraftRoute(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const win = root.current?.ownerDocument.defaultView ?? window;
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  });

  const onRouteDown = (e: React.PointerEvent, link: TravelLink) => {
    if (e.button !== 0 || props.placing || props.tool !== 'select') return;
    e.stopPropagation();
    props.onSelect([link.id]);
  };

  const onRoutePointDown = (e: React.PointerEvent, link: TravelLink, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    beginWindowDrag({ kind: 'routePoint', id: link.id, index, moved: false });
  };

  // While an outline is being drawn: Enter closes it, Backspace takes back a corner, Escape drops it.
  useEffect(() => {
    if (props.tool !== 'outline') {
      if (draftCorners.length) setDraftCorners([]);
      return;
    }
    if (!draftCorners.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') finishOutline(draftCorners);
      else if (e.key === 'Backspace' || e.key === 'Delete') setDraftCorners(draftCorners.slice(0, -1));
      else if (e.key === 'Escape') setDraftCorners([]);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Captured before the designer's own keys, which would delete the selection.
    const win = root.current?.ownerDocument.defaultView ?? window;
    win.addEventListener('keydown', onKey, true);
    return () => win.removeEventListener('keydown', onKey, true);
  });

  const onCornerDown = (e: React.PointerEvent, item: LevelItem, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    beginWindowDrag({ kind: 'corner', id: item.id, index, moved: false });
  };

  const onInsertDown = (e: React.PointerEvent, item: LevelItem, wall: number, at: Point) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    beginWindowDrag({ kind: 'insert', id: item.id, wall, at, moved: false });
  };

  // ------------------------------------------------------------ drawing

  const px = (n: number) => n / scale; // screen pixels in world units
  const units = set.settings.units;
  const grid = mapGrid(set, levelId);
  const stream = level?.streaming ? streamLayout(shown, levelId, global) : null;
  const minor = grid * scale >= 7 ? grid : grid * Math.ceil(7 / (grid * scale));
  // Room focus (spec V2 §7): the room and what is in it, the rest dimmed.
  const roomItem = props.focusRoom ? set.items.find((i) => i.id === props.focusRoom && i.levelId === levelId && i.floorId === floorId) : undefined;
  const focusFrame = roomItem ? frameOf(set, roomItem, global) : undefined;
  const inRoom = roomItem ? new Set([roomItem.id, ...itemsInRoom(set, roomItem.id, global).map((i) => i.id)]) : null;
  const focused = inRoom ? items.filter((i) => inRoom.has(i.id)) : items;
  const dimmed = inRoom ? items.filter((i) => !inRoom.has(i.id)) : [];
  // Travel links on this map (spec V2 §13), their ends where their places are.
  const routes = (set.travel ?? []).filter((t) => t.levelId === levelId && (!t.floorId || t.floorId === floorId)).map((link) => ({ link, points: travelPoints(set, link, global) })).filter((r) => r.points.length >= 2);
  // Items that open into their own map (spec V2 §5): marked, with the map's name.
  const opensInto = new Map(set.levels.filter((l) => l.parentId === levelId && l.anchorId).map((l) => [l.anchorId!, l.name]));
  // How far the grid goes: well past the map's edge.
  const reach = Math.max(5000, extent ? Math.max(extent.w, extent.d) * 1.5 + Math.abs(extent.ox) + Math.abs(extent.oy) : 0);
  const selected = new Set(selection);
  const single = selection.length === 1 ? set.items.find((i) => i.id === selection[0]) : undefined;

  // The Character Creator's people on this floor (character spec §7, §8): group members as dots facing their way, and how AI enemies see.
  const castHere = useMemo(() => {
    const here = new Set(items.map((i) => i.id));
    return levelCast(shown, levelId, global).filter((c) => here.has(c.itemId));
  }, [shown, levelId, global, items]);
  const crowdCounts = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of castHere) if (!c.placed) n.set(c.itemId, (n.get(c.itemId) ?? 0) + 1);
    return n;
  }, [castHere]);

  // Patrols: each walked round its stops in order (spec §11), drawn as a closed dashed loop on this floor.
  const patrols = useMemo(() => {
    const here = new Set(items.map((i) => i.id));
    const names = new Map<string, string>();
    for (const i of items) if (assetOf(set, i, global).role === 'patrolNode') {
      const name = String(paramOf(set, i, 'path', global) ?? '').trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()].map((name) => ({ name, stops: patrolStops(set, levelId, name, global).filter((st) => here.has(st.itemId)) })).filter((pt) => pt.stops.length > 1);
  }, [items, set, levelId, global]);

  const storyPath = useMemo(() => {
    if (!props.overlays.story) return [];
    // Story order is left to right on the graph, branches included; the spine breaks ties.
    const order = spineSequence(shown);
    const rank = (id: string) => (shown.placements[id]?.x ?? 0) + (order.includes(id) ? 0 : 0.5);
    return items
      .flatMap((i) => (i.links ?? []).filter((l) => shown.objects[l]?.type === 'scene').map((l) => ({ item: i, scene: l })))
      .sort((a, b) => rank(a.scene) - rank(b.scene))
      .map(({ item, scene }) => ({ at: frameOf(set, item, global), code: String(shown.objects[scene]!.data.code ?? ''), name: shown.objects[scene]!.name, id: `${item.id}:${scene}` }));
  }, [props.overlays.story, items, shown, set, global]);

  // Names that would land on another are left off (rooms first, then markers, zones and objects), and show on hover.
  const hiddenLabels = useMemo(() => {
    type Box = { x0: number; y0: number; x1: number; y1: number };
    const placed: Box[] = [];
    const hidden = new Set<string>();
    const text = (chars: number, size: number) => px(chars * size * 0.56);
    const hits = (b: Box) => placed.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
    const centred = (x: number, y: number, w: number, h: number): Box => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });
    const rank: Record<string, number> = { space: 0, marker: 1, volume: 2 };
    const candidates = items
      .map((item) => ({ item, def: assetOf(set, item, global), f: frameOf(set, item, global) }))
      .sort((a, b) => (selected.has(b.item.id) ? 1 : 0) - (selected.has(a.item.id) ? 1 : 0) || (rank[a.def.kind] ?? 3) - (rank[b.def.kind] ?? 3));
    for (const { item, def, f } of candidates) {
      if (def.kind !== 'space') continue;
      const at = labelPoint(f);
      placed.push(centred(at.x, at.y, Math.max(text(item.name.length, 12), px(70)), px(30)));
    }
    for (const s of storyPath) placed.push({ x0: s.at.x - px(24), y0: s.at.y - px(30), x1: s.at.x + px(24), y1: s.at.y - px(14) });
    for (const { item, def, f } of candidates) {
      let box: Box | null = null;
      if (def.kind === 'marker' && NAMED_MARKERS.has(def.role)) {
        const r = Math.max(px(7), Math.min(f.w, f.d) / 2);
        box = { x0: f.x + r + px(5), y0: f.y - px(7), x1: f.x + r + px(5) + text(item.name.length + 8, 11), y1: f.y + px(7) };
      } else if (def.kind === 'volume') {
        const c = corners(f)[0]!;
        box = { x0: c.x + px(6), y0: c.y + px(4), x1: c.x + px(6) + text(item.name.length, 10), y1: c.y + px(16) };
      } else if (def.kind !== 'space' && def.kind !== 'hosted' && def.kind !== 'light' && def.kind !== 'marker' && f.w * scale > 60) {
        box = centred(f.x, f.y, text(item.name.length, 10), px(13));
      }
      if (!box) continue;
      if (hits(box) && !selected.has(item.id)) hidden.add(item.id);
      else placed.push(box);
    }
    return hidden;
    // px depends on scale.
  }, [items, set, global, scale, storyPath, selection]);

  const drawItem = (item: LevelItem, faint = false) => {
    const def = assetOf(set, item, global);
    const f = frameOf(set, item, global);
    const color = item.invalid || (props.issues.has(item.id) && def.kind === 'hosted') ? INVALID_COLOR : CATEGORY_COLOR[def.category] ?? '#a59c86';
    const poly = pointsAttr(corners(f));
    const common = {
      'data-id': item.id,
      className: `lvl-item${selected.has(item.id) ? ' on' : ''}${item.locked ? ' locked' : ''}`,
      onPointerDown: faint ? undefined : (e: React.PointerEvent) => onItemDown(e, item),
      onDoubleClick: faint ? undefined : () => props.onOpen3D(item.id),
    };
    const label = (text: string, at: Point, size = 11, fill = 'var(--text-soft)') => (
      <text x={at.x} y={at.y} fontSize={px(size)} fill={fill} textAnchor="middle" dominantBaseline="middle" className="lvl-label">
        {text}
      </text>
    );
    if (def.kind === 'space') {
      return (
        <g key={item.id} {...common}>
          {!faint && <title>{item.name}</title>}
          <polygon points={poly} className="lvl-space" fill={def.role === 'zone' ? 'rgba(111,174,94,0.07)' : 'rgba(201,164,92,0.05)'} stroke={color} strokeOpacity={0.35} strokeWidth={px(1)} strokeDasharray={def.role === 'zone' ? `${px(6)} ${px(4)}` : undefined} />
          {!faint && label(item.name, { x: labelPoint(f).x, y: labelPoint(f).y - px(7) }, 12, 'var(--text)')}
          {!faint &&
            label(
              f.outline ? `${Math.round(areaOf(f) * (units === 'ft' ? 10.7639 : 1) * 10) / 10} ${units === 'ft' ? 'sq ft' : 'm²'}` : `${formatLength(f.w, units)} × ${formatLength(f.d, units)}`,
              { x: labelPoint(f).x, y: labelPoint(f).y + px(8) },
              10,
              'var(--muted)',
            )}
        </g>
      );
    }
    if (def.kind === 'hosted') {
      const swing = String(paramOf(set, item, 'swing', global) ?? 'in');
      // Which side of the wall is the room's: a point just off it on the door's own +y side, inside its host or not.
      const host = item.host && set.items.find((i) => i.id === item.host!.id);
      const inward = host && contains(frameOf(set, host, global), toPlan(f, 0, 0.3)) ? 1 : -1;
      const side = swing === 'out' ? -inward : inward;
      const hinge = toPlan(f, -f.w / 2, 0);
      const into = toPlan(f, -f.w / 2, f.w * side);
      const tip = toPlan(f, f.w / 2, 0);
      const sweep = (into.x - hinge.x) * (tip.y - hinge.y) - (into.y - hinge.y) * (tip.x - hinge.x) > 0 ? 1 : 0;
      return (
        <g key={item.id} {...common}>
          {!faint && <title>{item.name}</title>}
          <polygon points={poly} fill="var(--ground)" stroke="none" />
          {def.role === 'window' ? (
            <polyline points={pointsAttr([toPlan(f, -f.w / 2, 0), toPlan(f, f.w / 2, 0)])} stroke="#9fc6d8" strokeWidth={px(3)} />
          ) : swing === 'open archway' ? null : swing === 'sliding' ? (
            <polyline points={pointsAttr([toPlan(f, -f.w / 2, px(3)), toPlan(f, f.w / 2, px(3))])} stroke={color} strokeWidth={px(2)} />
          ) : (
            <>
              <polyline points={pointsAttr([hinge, into])} stroke={color} strokeWidth={px(2)} />
              <path d={`M ${into.x} ${into.y} A ${f.w} ${f.w} 0 0 ${sweep} ${tip.x} ${tip.y}`} fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
            </>
          )}
          <polygon points={poly} fill="transparent" stroke={item.invalid ? INVALID_COLOR : 'transparent'} strokeWidth={px(1.5)} />
        </g>
      );
    }
    if (def.kind === 'marker') {
      const r = Math.max(px(7), Math.min(f.w, f.d) / 2);
      const nose = toPlan(f, 0, -r * 1.8);
      const left = toPlan(f, -r * 0.6, -r * 0.8);
      const right = toPlan(f, r * 0.6, -r * 0.8);
      const radius = def.role === 'spawn' ? num(paramOf(set, item, 'radius', global), 0) : 0;
      return (
        <g key={item.id} {...common}>
          {!faint && <title>{item.name}</title>}
          {radius > 0 && <circle cx={f.x} cy={f.y} r={radius} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.5} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
          <polygon points={pointsAttr([nose, left, right])} fill={color} />
          <circle cx={f.x} cy={f.y} r={r} fill="var(--node)" stroke={color} strokeWidth={px(2)} />
          {label(ROLE_GLYPH[def.role] ?? def.name[0]!, f, 10, color)}
          {!faint && NAMED_MARKERS.has(def.role) && !hiddenLabels.has(item.id) && (
            <text x={f.x + r + px(5)} y={f.y} fontSize={px(11)} fill="var(--text)" dominantBaseline="middle" className="lvl-label">
              {item.name}
              {(() => {
                const cls = String(paramOf(set, item, 'classification', global) ?? '');
                const custom = String(paramOf(set, item, 'customType', global) ?? '').trim();
                return cls ? <tspan fill="var(--muted)" fontSize={px(9)}> · {cls === 'Custom' && custom ? custom : cls}</tspan> : null;
              })()}
            </text>
          )}
        </g>
      );
    }
    if (def.kind === 'light') {
      const r = Math.max(px(6), Math.min(f.w, f.d) / 2);
      const range = num(paramOf(set, item, 'range', global), 0);
      const lightColor = String(paramOf(set, item, 'color', global) ?? '#ffd9a0');
      return (
        <g key={item.id} {...common}>
          {!faint && <title>{item.name}</title>}
          {selected.has(item.id) && range > 0 && <circle cx={f.x} cy={f.y} r={range} fill={lightColor} fillOpacity={0.04} stroke={lightColor} strokeOpacity={0.35} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} />}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const c = Math.cos((a * Math.PI) / 180);
            const s = Math.sin((a * Math.PI) / 180);
            return <line key={a} x1={f.x + c * r * 1.3} y1={f.y + s * r * 1.3} x2={f.x + c * r * 1.9} y2={f.y + s * r * 1.9} stroke={lightColor} strokeWidth={px(1.5)} />;
          })}
          <circle cx={f.x} cy={f.y} r={r} fill={lightColor} fillOpacity={0.85} stroke="var(--ground)" strokeWidth={px(1)} />
        </g>
      );
    }
    if (def.kind === 'volume') {
      return (
        <g key={item.id} {...common}>
          {!faint && <title>{item.name}</title>}
          {/* Picked by its edge, so a zone over a whole room doesn't take the room's clicks. */}
          <polygon points={poly} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
          <polygon points={poly} fill="none" stroke="transparent" strokeWidth={px(10)} pointerEvents="stroke" />
          {!faint && !hiddenLabels.has(item.id) && (
            <text x={corners(f)[0]!.x + px(6)} y={corners(f)[0]!.y + px(11)} fontSize={px(10)} fill={color} className="lvl-label" transform={`rotate(${f.rotation} ${corners(f)[0]!.x} ${corners(f)[0]!.y})`}>
              {item.name}
            </text>
          )}
        </g>
      );
    }
    // Solids.
    const round = def.proxy === 'cylinder' || def.proxy === 'sphere';
    const arrow = def.proxy === 'stairs' || def.proxy === 'wedge';
    const steps = def.proxy === 'stairs' ? Math.min(40, Math.max(2, Math.round(num(paramOf(set, item, 'steps', global), 16)))) : 0;
    return (
      <g key={item.id} {...common}>
          {!faint && <title>{item.name}</title>}
        {def.proxy === 'model' && def.model?.plan && (
          // An imported model seen from above (spec V2 §10), stretched to its footprint.
          <image href={def.model.plan} x={f.x - f.w / 2} y={f.y - f.d / 2} width={f.w} height={f.d} preserveAspectRatio="none" transform={`rotate(${f.rotation} ${f.x} ${f.y})`} opacity={0.9} pointerEvents="none" className="lvl-model-plan" />
        )}
        {round ? (
          <ellipse cx={f.x} cy={f.y} rx={f.w / 2} ry={f.d / 2} transform={`rotate(${f.rotation} ${f.x} ${f.y})`} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={px(1.5)} />
        ) : (
          <polygon points={poly} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={px(1.5)} />
        )}
        {Array.from({ length: Math.max(0, steps - 1) }, (_, s) => {
          const ly = f.d / 2 - (f.d / steps) * (s + 1);
          return <polyline key={s} points={pointsAttr([toPlan(f, -f.w / 2, ly), toPlan(f, f.w / 2, ly)])} stroke={color} strokeOpacity={0.5} strokeWidth={px(1)} />;
        })}
        {def.proxy === 'pyramid' && (
          // Seen from above: its edges run from the corners up to the point in the middle.
          <polyline points={pointsAttr([toPlan(f, -f.w / 2, -f.d / 2), toPlan(f, f.w / 2, f.d / 2)])} stroke={color} strokeOpacity={0.7} strokeWidth={px(1.2)} />
        )}
        {def.proxy === 'pyramid' && <polyline points={pointsAttr([toPlan(f, f.w / 2, -f.d / 2), toPlan(f, -f.w / 2, f.d / 2)])} stroke={color} strokeOpacity={0.7} strokeWidth={px(1.2)} />}
        {arrow && (
          <polyline points={pointsAttr([toPlan(f, 0, f.d * 0.35), toPlan(f, 0, -f.d * 0.35), toPlan(f, -f.w * 0.2, -f.d * 0.2), toPlan(f, 0, -f.d * 0.35), toPlan(f, f.w * 0.2, -f.d * 0.2)])} fill="none" stroke={color} strokeWidth={px(1.5)} />
        )}
        {!faint && f.w * scale > 60 && !hiddenLabels.has(item.id) && label(item.name, f, 10, 'var(--text-soft)')}
      </g>
    );
  };

  const resizable = (item: LevelItem) => {
    const def = assetOf(set, item, global);
    return !item.host && !item.locked && def.kind !== 'marker' && def.kind !== 'assembly';
  };
  const outlined = (item: LevelItem) => !!outlineOf(set, item, global);

  const dims = (item: LevelItem) => {
    const f = frameOf(set, item, global);
    const north = toPlan(f, 0, -f.d / 2 - px(14));
    const east = toPlan(f, f.w / 2 + px(14), 0);
    return (
      <g className="lvl-dims" pointerEvents="none">
        <text x={north.x} y={north.y} fontSize={px(11)} textAnchor="middle" dominantBaseline="middle" fill="var(--gold)">
          {formatLength(f.w, units)}
        </text>
        <text x={east.x} y={east.y} fontSize={px(11)} textAnchor="middle" dominantBaseline="middle" fill="var(--gold)" transform={`rotate(${f.rotation + 90} ${east.x} ${east.y})`}>
          {formatLength(f.d, units)}
        </text>
      </g>
    );
  };

  const draft = drag?.kind === 'draw' && drawBox ? drawBox : drag?.kind === 'draw' ? boundsOf([{ x: snap(set, drag.start.x, undefined, levelId), y: snap(set, drag.start.y, undefined, levelId) }, { x: snap(set, drag.at.x, undefined, levelId), y: snap(set, drag.at.y, undefined, levelId) }]) : null;
  const marquee = drag?.kind === 'marquee' ? boundsOf([drag.start, drag.at]) : null;
  const order = (i: LevelItem) => ({ space: 0, volume: 1, solid: 2, hosted: 3, light: 4, marker: 5, assembly: 6 })[assetOf(set, i, global).kind];

  return (
    <div
      ref={root}
      className={`lvl-map${props.tool !== 'select' || props.placing ? ' is-drawing' : ''}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={(e) => {
        const at = toWorld(e.clientX, e.clientY);
        props.onHover(at);
        if (props.tool === 'outline' || props.tool === 'route' || props.tool === 'hallway') setPointer(at);
      }}
      onPointerLeave={() => {
        props.onHover(null);
        setPointer(null);
      }}
      onDoubleClick={() => {
        if (props.tool === 'outline' && draftCorners.length >= 3) finishOutline(draftCorners);
        // The double-click's two clicks each put a point down: the last is a repeat.
        if (props.tool === 'route' && draftRoute) finishRoute(draftRoute);
        if (props.tool === 'hallway' && draftHall) finishHall(draftHall);
      }}
      aria-label="Level map"
      role="application"
    >
      <svg width="100%" height="100%">
        <defs>
          <pattern id="lvl-minor" width={minor} height={minor} patternUnits="userSpaceOnUse">
            <path d={`M ${minor} 0 L 0 0 0 ${minor}`} fill="none" stroke="var(--grid-dot)" strokeWidth={px(1)} />
          </pattern>
          <pattern id="lvl-major" width={minor * 10} height={minor * 10} patternUnits="userSpaceOnUse">
            <rect width={minor * 10} height={minor * 10} fill="url(#lvl-minor)" />
            <path d={`M ${minor * 10} 0 L 0 0 0 ${minor * 10}`} fill="none" stroke="#2a2516" strokeWidth={px(1)} />
          </pattern>
        </defs>
        <g transform={`translate(${view.panX} ${view.panY}) scale(${scale})`}>
          <rect x={-reach} y={-reach} width={reach * 2} height={reach * 2} fill="url(#lvl-major)" pointerEvents="none" />
          <line x1={-reach} y1={0} x2={reach} y2={0} stroke="#3a3218" strokeWidth={px(1)} pointerEvents="none" />
          <line x1={0} y1={-reach} x2={0} y2={reach} stroke="#3a3218" strokeWidth={px(1)} pointerEvents="none" />
          {references.length > 0 && (
            <g className="lvl-references" pointerEvents="none">
              {references.map((r) => {
                const d = referenceDepth(r);
                return (
                  <image
                    key={r.id}
                    href={r.image}
                    data-id={r.id}
                    aria-label={r.name}
                    x={r.x - r.width / 2}
                    y={r.y - d / 2}
                    width={r.width}
                    height={d}
                    opacity={r.opacity}
                    preserveAspectRatio="none"
                    transform={r.rotation ? `rotate(${r.rotation} ${r.x} ${r.y})` : undefined}
                    className="lvl-reference"
                  />
                );
              })}
            </g>
          )}
          {stream && (
            <g className="lvl-stream-grid" pointerEvents="none">
              {stream.cells.map((c) => (
                <g key={c.key}>
                  <rect x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} fill="none" stroke="#5f8fb8" strokeOpacity={0.55} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} />
                  <text x={c.x0 + px(4)} y={c.y0 + px(12)} fontSize={px(11)} fill="#7fa9cf" className="lvl-stream-key">
                    {c.key}
                  </text>
                </g>
              ))}
            </g>
          )}
          {extent && (
            <g className="lvl-bounds" pointerEvents="none">
              <rect x={-extent.w / 2 - extent.ox} y={-extent.d / 2 - extent.oy} width={extent.w} height={extent.d} fill="none" stroke="#8a6f2f" strokeWidth={px(1.5)} strokeDasharray={`${px(10)} ${px(6)}`} />
              <text x={-extent.w / 2 - extent.ox + px(6)} y={-extent.d / 2 - extent.oy - px(8)} fontSize={px(11)} fill="#c9a45c">
                {level?.name} · {formatLength(extent.w, units)} × {formatLength(extent.d, units)}
              </text>
            </g>
          )}
          {ghost.length > 0 && (
            <g opacity={0.22} pointerEvents="none" className="lvl-ghost">
              {ghost.map((i) => drawItem(i, true))}
            </g>
          )}
          {dimmed.length > 0 && (
            <g opacity={0.22} pointerEvents="none" className="lvl-dimmed">
              {[...dimmed].sort((a, b) => order(a) - order(b)).map((i) => drawItem(i, true))}
            </g>
          )}
          {[...focused].sort((a, b) => order(a) - order(b)).filter((i) => assetOf(set, i, global).kind === 'space').map((i) => drawItem(i))}
          {walls.map((m) => (
            <rect
              key={m.key}
              x={-m.sx / 2}
              y={-m.sz / 2}
              width={m.sx}
              height={m.sz}
              transform={`translate(${m.x} ${m.z}) rotate(${(-m.rotY * 180) / Math.PI})`}
              fill={m.color}
              pointerEvents="none"
            />
          ))}
          {[...focused].sort((a, b) => order(a) - order(b)).filter((i) => assetOf(set, i, global).kind !== 'space').map((i) => drawItem(i))}
          {focused
            .filter((i) => props.badges?.has(i.id))
            .map((i) => {
              const c = corners(frameOf(set, i, global));
              const at = { x: Math.max(...c.map((p) => p.x)), y: Math.min(...c.map((p) => p.y)) };
              return (
                <g key={`badge-${i.id}`} className="lvl-puzzle-badge" data-badge={i.id} pointerEvents="none">
                  <title>{`Puzzle: ${props.badges!.get(i.id)!.join(', ')}`}</title>
                  <circle cx={at.x} cy={at.y} r={px(8)} />
                  <text x={at.x} y={at.y} fontSize={px(10)} textAnchor="middle" dominantBaseline="central">
                    🧩
                  </text>
                </g>
              );
            })}
          {props.focusRoom && focusFrame && (
            <polygon points={pointsAttr(corners(focusFrame))} className="lvl-focus-ring" fill="none" stroke="var(--gold-hi)" strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(4)}`} pointerEvents="none" />
          )}
          {routes.map(({ link, points }) => {
            const style = ROUTE_STYLE[link.kind] ?? ROUTE_STYLE.route!;
            const on = selected.has(link.id);
            const mid = midpoint(points);
            const end = points[points.length - 1]!;
            const prev = points[points.length - 2]!;
            const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
            const head = px(9);
            return (
              <g key={link.id} className={`lvl-route ${link.kind}${on ? ' on' : ''}${link.locked ? ' locked' : ''}`} data-id={link.id}>
                <polyline points={pointsAttr(points)} fill="none" stroke="transparent" strokeWidth={px(14)} onPointerDown={(e) => onRouteDown(e, link)} style={{ cursor: props.tool === 'select' ? 'pointer' : undefined }} />
                {on && <polyline points={pointsAttr(points)} fill="none" stroke="var(--gold-hi)" strokeOpacity={0.35} strokeWidth={px(style.width + 6)} pointerEvents="none" />}
                <polyline points={pointsAttr(points)} fill="none" stroke={link.locked ? '#e07a6a' : style.color} strokeOpacity={style.opacity ?? 0.9} strokeWidth={px(style.width)} strokeDasharray={style.dash?.map(px).join(' ')} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
                {(link.oneWay || link.kind === 'progression') && (
                  <polygon
                    points={pointsAttr([end, { x: end.x - Math.cos(ang - 0.45) * head, y: end.y - Math.sin(ang - 0.45) * head }, { x: end.x - Math.cos(ang + 0.45) * head, y: end.y - Math.sin(ang + 0.45) * head }])}
                    fill={link.locked ? '#e07a6a' : style.color}
                    pointerEvents="none"
                  />
                )}
                <text x={mid.x} y={mid.y - px(8)} fontSize={px(10)} fill={link.locked ? '#e07a6a' : style.color} textAnchor="middle" className="lvl-label" pointerEvents="none">
                  {link.locked ? '🔒 ' : ''}
                  {travelLabel(set, link)}
                  {link.toMap ? ' ⇢' : ''}
                </text>
                {on &&
                  props.tool === 'select' &&
                  points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 || i === points.length - 1 ? 6 : 4.5)} className="lvl-route-point" fill={i === 0 || i === points.length - 1 ? 'var(--node)' : 'var(--gold-hi)'} stroke="var(--gold-hi)" strokeWidth={px(1.5)} onPointerDown={(e) => onRoutePointDown(e, link, i)} aria-label={`Move point ${i + 1} of ${travelLabel(set, link)}`} />
                  ))}
              </g>
            );
          })}
          {guides.map((g, i) => (
            <line key={`guide${i}`} className="lvl-snap-guide" pointerEvents="none" x1={g.vertical ? g.at : g.from} y1={g.vertical ? g.from : g.at} x2={g.vertical ? g.at : g.to} y2={g.vertical ? g.to : g.at} stroke="#5fd3ff" strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
          ))}
          {draftHall && (
            <g pointerEvents="none" className="lvl-hall-draft">
              {(() => {
                const ahead = hallAhead(draftHall, pointer);
                const w = props.hallWidth ?? 2.4384;
                const { runs } = hallwayRuns(ahead, w);
                const len = ahead.slice(1).reduce((n, p, i) => n + Math.abs(p.x - ahead[i]!.x) + Math.abs(p.y - ahead[i]!.y), 0);
                const tip = ahead[ahead.length - 1]!;
                return (
                  <>
                    {runs.map((r, i) => (
                      <rect key={i} x={r.x - r.w / 2} y={r.y - r.d / 2} width={r.w} height={r.d} fill="rgba(201,164,92,0.25)" stroke="var(--gold-hi)" strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(3)}`} />
                    ))}
                    <polyline points={pointsAttr(ahead)} fill="none" stroke="var(--gold-hi)" strokeWidth={px(1)} />
                    {draftHall.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 ? 6 : 4)} fill={i === 0 ? 'none' : 'var(--gold-hi)'} stroke="var(--gold-hi)" strokeWidth={px(1.5)} />
                    ))}
                    <text x={tip.x + px(10)} y={tip.y - px(10)} fontSize={px(11)} fill="var(--gold-hi)">
                      {formatLength(len, units)} · {formatLength(w, units)} wide
                    </text>
                  </>
                );
              })()}
            </g>
          )}
          {pathEnds.length > 0 && (
            <g pointerEvents="none" className="lvl-path-test">
              {(() => {
                const floor = level?.floors.find((f) => f.id === floorId);
                const way = pathEnds.length === 2 ? pathBetween(set, levelId, floor?.elevation ?? 0, pathEnds[0]!, pathEnds[1]!, global) : null;
                const end = pathEnds[pathEnds.length - 1]!;
                const words = pathEnds.length < 2 ? 'Click where they go' : !way ? 'Nothing to walk on here' : way.none ? 'No way there' : formatLength(way.length, units);
                return (
                  <>
                    {way && !way.none && <polyline points={pointsAttr(way.points)} fill="none" stroke="#35d0ff" strokeWidth={px(3)} strokeLinejoin="round" strokeLinecap="round" />}
                    {pathEnds.length === 2 && (!way || way.none) && <line x1={pathEnds[0]!.x} y1={pathEnds[0]!.y} x2={end.x} y2={end.y} stroke="#c8524a" strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(5)}`} />}
                    {pathEnds.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={px(6)} fill={i === 0 ? 'none' : '#35d0ff'} stroke="#35d0ff" strokeWidth={px(2)} />
                    ))}
                    <text x={end.x + px(10)} y={end.y - px(10)} fontSize={px(12)} fill={way?.none || (pathEnds.length === 2 && !way) ? '#e07a70' : '#35d0ff'}>
                      {words}
                    </text>
                  </>
                );
              })()}
            </g>
          )}
          {draftRoute && (
            <g pointerEvents="none" className="lvl-route-draft">
              {(() => {
                const ahead = pointer ? [...draftRoute.points, snapPoint(pointer)] : draftRoute.points;
                const style = ROUTE_STYLE[props.routeKind ?? 'route'] ?? ROUTE_STYLE.route!;
                return (
                  <>
                    <polyline points={pointsAttr(ahead)} fill="none" stroke={style.color} strokeWidth={px(style.width)} strokeDasharray={style.dash?.map(px).join(' ')} strokeLinecap="round" />
                    {draftRoute.points.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 ? 6 : 4)} fill={i === 0 ? 'none' : 'var(--gold-hi)'} stroke="var(--gold-hi)" strokeWidth={px(1.5)} />
                    ))}
                    {pointer && (
                      <text x={snapPoint(pointer).x + px(10)} y={snapPoint(pointer).y - px(10)} fontSize={px(11)} fill="var(--gold-hi)">
                        {formatLength(travelLength(ahead), units)}
                      </text>
                    )}
                  </>
                );
              })()}
            </g>
          )}
          {items
            .filter((i) => opensInto.has(i.id))
            .map((i) => {
              const f = frameOf(set, i, global);
              const at = labelPoint(f);
              return (
                <g key={`opens-${i.id}`} className="lvl-opens" pointerEvents="none">
                  <polygon points={pointsAttr(corners(f))} fill="none" stroke="#c9a45c" strokeOpacity={0.8} strokeWidth={px(2)} strokeDasharray={`${px(3)} ${px(3)}`} />
                  <text x={at.x} y={at.y + px(22)} fontSize={px(10)} fill="#c9a45c" textAnchor="middle">
                    ▸ {opensInto.get(i.id)}
                  </text>
                </g>
              );
            })}
          {(props.puzzles ?? []).map((o) => {
            // Each part where it is, in its role's colour; what it needs and its clues lead in to where it is played, which leads out to what it opens.
            const placed = o.parts
              .map((part) => {
                if (part.itemId) {
                  const item = set.items.find((i) => i.id === part.itemId);
                  if (!item || item.floorId !== floorId || item.levelId !== levelId) return null;
                  const f = frameOf(set, item, global);
                  return { part, f, at: { x: f.x, y: f.y } as Point };
                }
                const route = routes.find((r) => r.link.id === part.travelId);
                return route ? { part, f: null, at: midpoint(route.points) } : null;
              })
              .filter((x): x is NonNullable<typeof x> => !!x);
            if (!placed.length) return null;
            const entries = placed.filter((x) => x.part.role === 'entry');
            const ins = placed.filter((x) => x.part.role === 'required' || x.part.role === 'clue');
            const centre = (xs: typeof placed) => ({ x: xs.reduce((n, x) => n + x.at.x, 0) / xs.length, y: xs.reduce((n, x) => n + x.at.y, 0) / xs.length });
            const hub = entries.length ? entries[0]!.at : centre(ins.length ? ins : placed);
            return (
              <g key={`puzzle-${o.puzzle.id}`} className="lvl-puzzle" data-puzzle={o.puzzle.id} pointerEvents="none">
                {placed
                  .filter((x) => x.part.role !== 'entry')
                  .map((x, n) => {
                    const c = roleOf(x.part.role).color;
                    const out = x.part.role === 'gate' || x.part.role === 'output';
                    const [a, b] = out ? [hub, x.at] : [x.at, hub];
                    const ang = Math.atan2(b.y - a.y, b.x - a.x);
                    const head = px(8);
                    return Math.hypot(b.x - a.x, b.y - a.y) > px(12) ? (
                      <g key={`link-${n}`} className="lvl-puzzle-link">
                        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeOpacity={0.7} strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(4)}`} />
                        <path d={`M ${b.x} ${b.y} L ${b.x - head * Math.cos(ang - 0.4)} ${b.y - head * Math.sin(ang - 0.4)} M ${b.x} ${b.y} L ${b.x - head * Math.cos(ang + 0.4)} ${b.y - head * Math.sin(ang + 0.4)}`} stroke={c} strokeWidth={px(1.5)} fill="none" />
                      </g>
                    ) : null;
                  })}
                {placed.map((x, n) => {
                  const r = roleOf(x.part.role);
                  const corner = x.f ? corners(x.f)[1]! : x.at;
                  return (
                    <g key={`part-${n}`} className={`lvl-puzzle-part ${x.part.role}`} data-role={x.part.role} data-id={x.part.itemId ?? x.part.travelId}>
                      {x.f && <polygon points={pointsAttr(corners(x.f))} fill="none" stroke={r.color} strokeWidth={px(x.part.bound ? 2.5 : 1.8)} strokeDasharray={x.part.bound ? undefined : `${px(4)} ${px(3)}`} />}
                      <circle cx={corner.x} cy={corner.y} r={px(8)} fill={r.color} stroke="var(--ground)" strokeWidth={px(1)} />
                      <text x={corner.x} y={corner.y + px(3.5)} fontSize={px(10)} textAnchor="middle" fill="#0b0a07" fontWeight={700}>
                        {r.mark}
                      </text>
                    </g>
                  );
                })}
                <text x={hub.x} y={hub.y + px(36)} fontSize={px(11)} textAnchor="middle" fill="#6cc4d6" className="lvl-puzzle-name">
                  🧩 {o.puzzle.name}
                </text>
              </g>
            );
          })}
          {castHere.map((c) => {
            const r = Math.max(px(3), 0.3);
            const nose = { x: c.home.x + Math.sin(c.yaw) * r * 1.9, y: c.home.y - Math.cos(c.yaw) * r * 1.9 };
            const sees = c.ai && (props.overlays.cast || selected.has(c.itemId));
            const cone = (() => {
              if (!sees || !c.ai || c.ai.viewDistance <= 0) return null;
              const R = c.ai.viewDistance;
              if (c.ai.visionAngle >= 360) return <circle cx={c.home.x} cy={c.home.y} r={R} fill="#e2b451" fillOpacity={0.07} stroke="#e2b451" strokeOpacity={0.45} strokeWidth={px(1)} />;
              const half = ((c.ai.visionAngle / 2) * Math.PI) / 180;
              const at = (a: number) => `${c.home.x + Math.sin(a) * R} ${c.home.y - Math.cos(a) * R}`;
              return <path d={`M ${c.home.x} ${c.home.y} L ${at(c.yaw - half)} A ${R} ${R} 0 ${c.ai.visionAngle > 180 ? 1 : 0} 1 ${at(c.yaw + half)} Z`} fill="#e2b451" fillOpacity={0.07} stroke="#e2b451" strokeOpacity={0.45} strokeWidth={px(1)} />;
            })();
            return (
              <g key={`cast-${c.key}`} pointerEvents="none" className="lvl-cast">
                {cone}
                {sees && c.ai && c.ai.proximityRadius > 0 && <circle cx={c.home.x} cy={c.home.y} r={c.ai.proximityRadius} fill="none" stroke="#e07a5f" strokeOpacity={0.7} strokeWidth={px(1)} />}
                {sees && c.ai && c.ai.hearingRadius > 0 && <circle cx={c.home.x} cy={c.home.y} r={c.ai.hearingRadius} fill="none" stroke="#7fa3c9" strokeOpacity={0.5} strokeWidth={px(1)} strokeDasharray={`${px(2)} ${px(3)}`} />}
                {!c.placed && (
                  <>
                    <line x1={c.home.x} y1={c.home.y} x2={nose.x} y2={nose.y} stroke={c.placeholder.tint} strokeWidth={px(1.5)} />
                    <circle cx={c.home.x} cy={c.home.y} r={r} fill={c.placeholder.tint} stroke="var(--ground)" strokeWidth={px(0.8)} />
                  </>
                )}
              </g>
            );
          })}
          {items
            .filter((i) => crowdCounts.has(i.id) || assetOf(set, i, global).role === 'crowd')
            .map((i) => {
              const f = frameOf(set, i, global);
              const g = (shown.characterGroups ?? []).find((x) => x.id === String(paramOf(set, i, 'group', global) ?? ''));
              return (
                <text key={`crowd-${i.id}`} x={f.x} y={f.y + f.d / 2 + px(14)} fontSize={px(11)} textAnchor="middle" fill="#8fc98a" pointerEvents="none" className="lvl-label">
                  {g ? `${g.name} · ${crowdCounts.get(i.id) ?? 0}` : 'Character group: pick one'}
                </text>
              );
            })}
          {patrols.map((pt) => (
            <g key={`patrol-${pt.name}`} pointerEvents="none" className="lvl-patrol">
              <polygon points={pointsAttr(pt.stops)} fill="none" stroke="#d9607a" strokeOpacity={0.7} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
              {pt.stops.map((st, n) => (
                <text key={st.itemId} x={st.x + px(7)} y={st.y - px(7)} fontSize={px(9)} fill="#d9607a">
                  {n + 1}
                </text>
              ))}
            </g>
          ))}
          {storyPath.length > 1 && (
            <polyline points={pointsAttr(storyPath.map((s) => s.at))} fill="none" stroke="var(--c-scene)" strokeWidth={px(2)} strokeDasharray={`${px(8)} ${px(5)}`} pointerEvents="none" />
          )}
          {storyPath.map((s) => (
            <g key={s.id} pointerEvents="none" className="lvl-story">
              <rect x={s.at.x - px(24)} y={s.at.y - px(30)} width={px(48)} height={px(16)} rx={px(4)} fill="var(--c-scene)" />
              <text x={s.at.x} y={s.at.y - px(22)} fontSize={px(10)} fill="var(--ground)" textAnchor="middle" dominantBaseline="middle" fontWeight={700}>
                {s.code || s.name.slice(0, 6)}
              </text>
            </g>
          ))}
          {items
            .filter((i) => selected.has(i.id))
            .map((i) => (
              <polygon key={`sel-${i.id}`} points={pointsAttr(corners(frameOf(set, i, global)))} fill="none" stroke="var(--gold-hi)" strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(3)}`} pointerEvents="none" />
            ))}
          {single && single.pivot && single.levelId === levelId && single.floorId === floorId && (() => {
            const p = pivotPoint(set, single, global);
            return (
              <g className="lvl-pivot" pointerEvents="none">
                <circle cx={p.x} cy={p.y} r={px(5)} fill="none" stroke="var(--gold-hi)" strokeWidth={px(1.5)} />
                <line x1={p.x - px(8)} y1={p.y} x2={p.x + px(8)} y2={p.y} stroke="var(--gold-hi)" strokeWidth={px(1)} />
                <line x1={p.x} y1={p.y - px(8)} x2={p.x} y2={p.y + px(8)} stroke="var(--gold-hi)" strokeWidth={px(1)} />
              </g>
            );
          })()}
          {single && props.overlays.dims && !single.host && single.levelId === levelId && single.floorId === floorId && dims(single)}
          {single && single.levelId === levelId && single.floorId === floorId && resizable(single) && drag?.kind !== 'move' && (
            <g className="lvl-handles">
              {outlined(single) &&
                (() => {
                  const f = frameOf(set, single, global);
                  const c = corners(f);
                  return (
                    <>
                      {c.map((p, i) => {
                        const q = c[(i + 1) % c.length]!;
                        const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                        return (
                          <circle
                            key={`add${i}`}
                            data-handle={`add-${i}`}
                            cx={mid.x}
                            cy={mid.y}
                            r={px(4)}
                            className="lvl-handle add"
                            fill="var(--gold)"
                            fillOpacity={0.55}
                            onPointerDown={(e) => onInsertDown(e, single, i, mid)}
                          >
                            <title>Drag or click to add a corner</title>
                          </circle>
                        );
                      })}
                      {c.map((p, i) => (
                        <rect
                          key={`corner${i}`}
                          data-handle={`corner-${i}`}
                          x={p.x - px(5)}
                          y={p.y - px(5)}
                          width={px(10)}
                          height={px(10)}
                          transform={`rotate(45 ${p.x} ${p.y})`}
                          className="lvl-handle corner"
                          fill="var(--ground)"
                          stroke="var(--gold-hi)"
                          strokeWidth={px(1.5)}
                          onPointerDown={(e) => onCornerDown(e, single, i)}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            const fewer = removeCorner(project, single.id, i, global);
                            if (fewer !== project) props.onCommit(fewer);
                          }}
                        >
                          <title>Drag to move this corner; double-click to take it out</title>
                        </rect>
                      ))}
                    </>
                  );
                })()}
              {!outlined(single) && HANDLES.map((h) => {
                const f = frameOf(set, single, global);
                const p = toPlan(f, (h.lx * f.w) / 2, (h.ly * f.d) / 2);
                return (
                  <rect
                    key={h.key}
                    data-handle={h.key}
                    x={p.x - px(4.5)}
                    y={p.y - px(4.5)}
                    width={px(9)}
                    height={px(9)}
                    className={`lvl-handle h-${h.key}`}
                    fill="var(--ground)"
                    stroke="var(--gold-hi)"
                    strokeWidth={px(1.5)}
                    onPointerDown={(e) => onHandleDown(e, single, h.key)}
                  />
                );
              })}
              {(() => {
                const f = frameOf(set, single, global);
                const p = toPlan(f, 0, -f.d / 2 - px(26));
                const base = toPlan(f, 0, -f.d / 2);
                return (
                  <>
                    <line x1={base.x} y1={base.y} x2={p.x} y2={p.y} stroke="var(--gold-hi)" strokeWidth={px(1)} pointerEvents="none" />
                    <circle data-handle="rotate" cx={p.x} cy={p.y} r={px(6)} fill="var(--gold)" className="lvl-handle rotate" onPointerDown={(e) => onHandleDown(e, single, 'rotate')} />
                  </>
                );
              })()}
            </g>
          )}
          {draft && (
            <g pointerEvents="none">
              <rect x={draft.minX} y={draft.minY} width={draft.maxX - draft.minX} height={draft.maxY - draft.minY} fill="rgba(201,164,92,0.1)" stroke="var(--gold-hi)" strokeWidth={px(1.5)} />
              <text x={(draft.minX + draft.maxX) / 2} y={(draft.minY + draft.maxY) / 2} fontSize={px(11)} fill="var(--gold-hi)" textAnchor="middle" dominantBaseline="middle">
                {formatLength(draft.maxX - draft.minX, units)} × {formatLength(draft.maxY - draft.minY, units)}
              </text>
            </g>
          )}
          {draftCorners.length > 0 && (
            <g pointerEvents="none" className="lvl-outline-draft">
              {(() => {
                const ahead = pointer ? [...draftCorners, snapPoint(pointer)] : draftCorners;
                const bad = ahead.length >= 3 && selfIntersects(ahead);
                return (
                  <>
                    <polygon points={pointsAttr(ahead)} fill={bad ? 'rgba(229,72,77,0.08)' : 'rgba(201,164,92,0.1)'} stroke="none" />
                    <polyline points={pointsAttr(ahead)} fill="none" stroke={bad ? INVALID_COLOR : 'var(--gold-hi)'} strokeWidth={px(1.5)} />
                    {ahead.length >= 3 && <line x1={ahead[ahead.length - 1]!.x} y1={ahead[ahead.length - 1]!.y} x2={ahead[0]!.x} y2={ahead[0]!.y} stroke="var(--gold-hi)" strokeOpacity={0.4} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
                    {draftCorners.map((p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r={px(i === 0 ? 6 : 3.5)} fill={i === 0 ? 'none' : 'var(--gold-hi)'} stroke="var(--gold-hi)" strokeWidth={px(1.5)} />
                    ))}
                    {pointer && draftCorners.length > 0 && (
                      <text x={snapPoint(pointer).x + px(10)} y={snapPoint(pointer).y - px(10)} fontSize={px(11)} fill="var(--gold-hi)">
                        {formatLength(Math.hypot(snapPoint(pointer).x - draftCorners[draftCorners.length - 1]!.x, snapPoint(pointer).y - draftCorners[draftCorners.length - 1]!.y), units)}
                      </text>
                    )}
                  </>
                );
              })()}
            </g>
          )}
          {props.markers?.map((m) => (
            <g key={m.label} pointerEvents="none" className="lvl-marker">
              <circle cx={m.x} cy={m.y} r={px(9)} fill="rgba(232,200,114,0.25)" stroke="var(--gold-hi)" strokeWidth={px(2)} />
              <circle cx={m.x} cy={m.y} r={px(2.5)} fill="var(--gold-hi)" />
              <text x={m.x + px(12)} y={m.y - px(10)} fontSize={px(12)} fill="var(--gold-hi)" fontWeight={600}>
                {m.label}
              </text>
            </g>
          ))}
          {marquee && <rect x={marquee.minX} y={marquee.minY} width={marquee.maxX - marquee.minX} height={marquee.maxY - marquee.minY} fill="rgba(232,200,114,0.06)" stroke="var(--gold)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" />}
        </g>
      </svg>
    </div>
  );
});
LevelMap.displayName = 'LevelMap';
