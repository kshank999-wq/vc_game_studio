import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { laneRows, laneSequence, nodeBox, nodeSize, spanRange, spineSequence, type Box, type LaneRow } from '../../model/layout';
import {
  canPlace,
  connect,
  connectionRefusal,
  isProtected,
  laneNodeCount,
  moveNode,
  placeNew,
  relabelConnection,
  removeLane,
  renameObject,
  setOutcome,
  setPolarity,
  setSpanEdge,
  updateLane,
} from '../../model/project';
import { SCENE_ONLY, TYPE_LABEL } from '../../model/semantics';
import { categoryCounts } from '../../model/scene';
import type { Connection, Lane, ObjectType, Project } from '../../model/types';
import { useWheelPanZoom } from '../../use-pan-zoom';
import { HEADER_W, type View } from '../../view';
import { connectionCurve, draftCurve, subplotPath, type Point } from './geometry';
import { Minimap } from './Minimap';
import { NodeView, type PortState } from './NodeView';
import { SubplotBand, TrackBand, TrackHeader, type LaneControls, type LaneField } from './Tracks';

/** A node being dragged in from the palette (or placed with a click). */
export interface PaletteDrag {
  type: ObjectType;
  clientX: number;
  clientY: number;
  moved: boolean;
  placing: boolean;
}

export interface CanvasApi {
  /** Drop the palette node where the pointer is. False when that is not a valid place. */
  drop: (drag: PaletteDrag) => boolean;
  /** The canvas area in pixels, above the bottom bar. */
  size: () => { w: number; h: number };
  /** Start renaming a node, or editing a connector's label, in place. */
  rename: (id: string) => void;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  view: View;
  setView: (update: (view: View) => View) => void;
  /** A node id or a connection id. */
  selection: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  paletteDrag: PaletteDrag | null;
  bottomInset: number;
  issues: Map<string, string>;
  /** Ask before a change that removes more than the user pointed at. */
  onConfirm: (request: ConfirmRequest) => void;
  onSay: (message: string) => void;
  /** Open a scene to write it, or explode it into its mind map. */
  onOpenScene: (sceneId: string, mode: 'open' | 'exploded' | 'timeline') => void;
}

type Target = { ok: true; laneId: string | null; x: number; y: number } | { ok: false; reason: string };

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number; moved: boolean }
  | { kind: 'node'; id: string; startX: number; startY: number; x0: number; y0: number; moved: boolean }
  | { kind: 'span'; laneId: string; edge: 'start' | 'end' }
  | { kind: 'link'; sourceId: string };

interface Link {
  sourceId: string;
  to: Point;
  targetId: string | null;
  refusal: string | null;
}

type Menu = { kind: 'node' | 'connection'; id: string; sx: number; sy: number };

const REFUSAL: Record<Lane['kind'], string> = {
  spine: 'The spine takes plot points, scenes, cinematics and choices',
  subplot: 'Subplots take plot points, choices and scenes',
  character: 'Character lanes take arc events',
};

/** How far past a subplot band's ends a drop still counts as dropping into it. */
const BAND_REACH = { before: 80, after: 240 };

/** Half the size of the connector layer; it is centred on the world origin. */
const LAYER = 20000;

const rowAt = (project: Project, rows: LaneRow[], x: number, y: number): LaneRow | undefined =>
  rows.find((r) => {
    if (y < r.top || y > r.top + r.height) return false;
    if (r.lane.kind !== 'subplot') return true;
    const range = spanRange(project, r.lane);
    return !!range && x >= range.from - BAND_REACH.before && x <= range.to + BAND_REACH.after;
  });

const nodeAt = (project: Project, rows: LaneRow[], p: Point, except?: string): string | null => {
  const slop = 6;
  for (const id of Object.keys(project.placements)) {
    if (id === except) continue;
    const b = nodeBox(project, id, rows);
    if (b && p.x >= b.x - slop && p.x <= b.x + b.w + slop && p.y >= b.y - slop && p.y <= b.y + b.h + slop) return id;
  }
  return null;
};

export const StoryCanvas = forwardRef<CanvasApi, Props>(function StoryCanvas(props, ref) {
  const { project, view, paletteDrag } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1176, h: 848 });
  const [preview, setPreview] = useState<Project | null>(null);
  const [link, setLink] = useState<Link | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingLane, setEditingLane] = useState<{ laneId: string; field: LaneField } | null>(null);
  const [laneMenu, setLaneMenu] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setSize({ w: root.clientWidth, h: root.clientHeight }));
    observer.observe(root);
    setSize({ w: root.clientWidth, h: root.clientHeight });
    return () => observer.disconnect();
  }, []);

  const toWorld = (clientX: number, clientY: number, v: View = view) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    return { sx, sy, x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
  };

  // ------------------------------------------------------------ palette drops

  const targetAt = (drag: PaletteDrag): Target | null => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const inside =
      drag.clientX >= rect.left &&
      drag.clientX <= rect.right &&
      drag.clientY >= rect.top &&
      drag.clientY <= rect.bottom - props.bottomInset;
    if (!inside) return null;
    if (SCENE_ONLY.includes(drag.type)) return { ok: false, reason: `${TYPE_LABEL[drag.type]} goes inside a scene` };
    const { x, y } = toWorld(drag.clientX, drag.clientY);
    const rows = laneRows(project);
    const row = rowAt(project, rows, x, y);
    if (row) {
      if (row.lane.locked && row.lane.kind !== 'spine') return { ok: false, reason: 'This lane is locked' };
      if (!canPlace(project, drag.type, row.lane.id)) return { ok: false, reason: REFUSAL[row.lane.kind] };
      return { ok: true, laneId: row.lane.id, x: x - nodeSize(drag.type, row.lane.kind).w / 2, y: 0 };
    }
    if (y < 0) {
      if (!canPlace(project, drag.type, null)) return { ok: false, reason: `${TYPE_LABEL[drag.type]}s go on a character lane` };
      const size = nodeSize(drag.type);
      return { ok: true, laneId: null, x: x - size.w / 2, y: y - size.h / 2 };
    }
    return { ok: false, reason: 'Drop on the spine or a lane, or above the spine for a branch' };
  };

  const target = paletteDrag && (paletteDrag.moved || paletteDrag.placing) ? targetAt(paletteDrag) : null;
  const targetKey = target?.ok ? `${target.laneId}:${Math.round(target.x)}:${Math.round(target.y)}` : '';
  const dropPreview = useMemo(
    () => (paletteDrag && target?.ok ? placeNew(project, paletteDrag.type, target.laneId, target.x, target.y) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, paletteDrag?.type, targetKey],
  );

  useImperativeHandle(ref, () => ({
    drop: (drag) => {
      const t = targetAt(drag);
      if (!t?.ok) return false;
      const placed = placeNew(project, drag.type, t.laneId, t.x, t.y);
      if (!placed) return false;
      props.onCommit(placed.project);
      props.onSelect(placed.id);
      return true;
    },
    size: () => ({ w: size.w, h: size.h - props.bottomInset }),
    rename: (id) => setEditing(id),
  }));

  useWheelPanZoom(rootRef, props.setView);

  const shown = preview ?? dropPreview?.project ?? project;
  const ghostId = !preview && dropPreview ? dropPreview.id : null;
  const rows = laneRows(shown);

  // ------------------------------------------------------------ gestures

  // Gestures listen on the window, so a drag keeps going outside the canvas
  // and a node still gets its double-click. Handlers read the latest render
  // through a ref.
  const latest = useRef({ project, view, preview, link });
  latest.current = { project, view, preview, link };

  const nearestSpineNode = (x: number): string | null => {
    const current = latest.current.project;
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const id of spineSequence(current)) {
      const object = current.objects[id];
      const placement = current.placements[id];
      if (!object || !placement) continue;
      const distance = Math.abs(placement.x + nodeSize(object.type).w / 2 - x);
      if (distance < bestDistance) {
        best = id;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onMove = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const { project: current, view: v } = latest.current;
    if (g.kind === 'pan') {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      props.setView((old) => ({ ...old, panX: g.panX + dx, panY: g.panY + dy }));
    } else if (g.kind === 'node') {
      const dx = (e.clientX - g.startX) / v.zoom;
      const dy = (e.clientY - g.startY) / v.zoom;
      if (Math.hypot(dx, dy) * v.zoom > 3) g.moved = true;
      if (g.moved) setPreview(moveNode(current, g.id, g.x0 + dx, g.y0 + dy));
    } else if (g.kind === 'span') {
      const ref = nearestSpineNode(toWorld(e.clientX, e.clientY, v).x);
      if (ref) setPreview(setSpanEdge(current, g.laneId, g.edge, ref));
    } else {
      const p = toWorld(e.clientX, e.clientY, v);
      const to = { x: p.x, y: p.y };
      const targetId = nodeAt(current, laneRows(current), to, g.sourceId);
      setLink({
        sourceId: g.sourceId,
        to,
        targetId,
        refusal: targetId ? connectionRefusal(current, g.sourceId, targetId) : null,
      });
    }
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const { project: current, preview: pending, link: pendingLink } = latest.current;
    if (g.kind === 'pan' && !g.moved) props.onSelect(null);
    if ((g.kind === 'node' && g.moved) || g.kind === 'span') {
      if (pending && pending !== current) props.onCommit(pending);
    }
    if (g.kind === 'link' && pendingLink?.targetId) {
      const result = connect(current, g.sourceId, pendingLink.targetId);
      if ('error' in result) props.onSay(result.error);
      else {
        props.onCommit(result.project);
        props.onSelect(result.id);
      }
    }
    setPreview(null);
    setLink(null);
  };

  const begin = (g: Gesture) => {
    gesture.current = g;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const closeMenus = () => {
    setLaneMenu(null);
    setMenu(null);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    // While a palette node is being placed, the click is the drop.
    if (paletteDrag) return;
    // Left-drag on empty canvas pans; middle-drag pans anywhere, even over a node.
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    closeMenus();
    begin({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY, moved: false });
  };

  const onNodeDown = (e: React.PointerEvent, id: string) => {
    if (paletteDrag || e.button !== 0) return;
    e.stopPropagation();
    closeMenus();
    props.onSelect(id);
    const placement = project.placements[id];
    if (!placement || isProtected(project, id)) return;
    const lane = project.lanes.find((l) => l.id === placement.laneId);
    if (placement.laneId !== null && (!lane || (lane.locked && lane.kind !== 'spine'))) return;
    begin({ kind: 'node', id, startX: e.clientX, startY: e.clientY, x0: placement.x, y0: placement.y, moved: false });
  };

  const onPortDown = (e: React.PointerEvent, id: string) => {
    if (paletteDrag || e.button !== 0) return;
    e.stopPropagation();
    closeMenus();
    const p = toWorld(e.clientX, e.clientY);
    setLink({ sourceId: id, to: { x: p.x, y: p.y }, targetId: null, refusal: null });
    begin({ kind: 'link', sourceId: id });
  };

  const onHandleDown = (e: React.PointerEvent, laneId: string, edge: 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin({ kind: 'span', laneId, edge });
  };

  const openMenu = (e: React.MouseEvent, kind: Menu['kind'], id: string) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toWorld(e.clientX, e.clientY);
    props.onSelect(id);
    setLaneMenu(null);
    setMenu({ kind, id, sx: p.sx, sy: p.sy });
  };

  // ------------------------------------------------------------ lanes

  const commitLane = (laneId: string, patch: Parameters<typeof updateLane>[2]) => props.onCommit(updateLane(project, laneId, patch));

  const deleteLane = (lane: Lane) => {
    setLaneMenu(null);
    const count = laneNodeCount(project, lane.id);
    const remove = () => props.onCommit(removeLane(project, lane.id));
    if (count === 0) {
      remove();
      return;
    }
    props.onConfirm({
      title: `Delete “${lane.name}”?`,
      message: `The ${count} node${count === 1 ? '' : 's'} on this lane will be deleted with it. Undo brings them back.`,
      confirmLabel: 'Delete lane',
      onConfirm: remove,
    });
  };

  const laneControls = (lane: Lane): LaneControls => ({
    editing: editingLane?.laneId === lane.id ? editingLane.field : null,
    menuOpen: laneMenu === lane.id,
    onEdit: (field) => {
      setLaneMenu(null);
      setEditingLane({ laneId: lane.id, field });
    },
    onEditDone: (field, value) => {
      setEditingLane(null);
      if (value !== null) commitLane(lane.id, { [field]: value });
    },
    onToggleVisible: () => {
      setLaneMenu(null);
      commitLane(lane.id, { visible: !lane.visible });
    },
    onToggleLock: () => commitLane(lane.id, { locked: !lane.locked }),
    onMenu: () => {
      setMenu(null);
      setLaneMenu(laneMenu === lane.id ? null : lane.id);
    },
    onDelete: () => deleteLane(lane),
  });

  // ------------------------------------------------------------ render

  const screenY = (worldY: number) => worldY * view.zoom + view.panY;
  const lastRow = rows[rows.length - 1];
  const tracksBottom = lastRow ? screenY(lastRow.top + lastRow.height) : 0;
  const hasBranches = Object.values(shown.placements).some((p) => p.laneId === null);
  const firstSpine = spineSequence(shown)[0];
  const firstBox = firstSpine ? nodeBox(shown, firstSpine, rows) : null;
  const gridStep = 24 * view.zoom < 12 ? 48 * view.zoom : 24 * view.zoom;

  const portState = (id: string): PortState => {
    if (!link || link.targetId !== id) return 'none';
    return link.refusal ? 'invalid' : 'valid';
  };

  const laneOf = (id: string): Lane | undefined => rows.find((r) => r.lane.id === shown.placements[id]?.laneId)?.lane;

  return (
    <div
      ref={rootRef}
      className={`canvas${paletteDrag ? ' dropping' : ''}${link ? ' linking' : ''}`}
      aria-label="Story canvas"
      style={{ backgroundSize: `${gridStep}px ${gridStep}px`, backgroundPosition: `${view.panX}px ${view.panY}px` }}
      onPointerDown={onBackgroundDown}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* The spine and character arcs run the whole story: full-width bands at every pan. */}
      {rows.map((row) =>
        row.lane.kind === 'subplot' ? null : (
          <TrackBand key={row.lane.id} row={row} top={screenY(row.top)} height={row.height * view.zoom} empty={laneSequence(shown, row.lane.id).length === 0} />
        ),
      )}

      <div className="world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        {!hasBranches && firstBox && (
          <div className="branch-hint" style={{ left: firstBox.x, top: -96 }}>
            Branches and alternate routes float up here. Drop a scene or choice above the spine, then drag from a gold ring to connect.
          </div>
        )}

        {rows.map((row) =>
          row.lane.kind === 'subplot' ? (
            <SubplotBand
              key={row.lane.id}
              project={shown}
              row={row}
              empty={laneSequence(shown, row.lane.id).length === 0}
              controls={laneControls(row.lane)}
              onHandleDown={onHandleDown}
            />
          ) : null,
        )}

        <Connectors
          project={shown}
          rows={rows}
          selection={props.selection}
          link={link}
          onSelect={(id) => {
            closeMenus();
            props.onSelect(id);
          }}
          onEditLabel={(id) => setEditing(id)}
          onMenu={(e, id) => openMenu(e, 'connection', id)}
        />

        {Object.keys(shown.placements).map((id) => {
          const object = shown.objects[id];
          const box = nodeBox(shown, id, rows);
          if (!object || !box) return null;
          const lane = laneOf(id);
          return (
            <NodeView
              key={id}
              object={object}
              place={shown.placements[id]?.laneId === null ? 'branch' : (lane?.kind ?? 'spine')}
              laneColor={lane?.color}
              box={box}
              selected={props.selection === id}
              ghost={id === ghostId}
              editing={editing === id}
              issue={props.issues.get(id)}
              target={portState(id)}
              onPointerDown={(e) => onNodeDown(e, id)}
              onPortDown={(e) => onPortDown(e, id)}
              onDoubleClick={() => (object.type === 'scene' ? props.onOpenScene(id, 'open') : setEditing(id))}
              onContextMenu={(e) => openMenu(e, 'node', id)}
              detail={object.type === 'scene' ? sceneDetail(shown, id) : undefined}
              onRename={(name) => {
                setEditing(null);
                props.onCommit(renameObject(project, id, name));
              }}
              onCancelRename={() => setEditing(null)}
            />
          );
        })}

        {props.selection && shown.objects[props.selection]?.type === 'scene' && !preview && (() => {
          const box = nodeBox(shown, props.selection, rows);
          if (!box) return null;
          const id = props.selection;
          return (
            <div className="quick-actions" style={{ left: box.x - 10, top: box.y - 36 }} onPointerDown={(e) => e.stopPropagation()}>
              <button className="on" onClick={() => props.onOpenScene(id, 'open')}>
                Open
              </button>
              <button onClick={() => props.onOpenScene(id, 'exploded')}>Explode</button>
              <button onClick={() => props.onOpenScene(id, 'timeline')}>Timeline</button>
            </div>
          );
        })()}

        <Pills
          project={shown}
          rows={rows}
          selection={props.selection}
          editing={editing}
          onSelect={(id) => {
            closeMenus();
            props.onSelect(id);
          }}
          onEdit={(id) => setEditing(id)}
          onMenu={(e, id) => openMenu(e, 'connection', id)}
          onDone={(id, label) => {
            setEditing(null);
            if (label !== null) props.onCommit(relabelConnection(project, id, label));
          }}
        />
      </div>

      {/* Sticky headers for the tracks that run the whole story. */}
      {rows.map((row) =>
        row.lane.kind === 'subplot' ? null : (
          <TrackHeader key={row.lane.id} lane={row.lane} top={screenY(row.top)} height={row.height * view.zoom} controls={laneControls(row.lane)} />
        ),
      )}

      <div className="continues" style={{ top: screenY(0), height: Math.max(0, tracksBottom - screenY(0)) }} aria-hidden="true">
        <span className="continues-mark" style={{ top: 6 * Math.min(1, view.zoom) }}>
          <span>»</span>CONTINUES
        </span>
      </div>

      {target && !target.ok && paletteDrag && (
        <div className="drop-refusal" style={{ left: toWorld(paletteDrag.clientX, 0).sx + 12, top: toWorld(0, paletteDrag.clientY).sy + 50 }}>
          {target.reason}
        </div>
      )}
      {link?.refusal && (
        <div className="drop-refusal" style={{ left: link.to.x * view.zoom + view.panX + 14, top: link.to.y * view.zoom + view.panY + 18 }}>
          {link.refusal}
        </div>
      )}

      {menu && (
        <ContextMenu
          menu={menu}
          project={project}
          onClose={() => setMenu(null)}
          onCommit={props.onCommit}
          onRename={(id) => setEditing(id)}
          onDelete={props.onDelete}
          onOpenScene={props.onOpenScene}
        />
      )}

      <Minimap
        project={shown}
        view={view}
        width={size.w}
        height={size.h - props.bottomInset}
        onJump={(x, y) =>
          props.setView((v) => ({ ...v, panX: (size.w + HEADER_W) / 2 - x * v.zoom, panY: (size.h - props.bottomInset) / 2 - y * v.zoom }))
        }
      />
    </div>
  );
});

// ---------------------------------------------------------------- connectors

const flowPath = (project: Project, row: LaneRow, rows: LaneRow[]): string => {
  const boxes = laneSequence(project, row.lane.id)
    .map((id) => nodeBox(project, id, rows))
    .filter((b): b is Box => b !== null);
  const y = row.top + row.height / 2;
  return boxes
    .slice(1)
    .map((box, i) => `M${boxes[i]!.x + boxes[i]!.w} ${y} H${box.x}`)
    .join(' ');
};

const Connectors = ({ project, rows, selection, link, onSelect, onEditLabel, onMenu }: {
  project: Project;
  rows: LaneRow[];
  selection: string | null;
  link: Link | null;
  onSelect: (id: string) => void;
  onEditLabel: (id: string) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
}) => {
  const laneColorOf = (id: string): string | undefined => {
    const laneId = project.placements[id]?.laneId;
    return project.lanes.find((l) => l.id === laneId)?.color;
  };
  const draftFrom = link ? nodeBox(project, link.sourceId, rows) : null;
  const draftTo = link?.targetId ? nodeBox(project, link.targetId, rows) : null;
  return (
    <svg className="connectors" style={{ left: -LAYER, top: -LAYER }} width={LAYER * 2} height={LAYER * 2} aria-hidden="true">
      <g transform={`translate(${LAYER} ${LAYER})`}>
        {rows.map((row) => {
          if (row.lane.kind === 'subplot') {
            const path = subplotPath(project, row, rows);
            if (!path) return null;
            return (
              <g key={row.lane.id} className="subplot-path" style={{ stroke: path.color }}>
                <path className="subplot-leg" d={path.branchOff} />
                <path className="subplot-leg" d={path.rejoin} />
                <path className={`subplot-through${path.empty ? ' empty' : ''}`} d={path.through} />
              </g>
            );
          }
          const d = flowPath(project, row, rows);
          return d ? <path key={row.lane.id} className={`flow flow-${row.lane.kind}`} style={{ stroke: row.lane.kind === 'character' ? row.lane.color : undefined }} d={d} /> : null;
        })}

        {project.connections.map((c: Connection) => {
          const shape = connectionCurve(project, c, rows);
          if (!shape) return null;
          const color =
            c.kind === 'arcEvent' ? laneColorOf(c.sourceId) : c.kind === 'laneTie' ? 'var(--c-subplot)' : undefined;
          return (
            <g key={c.id} className={`connection connection-${c.kind}${selection === c.id ? ' selected' : ''}`}>
              <path className="connection-line" d={shape.d} style={color ? { stroke: color } : undefined} />
              <path
                className="connection-hit"
                d={shape.d}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  onSelect(c.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (c.kind === 'branch') onEditLabel(c.id);
                }}
                onContextMenu={(e) => onMenu(e, c.id)}
              >
                <title>{c.kind === 'branch' ? 'Branch — double-click to label it' : c.kind === 'arcEvent' ? 'Arc event tie' : 'Lane tie'}</title>
              </path>
            </g>
          );
        })}

        {link && draftFrom && (
          <path
            className={`draft${link.refusal ? ' refused' : link.targetId ? ' valid' : ''}`}
            d={draftCurve(draftFrom, draftTo ? { x: draftTo.x, y: draftTo.y + draftTo.h / 2 } : link.to).d}
          />
        )}
      </g>
    </svg>
  );
};

/** The label pills on branches: a choice's options, or any route worth naming. */
const Pills = ({ project, rows, selection, editing, onSelect, onEdit, onMenu, onDone }: {
  project: Project;
  rows: LaneRow[];
  selection: string | null;
  editing: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onMenu: (e: React.MouseEvent, id: string) => void;
  onDone: (id: string, label: string | null) => void;
}) => (
  <>
    {project.connections.map((c) => {
      if (c.kind !== 'branch' || (!c.label && editing !== c.id)) return null;
      const shape = connectionCurve(project, c, rows);
      if (!shape) return null;
      return (
        <div
          key={c.id}
          className={`pill-label${selection === c.id ? ' selected' : ''}`}
          style={{ left: shape.mid.x, top: shape.mid.y }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            onSelect(c.id);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            onEdit(c.id);
          }}
          onContextMenu={(e) => onMenu(e, c.id)}
          title="Double-click to edit"
        >
          {editing === c.id ? (
            <input
              aria-label="Option text"
              defaultValue={c.label ?? ''}
              placeholder="Option text"
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => onDone(c.id, e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') onDone(c.id, null);
              }}
            />
          ) : (
            c.label
          )}
        </div>
      );
    })}
  </>
);

// ---------------------------------------------------------------- context menu

const ContextMenu = ({ menu, project, onClose, onCommit, onRename, onDelete, onOpenScene }: {
  menu: Menu;
  project: Project;
  onClose: () => void;
  onCommit: (project: Project) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenScene: (id: string, mode: 'open' | 'exploded' | 'timeline') => void;
}) => {
  const item = (label: string, action: () => void, className?: string, checked?: boolean) => (
    <button
      key={label}
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      className={className}
      onClick={() => {
        action();
        onClose();
      }}
    >
      {checked !== undefined && <span className="menu-check">{checked ? '●' : ''}</span>}
      {label}
    </button>
  );
  const items: React.ReactNode[] = [];
  if (menu.kind === 'connection') {
    const c = project.connections.find((x) => x.id === menu.id);
    if (!c) return null;
    if (c.kind === 'branch') items.push(item(c.label ? 'Edit label' : 'Add label', () => onRename(c.id)));
    items.push(item('Delete connection', () => onDelete(c.id), 'danger'));
  } else {
    const object = project.objects[menu.id];
    const placement = project.placements[menu.id];
    if (!object || !placement) return null;
    if (object.type === 'scene') {
      items.push(item('Open scene', () => onOpenScene(object.id, 'open')));
      items.push(item('Explode scene', () => onOpenScene(object.id, 'exploded')));
      items.push(item('Scene timeline', () => onOpenScene(object.id, 'timeline')));
      items.push(<div key="sep0" className="menu-sep" />);
    }
    items.push(item('Rename', () => onRename(object.id)));
    if (placement.laneId === null && object.type !== 'choice') {
      const outcome = object.data.outcome ?? null;
      items.push(<div key="sep1" className="menu-sep" />);
      items.push(item('Continues the story', () => onCommit(setOutcome(project, object.id, null)), undefined, outcome === null));
      items.push(item('Alternate ending', () => onCommit(setOutcome(project, object.id, 'ending')), undefined, outcome === 'ending'));
      items.push(item('Game over', () => onCommit(setOutcome(project, object.id, 'gameOver')), undefined, outcome === 'gameOver'));
    }
    if (object.type === 'arcEvent') {
      const polarity = object.data.polarity ?? 'up';
      items.push(<div key="sep2" className="menu-sep" />);
      items.push(item('+ Growth', () => onCommit(setPolarity(project, object.id, 'up')), undefined, polarity === 'up'));
      items.push(item('− Setback', () => onCommit(setPolarity(project, object.id, 'down')), undefined, polarity === 'down'));
      items.push(item('◆ Turning point', () => onCommit(setPolarity(project, object.id, 'turn')), undefined, polarity === 'turn'));
    }
    if (!isProtected(project, object.id)) {
      items.push(<div key="sep3" className="menu-sep" />);
      items.push(item('Delete', () => onDelete(object.id), 'danger'));
    }
  }
  return (
    <div className="context-menu" role="menu" style={{ left: menu.sx, top: menu.sy }} onPointerDown={(e) => e.stopPropagation()}>
      {items}
    </div>
  );
};

/** What a collapsed scene card says about what is inside it (spec §9: minimal status). */
const sceneDetail = (project: Project, id: string): string | undefined => {
  const summary = project.objects[id]?.data.summary;
  if (typeof summary === 'string' && summary) return summary;
  const counts = categoryCounts(project, id);
  const parts = [
    counts.characters && `${counts.characters} character${counts.characters === 1 ? '' : 's'}`,
    counts.dialogue && `${counts.dialogue} line${counts.dialogue === 1 ? '' : 's'}`,
    counts.objects && `${counts.objects} object${counts.objects === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
};
