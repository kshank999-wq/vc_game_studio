import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { renameObject } from '../../model/project';
import {
  PERIMETER,
  addElement,
  categoryCounts,
  elementsIn,
  linesOf,
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
import { DialogueRow, dualsIn } from './DialogueRows';

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

// The panel on the right: what is in the scene, by kind. Its left edge
// drags it wider or narrower; the width is kept for next time.
const SIDE = { min: 240, max: 640, normal: 320 };
const SIDE_KEY = 'vcgs.sceneSide';
const savedSide = (): number => {
  try {
    const v = Number(localStorage.getItem(SIDE_KEY));
    if (v) return Math.min(SIDE.max, Math.max(SIDE.min, v));
  } catch {
    // No saved width, or storage is off: the normal one.
  }
  return SIDE.normal;
};

/** The order the panel lists a scene's contents in: who, then what they handle, then how it plays. */
const SIDE_ORDER = ['characters', 'objects', 'inventory', 'choices', 'puzzles', 'logic', 'cinematics', 'environment'];
const SIDE_CATEGORIES: readonly Category[] = SIDE_ORDER.map((key) => PERIMETER.find((c) => c.key === key)).filter((c): c is Category => !!c);

/** "+ Add object", "+ Add logic". */
const addLabel = (c: Category) => `+ Add ${c.key === 'logic' ? 'logic' : c.key === 'inventory' ? 'inventory item' : c.label.toLowerCase().replace(/s$/, '')}`;

// A character's lines shown under it in the panel (the first few).
const DLG_ROWS = 3;

const STATUS: { key: NonNullable<SceneData['status']>; label: string }[] = [
  { key: 'outline', label: 'Outline' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'complete', label: 'Complete' },
];

const TABS = ['Script', 'Summary', 'Purpose', 'Notes'] as const;

/**
 * The Scene Workspace (spec §10): the writing box, and down the right a panel
 * of what is in the scene: characters, objects, choices, puzzles, logic and
 * the rest. Click a kind to list them and add more; double-click one to open
 * it and set how it plays. Expand All in the top bar explodes the whole scene.
 */
export const SceneWorkspace = forwardRef<SceneSurface, Props>(function SceneWorkspace(props, ref) {
  const { project, sceneId } = props;
  const scene = project.objects[sceneId]!;
  const rootRef = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState(savedSide);
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
  // Escape goes back from an element to the list (unless a field in it is being typed in).
  useEffect(() => {
    if (!detail) return;
    const close = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape' && !typing) setDetail(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [detail]);

  const counts = categoryCounts(project, sceneId);
  const dualLines = dualsIn(project, sceneId);
  const dragCategory = props.paletteDrag ? dropCategory(props.paletteDrag.type) : undefined;

  const itemsOf = (c: Category): { id: string; label: string; code?: string; color?: string; symbol: Category['symbol'] }[] =>
    elementsIn(project, sceneId, c.key).map((o) => ({ id: o.id, label: o.name, code: o.data.code, color: symbolColor(o), symbol: o.type }));
  // A kind with something in it starts open, so the panel shows what the scene holds.
  const isOpen = (c: Category) => expanded[c.key] ?? counts[c.key] > 0;
  const summary = timelineSummary(project, sceneId);

  // Drag the panel's left edge to make it wider or narrower.
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const from = { x: e.clientX, w: side };
    let last = side;
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(SIDE.max, Math.max(SIDE.min, from.w + from.x - ev.clientX)));
      setSide(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(SIDE_KEY, String(last));
      } catch {
        // Not kept for next time; it still works now.
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

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
      setDetail(null);
      added(result.project, result.id, true, category.key);
      return true;
    },
    rename: (id) => {
      setDetail(null);
      setEditing(id);
    },
  }));

  const refusal = props.paletteDrag ? sceneRefusal(props.paletteDrag.type) : null;
  const rect = rootRef.current?.getBoundingClientRect();
  const opened = detail ? project.objects[detail] : undefined;

  return (
    <div
      ref={rootRef}
      className={`workspace scene-split${props.paletteDrag ? ' dropping' : ''}`}
      style={{ '--side': `${side}px` } as React.CSSProperties}
      onPointerDown={() => {
        setAdding(null);
        props.onSelect(null);
      }}
    >
      <div className="scene-main">
        <section className="scene-box" aria-label="Scene authoring" onPointerDown={(e) => e.stopPropagation()}>
          <div className="scene-head">
            <div className="scene-title">
              <Symbol type={scene.type} size={16} />
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

      <aside className="scene-side" aria-label="In this scene" onPointerDown={(e) => e.stopPropagation()}>
        <div className="side-resize" role="separator" aria-orientation="vertical" aria-label="Drag to make the panel wider or narrower" title="Drag to resize · double-click for the normal width" onPointerDown={startResize} onDoubleClick={() => { setSide(SIDE.normal); try { localStorage.removeItem(SIDE_KEY); } catch { /* fine */ } }} />
        {opened ? (
          <div className="side-detail">
            <button className="side-back" onClick={() => setDetail(null)}>
              ← In this scene
            </button>
            <ElementDetail
              project={project}
              id={opened.id}
              sceneId={sceneId}
              onCommit={props.onCommit}
              onClose={() => setDetail(null)}
              onOpenBible={props.onOpenBible}
              onOpenCode={props.onOpenCode}
              onNavigate={props.onNavigate}
              variant="panel"
            />
          </div>
        ) : (
          <div className="side-list">
            <div className="side-head">
              IN THIS SCENE
              <span className="side-hint">Double-click one to open it</span>
            </div>
            {SIDE_CATEGORIES.map((c) => {
              const open = isOpen(c);
              const items = open ? itemsOf(c) : [];
              return (
                <div key={c.key} className={`side-cat${open ? ' open' : ''}${dragCategory?.key === c.key ? ' target' : ''}`} style={{ '--cat': c.color } as React.CSSProperties}>
                  <button className="side-cat-head" aria-label={`${c.label} (${counts[c.key]})`} aria-expanded={open} onClick={() => setExpanded((x) => ({ ...x, [c.key]: !open }))}>
                    <span className="side-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    <Symbol type={c.symbol} />
                    <span className="side-cat-name">{c.label}</span>
                    <span className="cnt">{counts[c.key]}</span>
                  </button>
                  {open && (
                    <div className="side-items" role="list" aria-label={c.label}>
                      {items.map((item) => {
                        const said = c.key === 'characters' ? linesOf(project, sceneId, item.id) : [];
                        return (
                          <div key={item.id} role="listitem">
                            <div
                              className={`side-item${props.selection === item.id ? ' selected' : ''}`}
                              tabIndex={0}
                              title="Double-click to open it · F2 renames"
                              onClick={() => props.onSelect(item.id)}
                              onDoubleClick={() => editing !== item.id && setDetail(item.id)}
                              onKeyDown={(e) => {
                                if (editing === item.id) return;
                                if (e.key === 'Enter') setDetail(item.id);
                                if (e.key === 'F2') setEditing(item.id);
                              }}
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
                              {editing !== item.id && (
                                <button className="side-open" aria-label={`Open ${item.label}`} title="Open it" onClick={(e) => { e.stopPropagation(); setDetail(item.id); }}>
                                  ›
                                </button>
                              )}
                            </div>
                            {said.length > 0 && (
                              <div className="dlg-box side-dlg" role="group" aria-label={`${item.label}’s dialogue`} style={{ '--cat': 'var(--c-dialogue)' } as React.CSSProperties}>
                                <span className="dlg-head">
                                  <Symbol type="dialogue" size={11} />
                                  Dialogue · {said.length}
                                </span>
                                {said.slice(0, DLG_ROWS).map((l) => (
                                  <DialogueRow
                                    key={l.id}
                                    project={project}
                                    line={l}
                                    pair={dualLines.get(l.id)}
                                    onPick={() => {
                                      setTab('Script');
                                      setFocusLine(l.id);
                                    }}
                                  />
                                ))}
                                {said.length > DLG_ROWS && <span className="dlg-more">+ {said.length - DLG_ROWS} more</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {items.length === 0 && <div className="side-empty">None in this scene yet.</div>}
                      <div className="side-add">
                        <button className="chip-add" aria-expanded={adding === c.key} onClick={() => setAdding(adding === c.key ? null : c.key)}>
                          {addLabel(c)}
                        </button>
                        {adding === c.key && (
                          <AddMenu
                            project={project}
                            sceneId={sceneId}
                            category={c}
                            inline
                            onAdd={(next, id, fresh) => added(next, id, fresh, c.key)}
                            onClose={() => setAdding(null)}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </aside>

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
