import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { renameObject } from '../../model/project';
import { TYPE_LABEL } from '../../model/semantics';
import { PERIMETER, addElement, categoryCounts, elementsIn, linesOf, removeFromScene, sceneLines, type Category } from '../../model/scene';
import type { Project, StoryObject } from '../../model/types';
import { useDragPan, useWheelPanZoom } from '../../use-pan-zoom';
import { clampZoom, zoomAt, type View } from '../../view';
import type { PaletteDrag } from '../canvas/StoryCanvas';
import { Symbol } from '../Symbol';
import { facetsOf, type Facet } from '../../model/facets';
import { NameEdit, dropCategory, sceneRefusal, symbolColor } from './parts';
import type { SceneSurface } from './SceneWorkspace';
import { ElementDetail } from '../detail/ElementDetail';
import type { Destination } from '../../model/details';
import { findIssues } from '../../model/validate';
import { Inline } from '../Inline';

interface Props {
  project: Project;
  sceneId: string;
  onCommit: (project: Project) => void;
  selection: string | null;
  onSelect: (id: string | null) => void;
  paletteDrag: PaletteDrag | null;
  onSay: (message: string) => void;
  /** Back to the writing box (the script). */
  onOpen: () => void;
  /** Open the scene's timeline (double-click the scene, or its Timeline button). */
  onTimeline?: () => void;
  /** Shown as the timeline's linked panel: a header with zoom, Fit and Full view. */
  panel?: { onFullView: () => void };
  /** Elements lit because the selected timeline event stands for them. */
  highlight?: ReadonlySet<string>;
  /** Go to the Bible entry for an element, or to where it's used. */
  onOpenBible?: (id: string) => void;
  onOpenCode?: (id: string) => void;
  onNavigate?: (to: Destination) => void;
  /** Take an element out of the scene (the app warns when that deletes it). */
  onRemove?: (id: string) => void;
}

// World units (HANDOFF iteration 2: scene 560×400, element boxes 130×110).
const SCENE_W = 560;
const SCENE_H = 400;
const BOX_W = 130;
const BOX_H = 110;
const REACH = 70;

interface Point {
  x: number;
  y: number;
}

const portAt = (c: Category): Point => {
  switch (c.side) {
    case 'left':
      return { x: 0, y: SCENE_H * c.at };
    case 'right':
      return { x: SCENE_W, y: SCENE_H * c.at };
    case 'top':
      return { x: SCENE_W * c.at, y: 0 };
    case 'bottom':
      return { x: SCENE_W * c.at, y: SCENE_H };
  }
};

/** Boxes fan out from their category's port, away from the scene. */
const boxAt = (c: Category, index: number, count: number): Point => {
  const port = portAt(c);
  switch (c.side) {
    case 'left':
      return { x: -REACH - BOX_W - index * (BOX_W + 20), y: port.y - BOX_H / 2 };
    case 'right':
      return { x: SCENE_W + REACH + index * (BOX_W + 20), y: port.y - BOX_H / 2 };
    case 'top':
      return { x: port.x - BOX_W / 2, y: -REACH - BOX_H - index * (BOX_H + 20) };
    case 'bottom':
      return { x: port.x - BOX_W / 2 + (index - (count - 1) / 2) * (BOX_W + 20), y: SCENE_H + REACH };
  }
};

/** Where a box's wire leaves it: the edge facing the scene. */
const dotAt = (c: Category, box: Point): Point => {
  switch (c.side) {
    case 'left':
      return { x: box.x + BOX_W, y: box.y + BOX_H / 2 };
    case 'right':
      return { x: box.x, y: box.y + BOX_H / 2 };
    case 'top':
      return { x: box.x + BOX_W / 2, y: box.y + BOX_H };
    case 'bottom':
      return { x: box.x + BOX_W / 2, y: box.y };
  }
};

const wire = (c: Category, from: Point, to: Point): string => {
  const k = Math.max(24, Math.hypot(to.x - from.x, to.y - from.y) / 3);
  const horizontal = c.side === 'left' || c.side === 'right';
  const sign = c.side === 'left' || c.side === 'top' ? 1 : -1;
  const c1 = horizontal ? { x: from.x + sign * k, y: from.y } : { x: from.x, y: from.y + sign * k };
  const c2 = horizontal ? { x: to.x - sign * k, y: to.y } : { x: to.x, y: to.y - sign * k };
  return `M${from.x} ${from.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
};

/** Kickers short enough for a 130-wide box. */
const SHORT_LABEL: Partial<Record<StoryObject['type'], string>> = {
  character: 'Character',
  object: 'Object',
  environment: 'Environment',
  inventory: 'Inventory',
  puzzle: 'Puzzle',
};

interface Placed {
  id: string;
  category: Category;
  at: Point;
  object?: StoryObject;
  /** The element opened a level further (spec §11): its facets, placed beyond it. */
  facets?: { facet: Facet; at: Point }[];
}

// A facet of an opened element: a line of words beyond its box.
const LEAF_W = 190;
const LEAF_H = 36;
const LEAF_GAP = 6;
const LEAF_REACH = 40;
const stack = (n: number) => n * LEAF_H + Math.max(0, n - 1) * LEAF_GAP;

/** Which elements are opened a level further, per scene, for as long as the studio is open (spec §24). */
const opened = new Map<string, Set<string>>();
const openIn = (sceneId: string) => opened.get(sceneId) ?? new Set<string>();

// A character's dialogue: a box under it, a row per line (the first two).
const DLG_ROWS = 2;
const DLG_ROW = 18;
const DLG_GAP = 14;
const dialogueHeight = (n: number) => 22 + Math.min(n, DLG_ROWS) * DLG_ROW + (n > DLG_ROWS ? DLG_ROW : 0) + 6;

/**
 * Everything the scene holds, placed around its ports; a character's
 * dialogue hangs under it. An opened element's facets sit beyond it, and the
 * boxes further out on that side move out to make room.
 */
const layout = (project: Project, sceneId: string, open: ReadonlySet<string> = new Set()): Placed[] => {
  const placed: Placed[] = [];
  for (const c of PERIMETER) {
    const items = elementsIn(project, sceneId, c.key);
    const facets = items.map((o) => (open.has(o.id) ? facetsOf(project, sceneId, o) : null));
    if (c.side === 'bottom') {
      // A row under the scene: an opened box takes a wider slot, its facets hang below it.
      const widths = facets.map((f) => (f ? LEAF_W : BOX_W));
      const total = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * 20;
      let x = portAt(c).x - total / 2;
      items.forEach((object, i) => {
        const at = { x: x + (widths[i]! - BOX_W) / 2, y: SCENE_H + REACH };
        const list = facets[i];
        placed.push({
          id: object.id,
          category: c,
          at,
          object,
          ...(list ? { facets: list.map((facet, j) => ({ facet, at: { x: at.x + BOX_W / 2 - LEAF_W / 2, y: at.y + BOX_H + LEAF_REACH + j * (LEAF_H + LEAF_GAP) } })) } : {}),
        });
        x += widths[i]! + 20;
      });
      continue;
    }
    let extra = 0;
    items.forEach((object, i) => {
      const base = boxAt(c, i, items.length);
      const at =
        c.side === 'left' ? { x: base.x - extra, y: base.y } : c.side === 'right' ? { x: base.x + extra, y: base.y } : { x: base.x, y: base.y - extra };
      const list = facets[i];
      let leaves: Placed['facets'];
      if (list) {
        const h = stack(list.length);
        if (c.side === 'top') {
          leaves = list.map((facet, j) => ({ facet, at: { x: at.x + BOX_W / 2 - LEAF_W / 2, y: at.y - LEAF_REACH - h + j * (LEAF_H + LEAF_GAP) } }));
          extra += LEAF_REACH + h + 20;
        } else {
          const x = c.side === 'left' ? at.x - LEAF_REACH - LEAF_W : at.x + BOX_W + LEAF_REACH;
          leaves = list.map((facet, j) => ({ facet, at: { x, y: at.y + BOX_H / 2 - h / 2 + j * (LEAF_H + LEAF_GAP) } }));
          extra += LEAF_REACH + LEAF_W + 20;
        }
      }
      placed.push({ id: object.id, category: c, at, object, ...(leaves ? { facets: leaves } : {}) });
    });
  }
  return placed;
};

/** A thin wire from a box's outer edge to one of its facets. */
const facetWire = (c: Category, box: Point, leaf: Point): string => {
  const from =
    c.side === 'left' ? { x: box.x, y: box.y + BOX_H / 2 } : c.side === 'right' ? { x: box.x + BOX_W, y: box.y + BOX_H / 2 } : c.side === 'top' ? { x: box.x + BOX_W / 2, y: box.y } : { x: box.x + BOX_W / 2, y: box.y + BOX_H };
  const to =
    c.side === 'left' ? { x: leaf.x + LEAF_W, y: leaf.y + LEAF_H / 2 } : c.side === 'right' ? { x: leaf.x, y: leaf.y + LEAF_H / 2 } : c.side === 'top' ? { x: leaf.x + LEAF_W / 2, y: leaf.y + LEAF_H } : { x: leaf.x + LEAF_W / 2, y: leaf.y };
  const horizontal = c.side === 'left' || c.side === 'right';
  const mid = horizontal ? { x: (from.x + to.x) / 2, y: 0 } : { x: 0, y: (from.y + to.y) / 2 };
  return horizontal ? `M${from.x} ${from.y} C${mid.x} ${from.y} ${mid.x} ${to.y} ${to.x} ${to.y}` : `M${from.x} ${from.y} C${from.x} ${mid.y} ${to.x} ${mid.y} ${to.x} ${to.y}`;
};

/**
 * The exploded scene (spec §11, HANDOFF iteration 2): the scene as a root
 * node with one coloured port per category, every element it holds wired to
 * its port. A palette element dropped anywhere snaps to its category's port,
 * which glows while the drag is on.
 */
export const ExplodedScene = forwardRef<SceneSurface, Props>(function ExplodedScene(props, ref) {
  const { project, sceneId } = props;
  const scene = project.objects[sceneId]!;
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const setView = useCallback((update: (v: View) => View) => setViewState(update), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [open, setOpenState] = useState<Set<string>>(() => openIn(sceneId));
  const setOpen = (next: Set<string>) => {
    opened.set(sceneId, next);
    setOpenState(next);
  };
  const toggleOpen = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  useWheelPanZoom(rootRef, setView);
  const onPanDown = useDragPan(view, setView, () => props.onSelect(null));

  const over = (drag: PaletteDrag | null): boolean => {
    const rect = rootRef.current?.getBoundingClientRect();
    return !!drag && !!rect && drag.clientX >= rect.left && drag.clientX <= rect.right && drag.clientY >= rect.top && drag.clientY <= rect.bottom;
  };

  const dragging = props.paletteDrag && over(props.paletteDrag) ? props.paletteDrag : null;
  const refusal = dragging ? sceneRefusal(dragging.type) : null;
  const target = dragging && !refusal ? dropCategory(dragging.type) : undefined;
  const preview = useMemo(
    () => (dragging && target ? addElement(project, sceneId, dragging.type) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, sceneId, dragging?.type, !!target],
  );
  const shown = preview?.project ?? project;
  const ghostId = preview && dragging?.type !== 'dialogue' ? preview.id : null;
  const placed = layout(shown, sceneId, open);
  const openable = placed.filter((p) => p.object).map((p) => p.id);
  const counts = categoryCounts(shown, sceneId);

  const fit = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const all = layout(project, sceneId, openIn(sceneId));
    let minX = -REACH - BOX_W;
    let maxX = SCENE_W + REACH + BOX_W;
    let minY = -REACH - BOX_H;
    let maxY = SCENE_H + REACH + BOX_H;
    for (const p of all) {
      const said = p.object?.type === 'character' ? linesOf(project, sceneId, p.object.id).length : 0;
      minX = Math.min(minX, p.at.x);
      maxX = Math.max(maxX, p.at.x + BOX_W);
      minY = Math.min(minY, p.at.y);
      maxY = Math.max(maxY, p.at.y + BOX_H + (said ? DLG_GAP + dialogueHeight(said) : 0));
      for (const f of p.facets ?? []) {
        minX = Math.min(minX, f.at.x);
        maxX = Math.max(maxX, f.at.x + LEAF_W);
        minY = Math.min(minY, f.at.y);
        maxY = Math.max(maxY, f.at.y + LEAF_H);
      }
    }
    const margin = props.panel ? 24 : 40;
    // The panel's header covers its top edge.
    const top = props.panel ? 44 : 0;
    const height = root.clientHeight - top;
    const zoom = clampZoom(Math.min(1, (root.clientWidth - margin * 2) / (maxX - minX), (height - margin * 2) / (maxY - minY)));
    setViewState({
      zoom,
      panX: (root.clientWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
      panY: top + (height - (maxY - minY) * zoom) / 2 - minY * zoom,
    });
  }, [project, sceneId, props.panel]);

  // Open fitted to the scene and everything around it. The small linked panel
  // refits as elements arrive, so nothing new lands out of sight.
  const elementCount = layout(project, sceneId).length;
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, props.panel ? elementCount : 0]);

  useImperativeHandle(ref, () => ({
    drop: (drag) => {
      if (!over(drag)) return false;
      const why = sceneRefusal(drag.type);
      if (why) {
        props.onSay(why);
        return false;
      }
      const result = addElement(project, sceneId, drag.type);
      if (!result) return false;
      props.onCommit(result.project);
      if (drag.type !== 'dialogue') {
        props.onSelect(result.id);
        setEditing(result.id);
      }
      return true;
    },
    rename: (id) => setEditing(id),
    fit,
  }));

  const issues = useMemo(() => new Map(findIssues(project).map((i) => [i.id, i.message])), [project]);

  const zoomCentre = (factor: number) => {
    const root = rootRef.current;
    if (root) setViewState((v) => zoomAt(v, factor, root.clientWidth / 2, root.clientHeight / 2));
  };

  const location = scene.data.locationId ? project.objects[scene.data.locationId as string] : undefined;
  const slug = [scene.data.intExt ?? 'INT.', location?.name.toUpperCase() ?? 'SOMEWHERE', '—', scene.data.time ?? 'DAY'].join(' ');
  const firstAction = sceneLines(project, sceneId).find((l) => l.kind === 'action' && l.text)?.text;
  const lines = sceneLines(shown, sceneId).filter((l) => l.kind === 'dialogue');
  const rect = rootRef.current?.getBoundingClientRect();

  return (
    <div
      ref={rootRef}
      className={`exploded${props.paletteDrag ? ' dropping' : ''}${props.panel ? ' as-panel' : ''}`}
      style={{
        backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px`,
        backgroundPosition: `${view.panX}px ${view.panY}px`,
      }}
      onPointerDown={onPanDown}
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
    >
      <div className="world" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        <svg className="connectors" style={{ left: -4000, top: -4000 }} width={8000} height={8000} aria-hidden="true">
          <g transform="translate(4000 4000)">
            {placed.map((p) => (
              <path
                key={p.id}
                className={`wire${p.id === ghostId ? ' ghost' : ''}`}
                style={{ stroke: p.category.color }}
                d={wire(p.category, dotAt(p.category, p.at), portAt(p.category))}
              />
            ))}
            {placed.map((p) =>
              p.object?.type === 'character' && lines.some((l) => l.speakerId === p.object!.id) ? (
                <path key={`${p.id}:dialogue`} className="wire" style={{ stroke: 'var(--c-dialogue)' }} d={`M${p.at.x + BOX_W / 2} ${p.at.y + BOX_H} V${p.at.y + BOX_H + DLG_GAP}`} />
              ) : null,
            )}
            {placed.flatMap((p) =>
              (p.facets ?? []).map((f, j) => <path key={`${p.id}:${j}`} className="wire facet-wire" style={{ stroke: p.category.color }} d={facetWire(p.category, p.at, f.at)} />),
            )}
          </g>
        </svg>

        <section
          className="exploded-scene"
          aria-label={`Scene ${scene.data.code ?? ''}`}
          style={{ width: SCENE_W, height: SCENE_H }}
          onDoubleClick={(e) => {
            if (!props.onTimeline) return;
            e.stopPropagation();
            props.onTimeline();
          }}
          title={props.onTimeline ? 'Double-click for the timeline' : undefined}
        >
          <div className="exploded-scene-body">
            <div className="scene-title">
              <Symbol type="scene" size={14} />
              <span className="mono scene-code">{scene.data.code}</span>
              <span className="scene-name">{scene.name}</span>
            </div>
            <div className="mono slug">{slug}</div>
            <p className="excerpt">{firstAction ?? (scene.data.summary as string | undefined) ?? 'Nothing written yet. Edit the script to say what happens.'}</p>
            <div className="exploded-chips">
              {typeof scene.data.purpose === 'string' && <span className="chip-soft">Purpose: {scene.data.purpose}</span>}
              <span className={`status-chip status-${(scene.data.status as string) ?? 'outline'}`}>
                {scene.data.status === 'complete' ? 'Complete' : scene.data.status === 'inProgress' ? 'In progress' : 'Outline'}
              </span>
            </div>
          </div>
          <div className="exploded-scene-foot">
            {props.onTimeline && (
              <button className="gold-btn" onPointerDown={(e) => e.stopPropagation()} onClick={props.onTimeline}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M2 4h12M2 8h8M2 12h10" />
                </svg>
                Timeline
              </button>
            )}
            <button className="tb-btn" onPointerDown={(e) => e.stopPropagation()} onClick={props.onOpen}>
              Edit script
            </button>
            <span className="hint">{props.onTimeline ? 'double-click = timeline' : 'Drop an element anywhere · it snaps to its port'}</span>
          </div>

          {PERIMETER.map((c) => {
            const p = portAt(c);
            const lit = target?.key === c.key;
            return (
              <span key={c.key}>
                <span
                  className={`port${lit ? ' lit' : ''}${counts[c.key] ? '' : ' idle'}`}
                  style={{ left: p.x - 9, top: p.y - 9, background: c.color, '--cat': c.color } as React.CSSProperties}
                  title={`${c.label}: ${counts[c.key]}`}
                />
                <span className={`port-label port-${c.side}`} style={{ left: p.x, top: p.y, color: c.color }}>
                  {c.port}
                </span>
              </span>
            );
          })}
        </section>

        {placed.map((p) => {
          const style = { left: p.at.x, top: p.at.y, width: BOX_W, height: BOX_H, '--cat': p.category.color } as React.CSSProperties;
          const dot = dotAt(p.category, p.at);
          const dotStyle = { left: dot.x - p.at.x - 6, top: dot.y - p.at.y - 6, background: p.category.color };
          if (!p.object) return null;
          const object = p.object;
          const spoken = object.type === 'character' ? lines.filter((l) => l.speakerId === object.id).length : 0;
          const isLocation = scene.data.locationId === object.id;
          return (
            <div
              key={p.id}
              data-element={object.id}
              className={`element-box${props.selection === object.id ? ' selected' : ''}${p.id === ghostId ? ' ghost' : ''}${props.highlight?.has(object.id) ? ' lit' : ''}`}
              style={style}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                props.onSelect(object.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (props.panel) setEditing(object.id);
                else setDetail(object.id);
              }}
              title={props.panel ? 'Double-click to rename' : 'Double-click for detail · F2 renames'}
            >
              <span className="box-kicker">
                <Symbol type={object.type} size={11} color={symbolColor(object)} />
                {SHORT_LABEL[object.type] ?? TYPE_LABEL[object.type]}
              </span>
              {editing === object.id ? (
                <NameEdit
                  value={object.name}
                  className="box-input"
                  onDone={(value) => {
                    setEditing(null);
                    if (value !== null) props.onCommit(renameObject(project, object.id, value));
                  }}
                />
              ) : (
                <span className="box-name">{object.name}</span>
              )}
              <span className="box-sub">
                {object.data.code}
                {spoken > 0 && ` · ${spoken} line${spoken === 1 ? '' : 's'} here`}
                {isLocation && ' · where it’s set'}
              </span>
              {props.selection === object.id && (
                <button
                  className="box-remove"
                  aria-label={`Remove ${object.name} from the scene`}
                  title="Remove from this scene"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    if (props.onRemove) props.onRemove(object.id);
                    else props.onCommit(removeFromScene(project, sceneId, object.id));
                    props.onSelect(null);
                  }}
                >
                  ×
                </button>
              )}
              {issues.get(object.id) && (
                <span className="issue-badge" title={issues.get(object.id)} aria-label={issues.get(object.id)}>
                  !
                </span>
              )}
              <button
                className={`box-open${open.has(object.id) ? ' on' : ''}`}
                aria-expanded={open.has(object.id)}
                aria-label={`${open.has(object.id) ? 'Close' : 'Open'} ${object.name}`}
                title={open.has(object.id) ? 'Close it again' : 'Open it: what it holds, does and needs'}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onClick={() => toggleOpen(object.id)}
              >
                {open.has(object.id) ? '−' : '+'}
              </button>
              <span className="box-dot" style={dotStyle} />
            </div>
          );
        })}

        {placed.map((p) => {
          if (p.object?.type !== 'character') return null;
          const said = linesOf(shown, sceneId, p.object.id);
          if (!said.length) return null;
          return (
            <div
              key={`${p.id}:dialogue`}
              className="dlg-box"
              role="group"
              aria-label={`${p.object.name}’s dialogue`}
              style={{ left: p.at.x, top: p.at.y + BOX_H + DLG_GAP, width: BOX_W }}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={props.onOpen}
              title="Double-click to edit the script"
            >
              <span className="dlg-head">
                <Symbol type="dialogue" size={11} />
                Dialogue · {said.length}
              </span>
              {said.slice(0, DLG_ROWS).map((l) => (
                <span key={l.id} className="dlg-row">
                  <span className="mono">#{l.order}</span>
                  <span className="dlg-text">{l.text ? <Inline text={l.text} /> : '…'}</span>
                </span>
              ))}
              {said.length > DLG_ROWS && <span className="dlg-more">+ {said.length - DLG_ROWS} more</span>}
            </div>
          );
        })}

        {placed.flatMap((p) =>
          (p.facets ?? []).map((f, j) => (
            <div
              key={`${p.id}:${j}`}
              className="facet"
              style={{ left: f.at.x, top: f.at.y, width: LEAF_W, height: LEAF_H, '--cat': p.category.color } as React.CSSProperties}
              title={[f.facet.label, f.facet.detail].filter(Boolean).join(': ')}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                props.onSelect(p.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!props.panel) setDetail(p.id);
              }}
            >
              {f.facet.symbol && <Symbol type={f.facet.symbol} size={9} />}
              <span className="facet-label">{f.facet.label}</span>
              {f.facet.detail && <span className="facet-detail">{f.facet.detail}</span>}
            </div>
          )),
        )}
      </div>

      {detail && project.objects[detail] && !props.panel && (
        <ElementDetail
          project={project}
          id={detail}
          sceneId={sceneId}
          onCommit={props.onCommit}
          onClose={() => setDetail(null)}
          onOpenBible={props.onOpenBible}
          onOpenCode={props.onOpenCode}
          onNavigate={props.onNavigate}
          variant="panel"
        />
      )}

      {dragging && refusal && rect && (
        <div className="drop-refusal" style={{ left: dragging.clientX - rect.left + 12, top: dragging.clientY - rect.top + 50 }}>
          {refusal}
        </div>
      )}
      {props.panel ? (
        <div className="panel-head" onPointerDown={(e) => e.stopPropagation()}>
          <span className="panel-title">Scene · exploded</span>
          <span className="panel-hint">linked to the timeline · select any element to edit</span>
          <div className="grow" />
          <button className="icon-btn small" aria-label="Zoom out" onClick={() => zoomCentre(1 / 1.2)}>
            −
          </button>
          <span className="zoom-readout">{Math.round(view.zoom * 100)}%</span>
          <button className="icon-btn small" aria-label="Zoom in" onClick={() => zoomCentre(1.2)}>
            +
          </button>
          <button className="tb-btn small" onClick={fit}>
            Fit
          </button>
          <button className="tb-btn small" onClick={props.panel.onFullView}>
            Full view ⤢
          </button>
        </div>
      ) : (
        <div className="exploded-legend">
          <button className="tb-btn small" disabled={!openable.length} onClick={() => setOpen(open.size ? new Set() : new Set(openable))}>
            {open.size ? 'Close all' : 'Open all'}
          </button>
          <span>+ on a box opens it · double-click for its detail · F2 renames · Delete removes it from the scene · wheel to zoom, drag to pan</span>
        </div>
      )}
    </div>
  );
});
