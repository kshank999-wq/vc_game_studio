import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { renameObject } from '../../model/project';
import {
  PERIMETER,
  addElement,
  categoryCounts,
  elementsIn,
  linesOf,
  sceneLines,
  setSceneData,
  setSceneNotes,
  type Category,
  type SceneData,
} from '../../model/scene';
import type { Project } from '../../model/types';
import type { PaletteDrag } from '../canvas/StoryCanvas';
import { Symbol } from '../Symbol';
import { AddMenu, NameEdit, dropCategory, sceneRefusal, symbolColor } from './parts';
import { ScriptEditor, ScriptFooter } from './ScriptEditor';
import { timelineSummary } from '../../model/timeline';
import { ElementDetail } from '../detail/ElementDetail';
import type { Destination } from '../../model/details';

/** The collapsed timeline under the writing box. */
const STRIP_H = 52;

export interface SceneSurface {
  /** Drop a palette element into the scene. False when it can't go there. */
  drop: (drag: PaletteDrag) => boolean;
  rename: (id: string) => void;
  /** Fit the view to the scene, where the view can pan and zoom. */
  fit?: () => void;
  /** Delete what is selected (the timeline's selected event). */
  remove?: () => void;
}

interface Props {
  project: Project;
  sceneId: string;
  onCommit: (project: Project) => void;
  selection: string | null;
  onSelect: (id: string | null) => void;
  paletteDrag: PaletteDrag | null;
  onSay: (message: string) => void;
  onTimeline: () => void;
  onOpenBible?: (id: string) => void;
  onOpenCode?: (id: string) => void;
  onNavigate?: (to: Destination) => void;
  /** Open with this script line in focus (a search result). */
  focusLine?: string | null;
}

// The scene box and the perimeter around it, in stage units (mockup 03).
const BOX_W = 620;
const BOX_H = 560;
const PILL_W = 150;
const PILL_H = 38;
const GAP = 40;
const CHIP_W = 160;
const CHIP_H = 34;
const CHIP_STEP = 42;

const pillPosition = (c: Category): { x: number; y: number } => {
  switch (c.side) {
    case 'left':
      return { x: -GAP - PILL_W, y: BOX_H * c.at - PILL_H / 2 };
    case 'right':
      return { x: BOX_W + GAP, y: BOX_H * c.at - PILL_H / 2 };
    case 'top':
      return { x: BOX_W * c.at - PILL_W / 2, y: -GAP - PILL_H };
    case 'bottom':
      return { x: BOX_W * c.at - PILL_W / 2, y: BOX_H + GAP };
  }
};

/** Where an expanded category's items go: outward from its perimeter node. */
const chipPosition = (c: Category, index: number, count: number): { x: number; y: number } => {
  const pill = pillPosition(c);
  const stack = (index - (count - 1) / 2) * CHIP_STEP;
  switch (c.side) {
    case 'left':
      return { x: pill.x - 36 - CHIP_W, y: pill.y + PILL_H / 2 - CHIP_H / 2 + stack };
    case 'right':
      return { x: pill.x + PILL_W + 36, y: pill.y + PILL_H / 2 - CHIP_H / 2 + stack };
    case 'top':
      return { x: pill.x + (PILL_W - CHIP_W) / 2, y: pill.y - 22 - CHIP_H - index * CHIP_STEP };
    case 'bottom':
      return { x: pill.x + (PILL_W - CHIP_W) / 2, y: pill.y + PILL_H + 22 + index * CHIP_STEP };
  }
};

// A character's dialogue box: beside the character, a row per line (the first few).
const DLG_W = 230;
const DLG_ROWS = 3;
const DLG_ROW = 18;
const dialogueHeight = (n: number) => (n ? 22 + Math.min(n, DLG_ROWS) * DLG_ROW + (n > DLG_ROWS ? DLG_ROW : 0) + 6 : 0);

/**
 * The cast down the left: each character, and its dialogue box beside it when
 * it has lines, one slot each, stacked around the Characters node.
 */
const castPositions = (c: Category, heights: readonly number[]): { chip: { x: number; y: number }; dialogue: { x: number; y: number } }[] => {
  const pill = pillPosition(c);
  const slots = heights.map((h) => Math.max(CHIP_H, h));
  const total = slots.reduce((a, b) => a + b, 0) + Math.max(0, slots.length - 1) * 10;
  let y = pill.y + PILL_H / 2 - total / 2;
  return slots.map((slot, i) => {
    const chip = { x: pill.x - 36 - CHIP_W, y: y + slot / 2 - CHIP_H / 2 };
    const dialogue = { x: chip.x - 28 - DLG_W, y: y + slot / 2 - heights[i]! / 2 };
    y += slot + 10;
    return { chip, dialogue };
  });
};

const STATUS: { key: NonNullable<SceneData['status']>; label: string }[] = [
  { key: 'outline', label: 'Outline' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'complete', label: 'Complete' },
];

const TABS = ['Script', 'Summary', 'Purpose', 'Notes'] as const;

/**
 * The Scene Workspace (spec §10): a large writing box in the middle, the
 * scene's categories as compact nodes around its edge. Clicking a category
 * opens just that one; Expand All in the top bar explodes the whole scene.
 */
export const SceneWorkspace = forwardRef<SceneSurface, Props>(function SceneWorkspace(props, ref) {
  const { project, sceneId } = props;
  const scene = project.objects[sceneId]!;
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Script');
  const [focusLine, setFocusLine] = useState<string | null>(props.focusLine ?? null);
  useEffect(() => {
    if (props.focusLine) {
      setTab('Script');
      setFocusLine(props.focusLine);
    }
  }, [props.focusLine]);
  const [editingName, setEditingName] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => setSize({ w: root.clientWidth, h: root.clientHeight }));
    observer.observe(root);
    setSize({ w: root.clientWidth, h: root.clientHeight });
    return () => observer.disconnect();
  }, []);

  const counts = categoryCounts(project, sceneId);
  const lines = sceneLines(project, sceneId);
  const dragCategory = props.paletteDrag ? dropCategory(props.paletteDrag.type) : undefined;

  const itemsOf = (c: Category): { id: string; label: string; code?: string; color?: string; symbol: Category['symbol'] }[] =>
    elementsIn(project, sceneId, c.key).map((o) => ({ id: o.id, label: o.name, code: o.data.code, color: symbolColor(o), symbol: o.type }));
  // Characters open by themselves once the scene has any, so the cast shows as it's written.
  const isOpen = (c: Category) => expanded[c.key] ?? (c.key === 'characters' && counts.characters > 0);
  /** Where each item of an open category goes (and the add button after them); the cast leaves room for dialogue. */
  const slotsOf = (c: Category, n: number) => {
    if (c.key !== 'characters') return Array.from({ length: n }, (_, i) => ({ chip: chipPosition(c, i, n), dialogue: null as { x: number; y: number } | null }));
    const cast = itemsOf(c);
    const heights = Array.from({ length: n }, (_, i) => (cast[i] ? dialogueHeight(linesOf(project, sceneId, cast[i]!.id).length) : 0));
    return castPositions(c, heights).map((p, i) => ({ chip: p.chip, dialogue: heights[i] ? p.dialogue : null }));
  };

  // Fit the stage (box, perimeter and whatever is open) into the view.
  let minX = -GAP - PILL_W;
  let maxX = BOX_W + GAP + PILL_W;
  let minY = -GAP - PILL_H;
  let maxY = BOX_H + GAP + PILL_H;
  for (const c of PERIMETER) {
    if (!isOpen(c)) continue;
    for (const { chip: p, dialogue } of slotsOf(c, itemsOf(c).length + 1)) {
      minX = Math.min(minX, p.x, dialogue?.x ?? Infinity);
      maxX = Math.max(maxX, p.x + CHIP_W);
      minY = Math.min(minY, p.y, dialogue?.y ?? Infinity);
      maxY = Math.max(maxY, p.y + CHIP_H, dialogue ? dialogue.y + 120 : -Infinity);
    }
  }
  const margin = 28;
  const usableH = size.h - STRIP_H;
  const k = Math.min(1, (size.w - margin * 2) / (maxX - minX), (usableH - margin * 2) / (maxY - minY));
  const ox = (size.w - (maxX - minX) * k) / 2 - minX * k;
  const oy = (usableH - (maxY - minY) * k) / 2 - minY * k;
  const summary = timelineSummary(project, sceneId);

  const openCategory = (key: string) => setExpanded((e) => ({ ...e, [key]: true }));

  const added = (next: Project, id: string, fresh: boolean, key: string) => {
    props.onCommit(next);
    openCategory(key);
    setAdding(null);
    props.onSelect(id);
    if (fresh) setEditing(id);
  };

  useImperativeHandle(ref, () => ({
    drop: (drag) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || drag.clientX < rect.left || drag.clientX > rect.right || drag.clientY < rect.top || drag.clientY > rect.bottom) return false;
      const refusal = sceneRefusal(drag.type);
      if (refusal) {
        props.onSay(refusal);
        return false;
      }
      const result = addElement(project, sceneId, drag.type);
      const category = dropCategory(drag.type);
      if (!result || !category) return false;
      if (drag.type === 'dialogue') {
        props.onCommit(result.project);
        setTab('Script');
        setFocusLine(result.id);
        openCategory('characters');
        return true;
      }
      added(result.project, result.id, true, category.key);
      return true;
    },
    rename: (id) => setEditing(id),
  }));

  const refusal = props.paletteDrag ? sceneRefusal(props.paletteDrag.type) : null;
  const rect = rootRef.current?.getBoundingClientRect();

  return (
    <div
      ref={rootRef}
      className={`workspace${props.paletteDrag ? ' dropping' : ''}`}
      onPointerDown={() => {
        setAdding(null);
        props.onSelect(null);
      }}
    >
      <div className="stage" style={{ transform: `translate(${ox}px, ${oy}px) scale(${k})` }}>
        <svg className="stage-lines" style={{ left: -2000, top: -2000 }} width={4000 + BOX_W} height={4000 + BOX_H} aria-hidden="true">
          <g transform="translate(2000 2000)">
            {PERIMETER.map((c) => {
              const p = pillPosition(c);
              const inner =
                c.side === 'left'
                  ? `M${p.x + PILL_W} ${p.y + PILL_H / 2} H0`
                  : c.side === 'right'
                    ? `M${BOX_W} ${p.y + PILL_H / 2} H${p.x}`
                    : c.side === 'top'
                      ? `M${p.x + PILL_W / 2} ${p.y + PILL_H} V0`
                      : `M${p.x + PILL_W / 2} ${BOX_H} V${p.y}`;
              const items = isOpen(c) ? itemsOf(c).length + 1 : 0;
              const slots = slotsOf(c, items);
              const fan = slots.map(({ chip: q }) => {
                if (c.side === 'left') return `M${p.x} ${p.y + PILL_H / 2} C${p.x - 18} ${p.y + PILL_H / 2} ${q.x + CHIP_W + 18} ${q.y + CHIP_H / 2} ${q.x + CHIP_W} ${q.y + CHIP_H / 2}`;
                if (c.side === 'right') return `M${p.x + PILL_W} ${p.y + PILL_H / 2} C${p.x + PILL_W + 18} ${p.y + PILL_H / 2} ${q.x - 18} ${q.y + CHIP_H / 2} ${q.x} ${q.y + CHIP_H / 2}`;
                if (c.side === 'top') return `M${p.x + PILL_W / 2} ${p.y} V${q.y + CHIP_H}`;
                return `M${p.x + PILL_W / 2} ${p.y + PILL_H} V${q.y}`;
              });
              return (
                <g key={c.key} style={{ stroke: c.color }}>
                  <path className={`stage-link${counts[c.key] || isOpen(c) ? ' live' : ''}`} d={inner} />
                  {fan.map((d, i) => (
                    <path key={i} className="stage-fan" d={d} />
                  ))}
                  {/* A character's dialogue hangs off it. */}
                  {slots.map(({ chip, dialogue }, i) =>
                    dialogue ? <path key={`d${i}`} className="stage-fan dialogue-fan" d={`M${chip.x} ${chip.y + CHIP_H / 2} H${dialogue.x + DLG_W}`} /> : null,
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {PERIMETER.map((c) => {
          const p = pillPosition(c);
          const open = isOpen(c);
          const items = open ? itemsOf(c) : [];
          const slots = slotsOf(c, items.length + 1);
          const addAt = slots[items.length]!.chip;
          return (
            <div key={c.key}>
              <button
                className={`perimeter${open ? ' open' : ''}${counts[c.key] === 0 ? ' empty' : ''}${dragCategory?.key === c.key ? ' target' : ''}`}
                style={{ left: p.x, top: p.y, '--cat': c.color } as React.CSSProperties}
                aria-expanded={open}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setExpanded((x) => ({ ...x, [c.key]: !open }))}
              >
                <Symbol type={c.symbol} />
                {c.label}
                <span className="cnt">{counts[c.key] || '+'}</span>
              </button>
              {items.map((item, i) => {
                const q = slots[i]!.chip;
                const said = c.key === 'characters' ? linesOf(project, sceneId, item.id) : [];
                const box = slots[i]!.dialogue;
                return (
                  <div key={item.id}>
                  {box && said.length > 0 && (
                    <div
                      className="dlg-box"
                      role="group"
                      aria-label={`${item.label}’s dialogue`}
                      style={{ left: box.x, top: box.y, width: DLG_W, '--cat': 'var(--c-dialogue)' } as React.CSSProperties}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <span className="dlg-head">
                        <Symbol type="dialogue" size={11} />
                        Dialogue · {said.length}
                      </span>
                      {said.slice(0, DLG_ROWS).map((l) => (
                        <button
                          key={l.id}
                          className="dlg-row"
                          title="Go to this line in the script"
                          onClick={() => {
                            setTab('Script');
                            setFocusLine(l.id);
                          }}
                        >
                          <span className="mono">#{l.order}</span>
                          <span className="dlg-text">{l.text || '…'}</span>
                        </button>
                      ))}
                      {said.length > DLG_ROWS && <span className="dlg-more">+ {said.length - DLG_ROWS} more</span>}
                    </div>
                  )}
                  <div
                    className={`chip-item${props.selection === item.id ? ' selected' : ''}`}
                    style={{ left: q.x, top: q.y, '--cat': c.color } as React.CSSProperties}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      props.onSelect(item.id);
                    }}
                    onDoubleClick={() => setDetail(item.id)}
                    title="Double-click for detail · F2 renames"
                  >
                    <Symbol type={item.symbol} size={13} color={item.color} />
                    {editing === item.id ? (
                      <NameEdit
                        value={project.objects[item.id]?.name ?? ''}
                        onDone={(value) => {
                          setEditing(null);
                          if (value !== null) props.onCommit(renameObject(project, item.id, value));
                        }}
                      />
                    ) : (
                      <span className="chip-name">{item.label}</span>
                    )}
                    {item.code && editing !== item.id && <span className="chip-code mono">{item.code}</span>}
                  </div>
                  </div>
                );
              })}
              {open && (
                <div className="chip-add-wrap" style={{ left: addAt.x, top: addAt.y }}>
                  <button
                    className="chip-add"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setAdding(adding === c.key ? null : c.key)}
                  >
                    + Add {c.key === 'logic' ? 'logic' : c.label.toLowerCase().replace(/s$/, '')}
                  </button>
                  {adding === c.key && (
                    <AddMenu
                      project={project}
                      sceneId={sceneId}
                      category={c}
                      onAdd={(next, id, fresh) => added(next, id, fresh, c.key)}
                      onClose={() => setAdding(null)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}

        <section className="scene-box" aria-label="Scene authoring" style={{ width: BOX_W, height: BOX_H }} onPointerDown={(e) => e.stopPropagation()}>
          <div className="scene-head">
            <div className="scene-title">
              <Symbol type="scene" size={16} />
              <span className="mono scene-code">{scene.data.code}</span>
              {editingName ? (
                <NameEdit
                  value={scene.name}
                  className="scene-name-input"
                  onDone={(value) => {
                    setEditingName(false);
                    if (value !== null) props.onCommit(renameObject(project, sceneId, value));
                  }}
                />
              ) : (
                <span className="scene-name" title="Double-click to rename" onDoubleClick={() => setEditingName(true)}>
                  {scene.name}
                </span>
              )}
              <StatusChip
                status={(scene.data.status as SceneData['status']) ?? 'outline'}
                onChange={(status) => props.onCommit(setSceneData(project, sceneId, { status }))}
              />
            </div>
            <div className="scene-meta">
              <select
                aria-label="Interior or exterior"
                value={(scene.data.intExt as string) ?? 'INT.'}
                onChange={(e) => props.onCommit(setSceneData(project, sceneId, { intExt: e.currentTarget.value }))}
              >
                {['INT.', 'EXT.', 'INT./EXT.'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <LocationPicker project={project} sceneId={sceneId} onCommit={props.onCommit} />
              <select
                aria-label="Time of day"
                value={(scene.data.time as string) ?? 'DAY'}
                onChange={(e) => props.onCommit(setSceneData(project, sceneId, { time: e.currentTarget.value }))}
              >
                {/* The script's heading can set any time; it shows here too. */}
                {[...new Set(['DAY', 'NIGHT', 'DAWN', 'DUSK', 'MORNING', 'EVENING', 'CONTINUOUS', 'LATER', 'MOMENTS LATER', ...(scene.data.time ? [scene.data.time as string] : [])])].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <div className="grow" />
              <div role="tablist" className="scene-tabs">
                {TABS.map((t) => (
                  <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="scene-body">
            {tab === 'Script' && <ScriptEditor project={project} sceneId={sceneId} onCommit={props.onCommit} focusLine={focusLine} />}
            {tab !== 'Script' && (
              <textarea
                key={`${tab}:${sceneId}`}
                className="scene-field"
                aria-label={tab}
                placeholder={
                  tab === 'Summary'
                    ? 'What happens in this scene, in a sentence or two. It shows on the story graph.'
                    : tab === 'Purpose'
                      ? 'Why this scene is in the game: what it changes for the player or the story.'
                      : 'Anything else: references, open questions, production notes.'
                }
                defaultValue={tab === 'Notes' ? scene.notes : ((scene.data[tab.toLowerCase()] as string | undefined) ?? '')}
                onBlur={(e) => {
                  const value = e.currentTarget.value.trim();
                  props.onCommit(tab === 'Notes' ? setSceneNotes(project, sceneId, value) : setSceneData(project, sceneId, { [tab.toLowerCase()]: value }));
                }}
              />
            )}
          </div>
          {tab === 'Script' && <ScriptFooter project={project} sceneId={sceneId} onCommit={props.onCommit} />}
        </section>
      </div>

      {detail && project.objects[detail] && (
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

      <div className="timeline-strip" onPointerDown={(e) => e.stopPropagation()}>
        <button className="strip-open" onClick={props.onTimeline}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 6.5l3-3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          SCENE TIMELINE
        </button>
        <span className="strip-summary">
          {summary.events} event{summary.events === 1 ? '' : 's'} · {summary.branches} branch{summary.branches === 1 ? '' : 'es'} · {summary.freePlay} free-play
        </span>
        <div className="strip-blocks" aria-hidden="true">
          {summary.kinds.map((kind, i) => (
            <span key={i} className={`strip-block strip-${kind}`} />
          ))}
        </div>
      </div>

      {props.paletteDrag && refusal && rect && (
        <div className="drop-refusal" style={{ left: props.paletteDrag.clientX - rect.left + 12, top: props.paletteDrag.clientY - rect.top + 50 }}>
          {refusal}
        </div>
      )}
    </div>
  );
});

const StatusChip = ({ status, onChange }: { status: NonNullable<SceneData['status']>; onChange: (status: SceneData['status']) => void }) => {
  const at = STATUS.findIndex((s) => s.key === status);
  const next = STATUS[(at + 1) % STATUS.length]!;
  return (
    <button className={`status-chip status-${status}`} title={`Click to mark ${next.label.toLowerCase()}`} onClick={() => onChange(next.key)}>
      {STATUS[at]?.label ?? 'Outline'}
    </button>
  );
};

/** Where the scene is set: one of the project's environments, or a new one. */
const LocationPicker = ({ project, sceneId, onCommit }: { project: Project; sceneId: string; onCommit: (p: Project) => void }) => {
  const scene = project.objects[sceneId]!;
  const locations = Object.values(project.objects).filter((o) => o.type === 'environment');
  const [naming, setNaming] = useState(false);
  if (naming) {
    return (
      <input
        className="location-input"
        aria-label="New location name"
        placeholder="Location name…"
        autoFocus
        onBlur={(e) => {
          setNaming(false);
          const name = e.currentTarget.value.trim();
          if (!name) return;
          const made = addElement(project, sceneId, 'environment', name);
          if (made) onCommit(setSceneData(made.project, sceneId, { locationId: made.id }));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setNaming(false);
        }}
      />
    );
  }
  return (
    <select
      aria-label="Location"
      className="location"
      value={(scene.data.locationId as string) ?? ''}
      onChange={(e) => {
        const value = e.currentTarget.value;
        if (value === '__new') setNaming(true);
        else onCommit(setSceneData(project, sceneId, { locationId: value || undefined }));
      }}
    >
      <option value="">Location…</option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
      <option value="__new">+ New location…</option>
    </select>
  );
};
