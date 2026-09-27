import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { areaOf, assetOf, boundsOf, CATEGORY_COLOR, contains, corners, frameOf, INVALID_COLOR, meshesFor, num, outlineOf, paramOf, selfIntersects, toLocal, toPlan, triangulate, type Frame, type Point } from '../../model/level/geometry';
import { insertCorner, levelsOf, moveCorner, pivotPoint, moveItems, placeAsset, placeAt, removeCorner, resizeItem, setOutline, snap, withGroups } from '../../model/level/level';
import type { AssetCategory, AssetDefinition, LevelItem, LevelSet } from '../../model/level/types';
import { spineSequence } from '../../model/layout';
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

/** Select and move; drag out a rectangle; or click the corners of a freeform outline. */
export type MapTool = 'select' | 'draw' | 'outline';

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
  | { kind: 'marquee'; start: Point; at: Point; base: string[] };

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

const ROLE_GLYPH: Partial<Record<string, string>> = {
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
  const [pointer, setPointer] = useState<Point | null>(null);
  const shown = preview ?? project;
  const set = levelsOf(shown);
  const level = set.levels.find((l) => l.id === levelId);
  const scale = PX * view.zoom;

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
    if (!items.length) {
      setView(() => ({ zoom: 1, panX: r.width / 2, panY: r.height / 2 }));
      return;
    }
    const b = boundsOf(items.flatMap((i) => corners(frameOf(s, i, global))));
    const w = Math.max(4, b.maxX - b.minX);
    const h = Math.max(4, b.maxY - b.minY);
    const zoom = Math.min(4, Math.max(0.1, Math.min((r.width - 120) / (w * PX), (r.height - 120) / (h * PX))));
    setView(() => ({ zoom, panX: r.width / 2 - ((b.minX + b.maxX) / 2) * PX * zoom, panY: r.height / 2 - ((b.minY + b.maxY) / 2) * PX * zoom }));
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
        const step = s.settings.snap ? s.settings.grid : 0.01;
        const w = h.lx ? Math.max(step, snap(s, f.w + h.lx * d0.x)) : f.w;
        const dd = h.ly ? Math.max(step, snap(s, f.d + h.ly * d0.y)) : f.d;
        // The opposite edge stays where it is.
        const shift = toPlan({ ...f, x: 0, y: 0 }, (h.lx * (w - f.w)) / 2, (h.ly * (dd - f.d)) / 2);
        setPreview(placeAt(resizeItem(project, cur.id, { w, d: dd }, global), cur.id, { x: Math.round((f.x + shift.x) * 1000) / 1000, y: Math.round((f.y + shift.y) * 1000) / 1000 }));
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
        const b = boundsOf([{ x: snap(s, cur.start.x), y: snap(s, cur.start.y) }, { x: snap(s, at.x), y: snap(s, at.y) }]);
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
    if (e.button === 0 && e.shiftKey) {
      beginWindowDrag({ kind: 'marquee', start: at, at, base: [...selection] });
      return;
    }
    pan(e);
  };

  const onItemDown = (e: React.PointerEvent, item: LevelItem) => {
    if (e.button !== 0) return;
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
    return { x: snap(s, p.x), y: snap(s, p.y) };
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
  const grid = set.settings.grid || 0.5;
  const minor = grid * scale >= 7 ? grid : grid * Math.ceil(7 / (grid * scale));
  const selected = new Set(selection);
  const single = selection.length === 1 ? set.items.find((i) => i.id === selection[0]) : undefined;

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

  const draft = drag?.kind === 'draw' ? boundsOf([{ x: snap(set, drag.start.x), y: snap(set, drag.start.y) }, { x: snap(set, drag.at.x), y: snap(set, drag.at.y) }]) : null;
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
        if (props.tool === 'outline') setPointer(at);
      }}
      onPointerLeave={() => {
        props.onHover(null);
        setPointer(null);
      }}
      onDoubleClick={() => props.tool === 'outline' && draftCorners.length >= 3 && finishOutline(draftCorners)}
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
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="url(#lvl-major)" pointerEvents="none" />
          <line x1={-5000} y1={0} x2={5000} y2={0} stroke="#3a3218" strokeWidth={px(1)} pointerEvents="none" />
          <line x1={0} y1={-5000} x2={0} y2={5000} stroke="#3a3218" strokeWidth={px(1)} pointerEvents="none" />
          {ghost.length > 0 && (
            <g opacity={0.22} pointerEvents="none" className="lvl-ghost">
              {ghost.map((i) => drawItem(i, true))}
            </g>
          )}
          {[...items].sort((a, b) => order(a) - order(b)).filter((i) => assetOf(set, i, global).kind === 'space').map((i) => drawItem(i))}
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
          {[...items].sort((a, b) => order(a) - order(b)).filter((i) => assetOf(set, i, global).kind !== 'space').map((i) => drawItem(i))}
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
