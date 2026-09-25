import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  contentBounds,
  laneRows,
  laneSequence,
  nodeBox,
  nodeSize,
  spanRange,
  spineSequence,
  type LaneRow,
} from '../model/layout';
import {
  canPlace,
  isProtected,
  laneNodeCount,
  moveNode,
  placeNew,
  removeLane,
  renameObject,
  setSpanEdge,
  updateLane,
} from '../model/project';
import { SCENE_ONLY, TYPE_LABEL } from '../model/semantics';
import type { Lane, ObjectType, Project, StoryObject } from '../model/types';
import { HEADER_W, zoomAt, type View } from '../view';
import { EyeIcon, LockIcon, UnlockIcon } from './Symbol';

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
  /** Start renaming a node in place. */
  rename: (id: string) => void;
}

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  view: View;
  setView: (update: (view: View) => View) => void;
  selection: string | null;
  onSelect: (id: string | null) => void;
  paletteDrag: PaletteDrag | null;
  bottomInset: number;
  /** Ask before a change that removes more than the user pointed at. */
  onConfirm: (request: ConfirmRequest) => void;
}

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
}

type Target = { ok: true; laneId: string; x: number } | { ok: false; reason: string };

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number; moved: boolean }
  | { kind: 'node'; id: string; startX: number; x0: number; moved: boolean }
  | { kind: 'span'; laneId: string; edge: 'start' | 'end' };

const REFUSAL: Record<Lane['kind'], string> = {
  spine: 'The spine takes plot points, scenes, cinematics and choices',
  subplot: 'Subplots take plot points, choices and scenes',
  character: 'Character lanes hold arc events',
};

export const StoryCanvas = forwardRef<CanvasApi, Props>(function StoryCanvas(props, ref) {
  const { project, view, paletteDrag } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1176, h: 848 });
  const [preview, setPreview] = useState<Project | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editingLane, setEditingLane] = useState<{ laneId: string; field: 'name' | 'subtitle' } | null>(null);
  const [laneMenu, setLaneMenu] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setSize({ w: root.clientWidth, h: root.clientHeight }));
    observer.observe(root);
    setSize({ w: root.clientWidth, h: root.clientHeight });
    return () => observer.disconnect();
  }, []);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const sx = clientX - (rect?.left ?? 0);
    const sy = clientY - (rect?.top ?? 0);
    return { sx, sy, x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
  };

  const targetAt = (drag: PaletteDrag): Target | null => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const inside =
      drag.clientX >= rect.left &&
      drag.clientX <= rect.right &&
      drag.clientY >= rect.top &&
      drag.clientY <= rect.bottom - props.bottomInset;
    if (!inside) return null;
    const { x, y } = toWorld(drag.clientX, drag.clientY);
    const row = laneRows(project).find((r) => y >= r.top && y <= r.top + r.height);
    if (SCENE_ONLY.includes(drag.type)) return { ok: false, reason: `${TYPE_LABEL[drag.type]} goes inside a scene` };
    if (!row) return { ok: false, reason: 'Drop on the spine or a lane' };
    if (row.lane.locked && row.lane.kind !== 'spine') return { ok: false, reason: 'This lane is locked' };
    if (!canPlace(project, drag.type, row.lane.id)) return { ok: false, reason: REFUSAL[row.lane.kind] };
    return { ok: true, laneId: row.lane.id, x: x - nodeSize(drag.type, row.lane.kind).w / 2 };
  };

  const target = paletteDrag && (paletteDrag.moved || paletteDrag.placing) ? targetAt(paletteDrag) : null;
  const dropPreview = useMemo(
    () => (paletteDrag && target?.ok ? placeNew(project, paletteDrag.type, target.laneId, target.x) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, paletteDrag?.type, target?.ok, target?.ok && target.laneId, target?.ok && Math.round(target.x)],
  );

  useImperativeHandle(ref, () => ({
    drop: (drag) => {
      const t = targetAt(drag);
      if (!t?.ok) return false;
      const placed = placeNew(project, drag.type, t.laneId, t.x);
      if (!placed) return false;
      props.onCommit(placed.project);
      props.onSelect(placed.id);
      return true;
    },
    size: () => ({ w: size.w, h: size.h - props.bottomInset }),
    rename: (id) => setEditing(id),
  }));

  // Wheel pans; Ctrl/⌘ + wheel (and trackpad pinch) zooms around the pointer.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = root.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0015);
        props.setView((v) => zoomAt(v, factor, e.clientX - rect.left, e.clientY - rect.top));
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        props.setView((v) => ({ ...v, panX: v.panX - dx, panY: v.panY - dy }));
      }
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [props.setView]);

  const shown = preview ?? dropPreview?.project ?? project;
  const ghostId = !preview && dropPreview ? dropPreview.id : null;
  const rows = laneRows(shown);

  // ------------------------------------------------------------ gestures

  // Gestures listen on the window, so a drag keeps going outside the canvas
  // and a node still gets its double-click. The handlers read the latest
  // render through a ref.
  const latest = useRef({ project, view, preview });
  latest.current = { project, view, preview };

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
      if (Math.abs(dx * v.zoom) > 3) g.moved = true;
      if (g.moved) setPreview(moveNode(current, g.id, g.x0 + dx));
    } else {
      const rect = rootRef.current?.getBoundingClientRect();
      const x = (e.clientX - (rect?.left ?? 0) - v.panX) / v.zoom;
      const ref = nearestSpineNode(x);
      if (ref) setPreview(setSpanEdge(current, g.laneId, g.edge, ref));
    }
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const { project: current, preview: pending } = latest.current;
    if (g.kind === 'pan' && !g.moved) props.onSelect(null);
    if ((g.kind === 'node' && g.moved) || g.kind === 'span') {
      if (pending && pending !== current) props.onCommit(pending);
    }
    setPreview(null);
  };

  const begin = (g: Gesture) => {
    gesture.current = g;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    // While a palette node is being placed, the click is the drop.
    if (paletteDrag || (e.button !== 0 && e.button !== 1)) return;
    setLaneMenu(null);
    begin({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY, moved: false });
  };

  const onNodeDown = (e: React.PointerEvent, id: string) => {
    if (paletteDrag || e.button !== 0) return;
    e.stopPropagation();
    setLaneMenu(null);
    props.onSelect(id);
    const placement = project.placements[id];
    const lane = project.lanes.find((l) => l.id === placement?.laneId);
    if (!placement || isProtected(project, id) || !lane || (lane.locked && lane.kind !== 'spine')) return;
    begin({ kind: 'node', id, startX: e.clientX, x0: placement.x, moved: false });
  };

  const onHandleDown = (e: React.PointerEvent, laneId: string, edge: 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    begin({ kind: 'span', laneId, edge });
  };

  // ------------------------------------------------------------ lanes

  const commitLane = (laneId: string, patch: Parameters<typeof updateLane>[2]) =>
    props.onCommit(updateLane(project, laneId, patch));

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

  const screenY = (worldY: number) => worldY * view.zoom + view.panY;

  const lastRow = rows[rows.length - 1];
  const tracksBottom = lastRow ? screenY(lastRow.top + lastRow.height) : 0;

  return (
    <div
      ref={rootRef}
      className={`canvas${paletteDrag ? ' dropping' : ''}`}
      aria-label="Story canvas"
      style={{
        backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
        backgroundPosition: `${view.panX}px ${view.panY}px`,
      }}
      onPointerDown={onBackgroundDown}
    >
      {/* Track bands: full width at every pan, so the spine never ends. */}
      {rows.map((row) => (
        <TrackBand key={row.lane.id} row={row} top={screenY(row.top)} height={row.height * view.zoom} empty={laneSequence(shown, row.lane.id).length === 0} />
      ))}

      <div className="world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        {rows.map((row) => (row.lane.kind === 'subplot' ? <SubplotSpan key={row.lane.id} project={shown} row={row} onHandleDown={onHandleDown} /> : null))}
        <Connectors project={shown} rows={rows} />
        {Object.keys(shown.placements).map((id) => {
          const object = shown.objects[id];
          const box = nodeBox(shown, id, rows);
          if (!object || !box) return null;
          const lane = rows.find((r) => r.lane.id === shown.placements[id]?.laneId)?.lane;
          const range = lane?.kind === 'subplot' ? spanRange(shown, lane) : null;
          const outside = range !== null && (box.x + box.w / 2 < range.from || box.x + box.w / 2 > range.to);
          return (
            <NodeView
              key={id}
              object={object}
              laneKind={lane?.kind ?? 'spine'}
              box={box}
              selected={props.selection === id}
              ghost={id === ghostId}
              outside={outside}
              editing={editing === id}
              onPointerDown={(e) => onNodeDown(e, id)}
              onDoubleClick={() => setEditing(id)}
              onRename={(name) => {
                setEditing(null);
                props.onCommit(renameObject(project, id, name));
              }}
              onCancelRename={() => setEditing(null)}
            />
          );
        })}
      </div>

      {/* Sticky track headers on the left. */}
      {rows.map((row) => (
        <TrackHeader
          key={row.lane.id}
          lane={row.lane}
          top={screenY(row.top)}
          height={row.height * view.zoom}
          editing={editingLane?.laneId === row.lane.id ? editingLane.field : null}
          menuOpen={laneMenu === row.lane.id}
          onEdit={(field) => setEditingLane({ laneId: row.lane.id, field })}
          onEditDone={(field, value) => {
            setEditingLane(null);
            if (value !== null) commitLane(row.lane.id, { [field]: value });
          }}
          onToggleVisible={() => commitLane(row.lane.id, { visible: !row.lane.visible })}
          onToggleLock={() => commitLane(row.lane.id, { locked: !row.lane.locked })}
          onMenu={() => setLaneMenu(laneMenu === row.lane.id ? null : row.lane.id)}
          onDelete={() => deleteLane(row.lane)}
        />
      ))}

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

      <Minimap project={shown} view={view} width={size.w} height={size.h - props.bottomInset} onJump={(x, y) =>
        props.setView((v) => ({ ...v, panX: (size.w + HEADER_W) / 2 - x * v.zoom, panY: (size.h - props.bottomInset) / 2 - y * v.zoom }))
      } />
    </div>
  );
});

// ---------------------------------------------------------------- tracks

const TrackBand = ({ row, top, height, empty }: { row: LaneRow; top: number; height: number; empty: boolean }) => {
  const { lane } = row;
  return (
    <div
      className={`track track-${lane.kind}${empty && lane.kind === 'subplot' ? ' track-new' : ''}`}
      style={{ top, height, '--lane': lane.color } as React.CSSProperties}
    >
      {empty && lane.kind === 'subplot' && height > 40 && (
        <span className="track-hint">New subplot lane — drag nodes in, then drag its ends to set where it starts and stops</span>
      )}
      {empty && lane.kind === 'character' && height > 40 && (
        <span className="track-hint" style={{ color: lane.color }}>
          {lane.name}'s arc runs the whole story
        </span>
      )}
    </div>
  );
};

interface HeaderProps {
  lane: Lane;
  top: number;
  height: number;
  editing: 'name' | 'subtitle' | null;
  menuOpen: boolean;
  onEdit: (field: 'name' | 'subtitle') => void;
  onEditDone: (field: 'name' | 'subtitle', value: string | null) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onMenu: () => void;
  onDelete: () => void;
}

const HeaderField = ({ value, field, placeholder, editing, onEdit, onEditDone, className }: {
  value: string;
  field: 'name' | 'subtitle';
  placeholder: string;
  editing: boolean;
  onEdit: HeaderProps['onEdit'];
  onEditDone: HeaderProps['onEditDone'];
  className: string;
}) =>
  editing ? (
    <input
      className="header-input"
      aria-label={field === 'name' ? 'Lane name' : 'Lane description'}
      defaultValue={value}
      placeholder={placeholder}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onEditDone(field, e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onEditDone(field, null);
      }}
    />
  ) : (
    <span className={`${className}${value ? '' : ' placeholder'}`} title="Double-click to edit" onDoubleClick={() => onEdit(field)}>
      {value || placeholder}
    </span>
  );

const TrackHeader = (props: HeaderProps) => {
  const { lane } = props;
  const roomy = props.height >= 56;
  return (
    <div
      className={`track-header header-${lane.kind}`}
      style={{ top: props.top + (lane.kind === 'spine' ? 2 : 1), height: Math.max(0, props.height - (lane.kind === 'spine' ? 4 : 2)), '--lane': lane.color } as React.CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {lane.kind === 'spine' ? (
        <>
          <b>SPINE</b>
          {roomy && <span className="header-sub">Main plot · locked lane</span>}
          {roomy && (
            <span className="header-icons" title="The spine is locked in place">
              <LockIcon />
            </span>
          )}
        </>
      ) : (
        <>
          {lane.kind === 'subplot' ? (
            <>
              <b>SUBPLOT</b>
              <HeaderField value={lane.name} field="name" placeholder="Name this lane…" editing={props.editing === 'name'} onEdit={props.onEdit} onEditDone={props.onEditDone} className="header-sub header-name" />
            </>
          ) : (
            <>
              <b className="header-arc">
                ARC ·{' '}
                <HeaderField value={lane.name} field="name" placeholder="Character" editing={props.editing === 'name'} onEdit={props.onEdit} onEditDone={props.onEditDone} className="header-arc-name" />
              </b>
              {roomy && (
                <HeaderField value={lane.subtitle} field="subtitle" placeholder="from → to" editing={props.editing === 'subtitle'} onEdit={props.onEdit} onEditDone={props.onEditDone} className="header-sub" />
              )}
            </>
          )}
          {roomy && (
            <span className="header-icons">
              <button aria-label={`Hide ${lane.name}`} title="Hide lane" onClick={props.onToggleVisible}>
                <EyeIcon />
              </button>
              <button
                aria-label={lane.locked ? `Unlock ${lane.name}` : `Lock ${lane.name}`}
                aria-pressed={lane.locked}
                title={lane.locked ? 'Unlock lane' : 'Lock lane'}
                className={lane.locked ? 'on' : ''}
                onClick={props.onToggleLock}
              >
                {lane.locked ? <LockIcon /> : <UnlockIcon />}
              </button>
              <button aria-label={`More for ${lane.name}`} aria-expanded={props.menuOpen} onClick={props.onMenu}>
                ⋯
              </button>
            </span>
          )}
          {props.menuOpen && (
            <div className="lane-menu" role="menu">
              <button role="menuitem" onClick={() => props.onEdit('name')}>
                Rename
              </button>
              <button role="menuitem" onClick={props.onToggleVisible}>
                Hide
              </button>
              <button role="menuitem" className="danger" onClick={props.onDelete}>
                Delete lane
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const SubplotSpan = ({ project, row, onHandleDown }: {
  project: Project;
  row: LaneRow;
  onHandleDown: (e: React.PointerEvent, laneId: string, edge: 'start' | 'end') => void;
}) => {
  const range = spanRange(project, row.lane);
  if (!range) return null;
  const handle = (edge: 'start' | 'end', x: number) => (
    <div
      className={`span-handle${row.lane.locked ? ' locked' : ''}`}
      role="slider"
      aria-label={`${row.lane.name}: where it ${edge === 'start' ? 'starts' : 'stops'}`}
      aria-valuenow={Math.round(x)}
      title={row.lane.locked ? 'Lane is locked' : `Drag to set where the subplot ${edge === 'start' ? 'starts' : 'stops'}`}
      style={{ left: x - 4, top: row.top + 10, height: row.height - 20 }}
      onPointerDown={(e) => (row.lane.locked ? e.stopPropagation() : onHandleDown(e, row.lane.id, edge))}
    />
  );
  return (
    <>
      <div className="span-region" style={{ left: range.from, width: range.to - range.from, top: row.top + 1, height: row.height - 2 }} />
      {handle('start', range.from)}
      {handle('end', range.to)}
    </>
  );
};

// ---------------------------------------------------------------- connectors

const Connectors = ({ project, rows }: { project: Project; rows: LaneRow[] }) => {
  const paths: React.ReactNode[] = [];
  for (const row of rows) {
    const ids = laneSequence(project, row.lane.id);
    const boxes = ids.map((id) => nodeBox(project, id, rows)).filter((b): b is NonNullable<typeof b> => b !== null);
    const y = row.top + row.height / 2;
    const d = boxes
      .slice(1)
      .map((box, i) => `M${boxes[i]!.x + boxes[i]!.w} ${y} H${box.x}`)
      .join(' ');
    if (d) paths.push(<path key={`flow-${row.lane.id}`} className={`flow flow-${row.lane.kind}`} d={d} />);

    // A subplot is tied to the spine where its span starts and stops.
    if (row.lane.kind === 'subplot') {
      const range = spanRange(project, row.lane);
      const spine = rows[0];
      if (range && spine && row.lane.span) {
        const tie = (ref: string, x: number) => {
          const box = nodeBox(project, ref, rows);
          const from = box ? box.y + box.h : spine.top + spine.height;
          return `M${x} ${from} V${row.top + 10}`;
        };
        paths.push(
          <path key={`tie-${row.lane.id}`} className="tie" style={{ stroke: row.lane.color }} d={`${tie(row.lane.span.startRef, range.from)} ${tie(row.lane.span.endRef, range.to)}`} />,
        );
      }
    }
  }
  return (
    <svg className="connectors" width="1" height="1" aria-hidden="true">
      {paths}
    </svg>
  );
};

// ---------------------------------------------------------------- nodes

const KICKER: Partial<Record<ObjectType, string>> = {
  plotPoint: 'Plot point',
  scene: 'Scene',
  cinematic: 'Cinematic',
};

interface NodeProps {
  object: StoryObject;
  laneKind: Lane['kind'];
  box: { x: number; y: number; w: number; h: number };
  selected: boolean;
  ghost: boolean;
  outside?: boolean;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}

const NameField = ({ object, editing, onRename, onCancelRename, className }: Pick<NodeProps, 'object' | 'editing' | 'onRename' | 'onCancelRename'> & { className: string }) =>
  editing ? (
    <input
      className={`node-input ${className}`}
      aria-label="Name"
      defaultValue={object.name}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => onRename(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') onCancelRename();
      }}
    />
  ) : (
    <span className={className}>{object.name}</span>
  );

const NodeView = (props: NodeProps) => {
  const { object, box, laneKind } = props;
  const state = `${props.selected ? ' selected' : ''}${props.ghost ? ' ghost' : ''}${props.outside ? ' outside-span' : ''}`;
  const style = { left: box.x, top: box.y, width: box.w, height: box.h };
  const common = {
    'data-node': object.id,
    'data-type': object.type,
    onPointerDown: props.onPointerDown,
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      props.onDoubleClick();
    },
  };

  if (object.type === 'begin' || object.type === 'end') {
    const defaultName = object.type === 'begin' ? 'Beginning' : 'Ending';
    return (
      <div className={`node pill${state}`} style={style} title={`${object.name} — protected`} {...common}>
        {object.type === 'begin' && <span className="start-tag">START</span>}
        {(object.name !== defaultName || props.editing) && (
          <NameField {...props} className="pill-name" />
        )}
        <LockIcon size={9} color="var(--ground)" />
        {object.type === 'begin' ? 'BEGIN' : 'END'}
      </div>
    );
  }

  if (object.type === 'choice') {
    return (
      <div className={`node choice${state}`} style={style} title={object.name} {...common}>
        {object.data.code}
        {props.editing && <NameField {...props} className="choice-name" />}
        {!props.editing && object.name !== 'Choice' && <span className="choice-name">{object.name}</span>}
      </div>
    );
  }

  const subplot = laneKind === 'subplot';
  const kicker = subplot ? `Subplot · ${object.data.code ?? ''}` : object.type === 'scene' ? `Scene · ${object.data.code ?? ''}` : KICKER[object.type] ?? '';
  const renamed = object.type === 'plotPoint' && object.name !== `Plot Point ${object.data.code?.replace(/\D/g, '')}`;
  const sub = object.data.summary ?? (object.type === 'plotPoint' && !subplot ? (renamed ? object.data.code : 'Name it…') : object.type === 'cinematic' ? object.data.code : '');
  return (
    <div
      className={`node card card-${object.type}${subplot ? ' card-subplot' : ''}${state}`}
      style={style}
      title={props.outside ? 'Outside the subplot’s span — drag it in, or move the span’s ends' : undefined}
      {...common}
    >
      <span className="card-kicker">
        <i />
        {kicker}
      </span>
      <NameField {...props} className="card-name" />
      {!subplot && sub ? <span className={`card-sub${sub === 'Name it…' ? ' placeholder' : ''}`}>{sub}</span> : null}
      <span className="port-ring" />
    </div>
  );
};

// ---------------------------------------------------------------- minimap

const MINI_W = 160;
const MINI_H = 100;

const Minimap = ({ project, view, width, height, onJump }: {
  project: Project;
  view: View;
  width: number;
  height: number;
  onJump: (x: number, y: number) => void;
}) => {
  const rows = laneRows(project);
  const content = contentBounds(project);
  const viewport = { x: (0 - view.panX) / view.zoom, y: (0 - view.panY) / view.zoom, w: width / view.zoom, h: height / view.zoom };
  const pad = 120;
  const minX = Math.min(content.x - pad, viewport.x);
  const maxX = Math.max(content.x + content.w + pad, viewport.x + viewport.w);
  const minY = Math.min(content.y - pad, viewport.y);
  const maxY = Math.max(content.y + content.h + pad, viewport.y + viewport.h);
  const k = Math.min(MINI_W / (maxX - minX), MINI_H / (maxY - minY));
  const mx = (x: number) => (x - minX) * k;
  const my = (y: number) => (y - minY) * k;
  return (
    <div
      className="minimap"
      aria-label="Minimap"
      onPointerDown={(e) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        onJump((e.clientX - rect.left) / k + minX, (e.clientY - rect.top) / k + minY);
      }}
    >
      {rows.map((row) => (
        <div key={row.lane.id} className={`mini-track mini-${row.lane.kind}`} style={{ top: my(row.top), height: Math.max(2, row.height * k), '--lane': row.lane.color } as React.CSSProperties} />
      ))}
      {Object.keys(project.placements).map((id) => {
        const box = nodeBox(project, id, rows);
        const object = project.objects[id];
        if (!box || !object) return null;
        return <div key={id} className={`mini-node mini-${object.type}`} style={{ left: mx(box.x), top: my(box.y), width: Math.max(2, box.w * k), height: Math.max(2, box.h * k) }} />;
      })}
      <div className="mini-viewport" style={{ left: mx(viewport.x), top: my(viewport.y), width: viewport.w * k, height: viewport.h * k }} />
    </div>
  );
};
