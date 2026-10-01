import { patrolStops } from '../../model/level/actors';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { areaOf, assetOf, boundsOf, CATEGORY_COLOR, contains, corners, frameOf, INVALID_COLOR, meshesFor, num, outlineOf, paramOf, selfIntersects, toLocal, toPlan, triangulate, type Frame, type Point } from '../../model/level/geometry';
import { insertCorner, levelsOf, mapGrid, moveCorner, pivotPoint, moveItems, placeAsset, placeAt, removeCorner, resizeItem, setOutline, snap, withGroups } from '../../model/level/level';
import type { AssetCategory, AssetDefinition, LevelItem, LevelSet, TravelKind, TravelLink } from '../../model/level/types';
import { spineSequence } from '../../model/layout';
import { boundsOf as mapBoundsOf, itemsInRoom } from '../../model/level/hierarchy';
import { referenceDepth, referencesOf } from '../../model/level/references';
import { addTravel, moveTravelPoint, travelLabel, travelLength, travelPoints } from '../../model/level/travel';
import type { Project } from '../../model/types';
import { useDragPan, useWheelPanZoom } from '../../use-pan-zoom';
import type { View } from '../../view';
import { formatLength } from './units';

/** Pixels per metre at zoom 1. */
export const PX = 24;

export interface MapApi {
  /** The plan point under a screen point, or null when it is outside the map. */
  worldAt: (clientX: number, clientY: number) => Point | null;
  /** Bring these items (or the whole floor) into view. */
  frame: (ids?: readonly string[]) => void;
}

/** Select and move; drag out a rectangle; click the corners of a freeform outline; or draw a route between places. */
export type MapTool = 'select' | 'draw' | 'outline' | 'route';

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
  overlays: { story: boolean; dims: boolean; ghost: boolean };
  tool: MapTool;
  /** What the draw tool draws. */
  drawAsset: string;
  /** What the route tool draws (spec V2 §5). */
  routeKind?: TravelKind;
  /** A room being detailed (spec V2 §7): the rest of the floor dims and stays put. */
  focusRoom?: string | null;
  /** An asset picked up from the library: the next click puts it down. */
  placing: string | null;
  onPlace: (at: Point) => void;
  onOpen3D: (id: string) => void;
  onHover: (at: Point | null) => void;
  issues: ReadonlyMap<string, string>;
}

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
    const move = (e: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const at = toWorld(e.clientX, e.clientY);
      if (cur.kind === 'move') {
        const dx = at.x - cur.start.x;
        const dy = at.y - cur.start.y;
        const moved = cur.moved || Math.hypot(dx, dy) * scale > 3;
        if (moved) setPreview(moveItems(project, cur.ids, dx, dy, global));
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
        setPreview(placeAt(resizeItem(project, cur.id, { w, d: dd }, global), cur.id, { x: Math.round((f.x + shift.x) * 1000) / 1000, y: Math.round((f.y + shift.y) * 1000) / 1000 }));
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
        setDrag({ ...cur, at });
      }
    };
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const cur = dragRef.current;
      const done = previewRef.current;
      setDrag(null);
      setPreview(null);
      if (cur?.kind === 'draw') {
        const at = toWorld(e.clientX, e.clientY);
        const s = levelsOf(project);
        const b = boundsOf([{ x: snap(s, cur.start.x, undefined, levelId), y: snap(s, cur.start.y, undefined, levelId) }, { x: snap(s, at.x, undefined, levelId), y: snap(s, at.y, undefined, levelId) }]);
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
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
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
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
          {radius > 0 && <circle cx={f.x} cy={f.y} r={radius} fill={color} fillOpacity={0.08} stroke={color} strokeOpacity={0.5} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
          <polygon points={pointsAttr([nose, left, right])} fill={color} />
          <circle cx={f.x} cy={f.y} r={r} fill="var(--node)" stroke={color} strokeWidth={px(2)} />
          {label(ROLE_GLYPH[def.role] ?? def.name[0]!, f, 10, color)}
          {!faint && NAMED_MARKERS.has(def.role) && (
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
          {/* Picked by its edge, so a zone over a whole room doesn't take the room's clicks. */}
          <polygon points={poly} fill={color} fillOpacity={0.08} stroke={color} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
          <polygon points={poly} fill="none" stroke="transparent" strokeWidth={px(10)} pointerEvents="stroke" />
          {!faint && (
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
        {arrow && (
          <polyline points={pointsAttr([toPlan(f, 0, f.d * 0.35), toPlan(f, 0, -f.d * 0.35), toPlan(f, -f.w * 0.2, -f.d * 0.2), toPlan(f, 0, -f.d * 0.35), toPlan(f, f.w * 0.2, -f.d * 0.2)])} fill="none" stroke={color} strokeWidth={px(1.5)} />
        )}
        {!faint && f.w * scale > 60 && label(item.name, f, 10, 'var(--text-soft)')}
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

  const draft = drag?.kind === 'draw' ? boundsOf([{ x: snap(set, drag.start.x, undefined, levelId), y: snap(set, drag.start.y, undefined, levelId) }, { x: snap(set, drag.at.x, undefined, levelId), y: snap(set, drag.at.y, undefined, levelId) }]) : null;
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
        if (props.tool === 'outline' || props.tool === 'route') setPointer(at);
      }}
      onPointerLeave={() => {
        props.onHover(null);
        setPointer(null);
      }}
      onDoubleClick={() => {
        if (props.tool === 'outline' && draftCorners.length >= 3) finishOutline(draftCorners);
        // The double-click's two clicks each put a point down: the last is a repeat.
        if (props.tool === 'route' && draftRoute) finishRoute(draftRoute);
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
          {marquee && <rect x={marquee.minX} y={marquee.minY} width={marquee.maxX - marquee.minX} height={marquee.maxY - marquee.minY} fill="rgba(232,200,114,0.06)" stroke="var(--gold)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" />}
        </g>
      </svg>
    </div>
  );
});
LevelMap.displayName = 'LevelMap';
