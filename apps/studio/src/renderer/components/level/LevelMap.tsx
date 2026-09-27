import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { assetOf, boundsOf, CATEGORY_COLOR, corners, frameOf, INVALID_COLOR, meshesFor, num, paramOf, toLocal, toPlan, type Frame, type Point } from '../../model/level/geometry';
import { levelsOf, moveItems, placeAsset, placeAt, resizeItem, snap, withGroups } from '../../model/level/level';
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

export type MapTool = 'select' | 'draw';

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
    if (e.button === 0 && e.shiftKey) {
      beginWindowDrag({ kind: 'marquee', start: at, at, base: [...selection] });
      return;
    }
    pan(e);
  };

  const onItemDown = (e: React.PointerEvent, item: LevelItem) => {
    if (e.button !== 0) return;
    if (props.placing || props.tool === 'draw') {
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
          {!faint && label(item.name, { x: f.x, y: f.y - px(7) }, 12, 'var(--text)')}
          {!faint && label(`${formatLength(f.w, units)} × ${formatLength(f.d, units)}`, { x: f.x, y: f.y + px(8) }, 10, 'var(--muted)')}
        </g>
      );
    }
    if (def.kind === 'hosted') {
      const swing = String(paramOf(set, item, 'swing', global) ?? 'in');
      // Local +y points into the room from the north and east walls, out of it from the south and west.
      const inward = item.host && item.host.wall < 2 ? 1 : -1;
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
      className={`lvl-map${props.tool === 'draw' || props.placing ? ' is-drawing' : ''}`}
      onPointerDown={onBackgroundDown}
      onPointerMove={(e) => props.onHover(toWorld(e.clientX, e.clientY))}
      onPointerLeave={() => props.onHover(null)}
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
          {single && props.overlays.dims && !single.host && single.levelId === levelId && single.floorId === floorId && dims(single)}
          {single && single.levelId === levelId && single.floorId === floorId && resizable(single) && drag?.kind !== 'move' && (
            <g className="lvl-handles">
              {HANDLES.map((h) => {
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
          {marquee && <rect x={marquee.minX} y={marquee.minY} width={marquee.maxX - marquee.minX} height={marquee.maxY - marquee.minY} fill="rgba(232,200,114,0.06)" stroke="var(--gold)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" />}
        </g>
      </svg>
    </div>
  );
});
LevelMap.displayName = 'LevelMap';
