import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { addElement, sceneElements } from '../../model/scene';
import {
  MAIN,
  addEvent,
  eventDetail,
  eventKindFor,
  eventLine,
  eventTitle,
  exchanges,
  moveEvent,
  removeEvent,
  sceneExit,
  sceneTimeline,
  type Track,
} from '../../model/timeline';
import type { EventKind, ObjectType, Project, TimelineEvent } from '../../model/types';
import type { PaletteDrag } from '../canvas/StoryCanvas';
import { Symbol } from '../Symbol';
import { KIND_SYMBOL } from './parts';
import { ExplodedScene } from './ExplodedScene';
import { TimelineInspector } from './TimelineInspector';
import type { SceneSurface } from './SceneWorkspace';

interface Props {
  project: Project;
  sceneId: string;
  onCommit: (project: Project) => void;
  paletteDrag: PaletteDrag | null;
  onSay: (message: string) => void;
  onOpen: () => void;
  onFullView: () => void;
}

// Layout in pixels (mockup 05).
const HEAD_H = 40;
const PAD_X = 24;
const FIRST_TRACK = 40;
const TRACK_H = 88;
const TRACK_GAP = 52;
const EVENT_TOP = 12;
const EVENT_H = 64;
const GAP = 8;
const CHOICE = 32;

const KIND_LABEL: Record<EventKind, string> = {
  cinematic: 'CIN',
  dialogue: 'DLG',
  action: 'ACTION',
  interaction: 'INTERACT',
  trigger: 'TRIGGER',
  choice: 'CHOICE',
  freePlay: 'FREE PLAY · OPEN-ENDED',
};


const widthOf = (event: TimelineEvent): number => {
  switch (event.kind) {
    case 'cinematic':
      return Math.max(110, Math.min(240, 90 + (event.seconds ?? 6) * 10));
    case 'choice':
      return CHOICE + 118;
    case 'freePlay':
      return 300;
    case 'trigger':
      return 110;
    default:
      return 100;
  }
};

interface Block {
  events: TimelineEvent[];
  x: number;
  w: number;
}

interface Row {
  track: Track;
  top: number;
  blocks: Block[];
  startX: number;
}

/** Lay out every track: the main one from the left, each branch starting under its choice. */
const layoutTracks = (tracks: Track[], grouped: boolean): Row[] => {
  const rows: Row[] = [];
  const choiceX = new Map<string, number>();
  tracks.forEach((track, i) => {
    const top = FIRST_TRACK + i * (TRACK_H + TRACK_GAP);
    const startX = track.branch ? (choiceX.get(track.branch.choiceEventId) ?? PAD_X) + CHOICE + 28 : PAD_X;
    let x = startX;
    const groups = grouped ? exchanges(track.events) : track.events.map((e) => [e]);
    const blocks = groups.map((events) => {
      const w = events.length > 1 ? 170 : widthOf(events[0]!);
      const block = { events, x, w };
      if (events[0]!.kind === 'choice') choiceX.set(events[0]!.id, x);
      x += w + GAP;
      return block;
    });
    rows.push({ track, top, blocks, startX });
  });
  return rows;
};

/**
 * The scene timeline (spec §13, HANDOFF iteration 2): event tracks across the
 * top in playing order, a choice splitting off branch tracks that may
 * reconnect; below, the exploded scene linked to it, and the inspector.
 */
export const SceneTimeline = forwardRef<SceneSurface, Props>(function SceneTimeline(props, ref) {
  const { project, sceneId } = props;
  const tracksRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<SceneSurface>(null);
  const panelBox = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [element, setElement] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(null);

  const tracks = sceneTimeline(project, sceneId);
  const rows = layoutTracks(tracks, grouped);
  const all = tracks.flatMap((t) => t.events);
  const event = selected ? all.find((e) => e.id === selected) : undefined;

  // ------------------------------------------------------------ positions

  /** Which track and slot a point over the tracks falls on. */
  const slotAt = (clientX: number, clientY: number, except?: string): { track: string; index: number; x: number; top: number } | null => {
    const el = tracksRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const x = clientX - rect.left + el.scrollLeft;
    const y = clientY - rect.top + el.scrollTop;
    let row = rows[0]!;
    for (const r of rows) if (y >= r.top - TRACK_GAP / 2) row = r;
    const blocks = row.blocks.filter((b) => !b.events.some((e) => e.id === except));
    let index = 0;
    let markX = row.startX - GAP / 2;
    let count = 0;
    for (const b of blocks) {
      if (b.x + b.w / 2 < x) {
        count += b.events.length;
        index = count;
        markX = b.x + b.w + GAP / 2;
      }
    }
    return { track: row.track.id, index, x: markX, top: row.top };
  };

  const dropSlot = props.paletteDrag ? slotAt(props.paletteDrag.clientX, props.paletteDrag.clientY) : null;
  const moveSlot = drag ? slotAt(drag.x, drag.y, drag.id) : null;
  const mark = drag ? moveSlot : dropSlot;

  // ------------------------------------------------------------ drops

  const dropOnTimeline = (type: ObjectType, slot: { track: string; index: number }): boolean => {
    const kind = eventKindFor(type);
    if (!kind) {
      props.onSay('Characters, locations and inventory belong to the scene below; the timeline holds what happens.');
      return false;
    }
    let next = project;
    let refId: string | undefined;
    if (kind !== 'dialogue' && type !== kind) {
      const made = addElement(next, sceneId, type);
      if (!made) return false;
      next = made.project;
      refId = made.id;
    }
    const added = addEvent(next, sceneId, kind, { track: slot.track, index: slot.index, ...(refId ? { refId } : {}) });
    if (!added) return false;
    props.onCommit(added.project);
    setSelected(added.id);
    return true;
  };

  const overPanel = (drag: PaletteDrag): boolean => {
    const rect = panelBox.current?.getBoundingClientRect();
    return !!rect && drag.clientX >= rect.left && drag.clientX <= rect.right && drag.clientY >= rect.top && drag.clientY <= rect.bottom;
  };

  useImperativeHandle(ref, () => ({
    drop: (drag) => {
      if (overPanel(drag)) return panelRef.current?.drop(drag) ?? false;
      const slot = slotAt(drag.clientX, drag.clientY);
      return slot ? dropOnTimeline(drag.type, slot) : false;
    },
    rename: () => {},
    fit: () => panelRef.current?.fit?.(),
    remove: () => {
      if (!event) return;
      props.onCommit(removeEvent(project, sceneId, event.id));
      if (event.kind === 'dialogue') props.onSay('Line deleted from the script. Ctrl+Z brings it back.');
      setSelected(null);
    },
  }));

  // ------------------------------------------------------------ dragging events

  const onBlockDown = (e: React.PointerEvent, block: Block) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const first = block.events[0]!;
    setSelected(first.id);
    setElement(null);
    if (block.events.length > 1) return; // a grouped exchange moves line by line; ungroup to reorder
    const start = { x: e.clientX, y: e.clientY };
    let moving = false;
    const move = (m: PointerEvent) => {
      if (!moving && Math.hypot(m.clientX - start.x, m.clientY - start.y) < 4) return;
      moving = true;
      setDrag({ id: first.id, dx: m.clientX - start.x, dy: m.clientY - start.y, x: m.clientX, y: m.clientY });
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!moving) return;
      const slot = slotAt(u.clientX, u.clientY, first.id);
      if (slot) props.onCommit(moveEvent(project, sceneId, first.id, slot.track, slot.index));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------ linking with the panel

  const highlight = useMemo(() => {
    const lit = new Set<string>();
    if (!event) return lit;
    if (event.kind === 'dialogue') {
      lit.add(`dialogue:${sceneId}`);
      const speaker = eventLine(project, event)?.speakerId;
      if (speaker) lit.add(speaker);
    } else if (event.refId) lit.add(event.refId);
    return lit;
  }, [event, project, sceneId]);

  const pickElement = (id: string | null) => {
    setElement(id);
    if (!id) return;
    const match = id.startsWith('dialogue:') ? all.find((e) => e.kind === 'dialogue') : all.find((e) => e.refId === id);
    setSelected(match?.id ?? null);
  };

  // ------------------------------------------------------------ render

  const contentWidth = Math.max(...rows.map((r) => (r.blocks.at(-1) ? r.blocks.at(-1)!.x + r.blocks.at(-1)!.w : r.startX))) + 260;
  const contentHeight = FIRST_TRACK + rows.length * (TRACK_H + TRACK_GAP) + 12;
  const blockOf = (id: string): { row: Row; block: Block } | null => {
    for (const row of rows) for (const block of row.blocks) if (block.events.some((e) => e.id === id)) return { row, block };
    return null;
  };
  const exit = sceneExit(project, sceneId);
  const mainRow = rows[0]!;
  const mainEnd = mainRow.blocks.at(-1) ? mainRow.blocks.at(-1)!.x + mainRow.blocks.at(-1)!.w + 12 : PAD_X;
  const candidates = sceneElements(project, sceneId).filter((o) => eventKindFor(o.type) && !all.some((e) => e.refId === o.id));
  let dialogueNumber = 0;
  const numbers = new Map<string, number>();
  for (const e of all.filter((x) => x.kind === 'dialogue')) numbers.set(e.id, ++dialogueNumber);

  return (
    <div className="timeline-view">
      <section className="timeline" aria-label="Scene timeline">
        <div className="timeline-head">
          <span className="lbl">Scene timeline</span>
          <span className="timeline-hint">Playable order, entry → exit. Free play is a span, not a duration.</span>
          <div className="grow" />
          <label className="check">
            <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.currentTarget.checked)} />
            Group dialogue exchanges
          </label>
          <div className="event-menu-wrap">
            <button className="tb-btn small" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              + Event
            </button>
            {menu && (
              <div className="add-menu event-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
                <div className="menu-heading">NEW</div>
                {(
                  [
                    ['action', 'Action'],
                    ['freePlay', 'Free play'],
                    ['dialogue', 'Dialogue line'],
                    ['cinematic', 'Cinematic'],
                    ['choice', 'Choice'],
                    ['trigger', 'Trigger'],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      const added = addEvent(project, sceneId, kind);
                      if (added) {
                        props.onCommit(added.project);
                        setSelected(added.id);
                      }
                    }}
                  >
                    <Symbol type={KIND_SYMBOL[kind]} size={11} />
                    {label}
                  </button>
                ))}
                {candidates.length > 0 && <div className="menu-sep" />}
                {candidates.length > 0 && <div className="menu-heading">FROM THIS SCENE</div>}
                {candidates.map((o) => (
                  <button
                    key={o.id}
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      const added = addEvent(project, sceneId, eventKindFor(o.type)!, { refId: o.id });
                      if (added) {
                        props.onCommit(added.project);
                        setSelected(added.id);
                      }
                    }}
                  >
                    <Symbol type={o.type} size={11} />
                    {o.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="mono entry">▶ ENTRY</span>
          <span className="mono arrow">→</span>
          <span className="mono exit">EXIT ■</span>
        </div>

        <div className="tracks" ref={tracksRef} onPointerDown={() => {
          setSelected(null);
          setMenu(false);
        }}>
          <div className="tracks-inner" style={{ width: contentWidth, height: contentHeight }}>
            {rows.map((row) => (
              <div key={row.track.id}>
                <div className={`track-band${row.track.branch ? ' branch' : ''}`} style={{ top: row.top, height: TRACK_H }} />
                <div className={`track-label${row.track.branch ? ' branch' : ''}`} style={{ left: row.track.branch ? row.startX : PAD_X, top: row.top - 20 }}>
                  {row.track.branch ? `Branch · ${row.track.branch.label}` : 'Main'}
                </div>
              </div>
            ))}

            <svg className="timeline-links" width={contentWidth} height={contentHeight} aria-hidden="true">
              {rows.slice(1).map((row) => {
                const branch = row.track.branch!;
                const choice = blockOf(branch.choiceEventId);
                if (!choice) return null;
                const cx = choice.block.x + CHOICE / 2;
                const cy = choice.row.top + EVENT_TOP + EVENT_H / 2 + CHOICE / 2;
                const first = row.blocks[0];
                const tx = first ? first.x : row.startX;
                const ty = row.top + EVENT_TOP + EVENT_H / 2;
                const paths = [<path key="out" className="branch-out" d={`M${cx} ${cy} C${cx} ${ty}, ${tx - 30} ${ty}, ${tx} ${ty}`} />];
                const target = branch.rejoinEventId ? blockOf(branch.rejoinEventId) : null;
                if (target) {
                  const last = row.blocks.at(-1);
                  const sx = last ? last.x + last.w : row.startX;
                  const bottom = row.top + TRACK_H + 18;
                  const gx = target.block.x + target.block.w / 2;
                  const gy = target.row.top + EVENT_TOP + EVENT_H;
                  paths.push(
                    <path
                      key="back"
                      className="branch-back"
                      d={`M${sx} ${ty} C${sx + 40} ${ty}, ${sx + 40} ${bottom}, ${sx} ${bottom} L${gx + 20} ${bottom} C${gx} ${bottom}, ${gx} ${bottom - 30}, ${gx} ${gy + 8}`}
                    />,
                    <path key="arrow" className="branch-back" d={`M${gx - 5} ${gy + 14} l5 -9 l5 9`} />,
                  );
                }
                return <g key={row.track.id}>{paths}</g>;
              })}
            </svg>
            {rows.slice(1).map((row) => {
              const branch = row.track.branch!;
              const target = branch.rejoinEventId ? blockOf(branch.rejoinEventId) : null;
              if (!target) {
                const last = row.blocks.at(-1);
                return (
                  <span key={row.track.id} className="branch-note" style={{ left: (last ? last.x + last.w : row.startX) + 12, top: row.top + EVENT_TOP + 22 }}>
                    leaves the scene
                  </span>
                );
              }
              return (
                <span key={row.track.id} className="branch-note" style={{ left: target.block.x + target.block.w / 2 + 12, top: row.top + TRACK_H + 22 }}>
                  reconnects to {eventTitle(project, target.block.events[0]!).toLowerCase()}
                </span>
              );
            })}

            {rows.map((row) =>
              row.blocks.map((block) => {
                const first = block.events[0]!;
                const isDragged = drag?.id === first.id;
                const style = {
                  left: block.x,
                  top: row.top + EVENT_TOP + (first.kind === 'choice' ? (EVENT_H - CHOICE) / 2 : 0),
                  width: first.kind === 'choice' ? CHOICE : block.w,
                  ...(isDragged ? { transform: `translate(${drag.dx}px, ${drag.dy}px)`, zIndex: 5 } : {}),
                };
                const isSelected = block.events.some((e) => e.id === selected);
                if (first.kind === 'choice') {
                  const branches = tracks.filter((t) => t.branch?.choiceEventId === first.id).length;
                  return (
                    <div key={first.id} className="ev-choice-wrap">
                      <div
                        className={`ev-choice${isSelected ? ' selected' : ''}${isDragged ? ' dragging' : ''}`}
                        style={style}
                        title={`${eventTitle(project, first)} — ${branches + 1} option${branches ? 's' : ''}`}
                        onPointerDown={(e) => onBlockDown(e, block)}
                      />
                      <span className="ev-choice-label" style={{ left: block.x + CHOICE + 8, top: row.top + EVENT_TOP + 24 }}>
                        {first.mainLabel || eventTitle(project, first)}
                      </span>
                    </div>
                  );
                }
                const conditional = !!first.condition;
                return (
                  <div
                    key={first.id}
                    className={`ev ev-${first.kind}${isSelected ? ' selected' : ''}${conditional ? ' conditional' : ''}${isDragged ? ' dragging' : ''}`}
                    style={{ ...style, height: EVENT_H }}
                    onPointerDown={(e) => onBlockDown(e, block)}
                    title={block.events.length > 1 ? 'An exchange: untick “Group dialogue exchanges” to reorder its lines' : 'Drag to reorder'}
                  >
                    {block.events.length > 1 ? (
                      <>
                        <span className="ek">DLG × {block.events.length}</span>
                        <span className="et">{[...new Set(block.events.map((e) => eventTitle(project, e)))].join(', ')}</span>
                        <span className="es">{eventDetail(project, first)}</span>
                      </>
                    ) : (
                      <>
                        <span className="ek">
                          {first.kind === 'dialogue'
                            ? `DLG #${numbers.get(first.id)}${conditional ? ' · IF' : ''}`
                            : first.kind === 'cinematic'
                              ? `CIN · ${cinematicPlace(row, block)}`
                              : `${KIND_LABEL[first.kind]}${conditional ? ' · IF' : ''}`}
                        </span>
                        <span className="et">{eventTitle(project, first)}</span>
                        <span className="es">{eventDetail(project, first)}</span>
                      </>
                    )}
                  </div>
                );
              }),
            )}

            {exit && (
              <div className="exit-pill" style={{ left: mainEnd, top: mainRow.top + EVENT_TOP + 16 }}>
                → {exit}
              </div>
            )}
            {mainRow.blocks.length === 0 && (
              <div className="timeline-empty" style={{ left: PAD_X + 10, top: mainRow.top + EVENT_TOP + 20 }}>
                Nothing plays yet. Write dialogue in the script, add an event, or drop a cinematic, choice or trigger here.
              </div>
            )}
            {mark && (
              <div className="insert-mark" style={{ left: mark.x - 1, top: mark.top + 4, height: TRACK_H - 8 }} />
            )}
          </div>
        </div>
      </section>

      <div className="timeline-lower">
        <div className="timeline-panel" ref={panelBox}>
          <ExplodedScene
            ref={panelRef}
            project={project}
            sceneId={sceneId}
            onCommit={props.onCommit}
            selection={element}
            onSelect={pickElement}
            paletteDrag={props.paletteDrag && props.paletteDrag && overPanel(props.paletteDrag) ? props.paletteDrag : null}
            onSay={props.onSay}
            onOpen={props.onOpen}
            panel={{ onFullView: props.onFullView }}
            highlight={highlight}
          />
        </div>
        <TimelineInspector
          project={project}
          sceneId={sceneId}
          event={event}
          element={!event && element && !element.startsWith('dialogue:') ? element : null}
          numbers={numbers}
          onCommit={props.onCommit}
          onSelect={setSelected}
          onSay={props.onSay}
        />
      </div>
    </div>
  );
});

/** Where a cinematic plays: first on the main track is the entry, last is the exit. */
const cinematicPlace = (row: Row, block: Block): string => {
  if (row.track.id !== MAIN) return 'BRANCH';
  if (row.blocks[0] === block) return 'ENTRY';
  if (row.blocks.at(-1) === block) return 'EXIT';
  return 'IN SCENE';
};
