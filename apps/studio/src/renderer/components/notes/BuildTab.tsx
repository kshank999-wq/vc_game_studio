import { useState } from 'react';
import { spineLane } from '../../model/layout';
import { BIBLE_SECTIONS, KINDS, LAYER_HINT, SYSTEMS, builtFrom, dialogueOf, kindFor, newLevel, placeNote, placeRefusal, playerLaneOf, staged, stillNotes, trackNodes, type KindGroup, type Place, type Staged } from '../../model/notes/convert';
import { livePlacements, notesOf, refOf } from '../../model/notes/sorter';
import { LAYERS, type ExtractedNote, type Layer } from '../../model/notes/types';
import { TYPE_LABEL } from '../../model/semantics';
import type { ObjectType, Project } from '../../model/types';
import { Symbol } from '../Symbol';
import { dragged, endDrag, isOurs, startDrag } from './parts';

export interface Carry {
  noteId: string;
  objectId: string;
}

interface Props {
  project: Project;
  onCommit: (project: Project) => void;
  onSay: (message: string) => void;
  carry: Carry | null;
  onCarry: (carry: Carry | null) => void;
  onConvert: (noteId: string) => void;
  onShowSource: (note: ExtractedNote) => void;
  onReview: () => void;
}

const LAYER_LABEL: Record<Layer, string> = { narrative: 'Narrative', behavior: 'Behavior', systemic: 'Systemic', presentation: 'Presentation' };

/** What a staged object is called, and its symbol. */
const labelOf = (project: Project, s: Staged): { name: string; type: ObjectType; player: boolean } => {
  const o = project.objects[s.destination.objectId];
  if (o) return { name: o.name, type: o.type, player: !!o.data.playerBeat };
  const line = project.lines.find((l) => l.id === s.destination.objectId);
  const { speaker, words } = dialogueOf(s.note.text);
  const quoted = (t: string) => `“${t.length > 34 ? `${t.slice(0, 33).trimEnd()}…` : t}”`;
  return { name: line ? quoted(line.text) : s.note.name || `${s.destination.speaker ?? speaker ? `${s.destination.speaker ?? speaker}: ` : ''}${quoted(words)}`, type: 'dialogue', player: false };
};

const groupOf = (project: Project, s: Staged): KindGroup => {
  const { type, player } = labelOf(project, s);
  return kindFor(type, player)?.group ?? KINDS.find((k) => k.type === type)?.group ?? 'Story';
};

/**
 * Step 3, Build flow (HANDOFF §3, spec §8–§12): the staging library on the
 * left, the story graph in the middle — the Spine, each scene's four layers,
 * the Player Lane — and the other places a card can go on the right. Drag a
 * card, or click it to pick it up and click where it goes. A placed card
 * stays in the library, marked placed, with its source link.
 */
export const BuildTab = ({ project, onCommit, onSay, carry, onCarry, onConvert, onShowSource, onReview }: Props) => {
  const [filter, setFilter] = useState<'open' | 'placed' | 'all'>('open');
  const [layersOf, setLayersOf] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const items = staged(project);
  const shown = items.filter((s) => (filter === 'all' ? true : filter === 'placed' ? s.placed : !s.placed));
  const loose = stillNotes(project);

  const place = (to: Place, from: Carry | null = carry) => {
    if (!from) {
      onSay('Pick a card up first: click one in “Ready to place”, or drag it here.');
      return;
    }
    const s = items.find((x) => x.note.id === from.noteId && x.destination.objectId === from.objectId);
    if (!s) return;
    const why = placeRefusal(project, labelOf(project, s).type, to);
    if (why) {
      onSay(why);
      return;
    }
    const done = placeNote(project, from.noteId, from.objectId, to);
    if (!done) return;
    onCommit(done.project);
    onCarry(null);
    setLayersOf(null);
    onSay(`${labelOf(project, s).name} placed. It stays in the library, marked placed, with its source link.`);
  };

  /** A drop target: dragged onto, or clicked with a card picked up. */
  const target = (id: string, to: Place | (() => void)) => ({
    className: over === id ? ' over' : carry ? ' ready' : '',
    onDragOver: (e: React.DragEvent) => {
      if (!isOurs(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const d = dragged(e);
      endDrag();
      setOver(null);
      if (d?.kind !== 'object') return;
      if (typeof to === 'function') {
        onCarry({ noteId: d.noteId, objectId: d.objectId });
        to();
      } else place(to, { noteId: d.noteId, objectId: d.objectId });
    },
    onClick: (e: React.MouseEvent) => {
      if (!carry) return;
      e.stopPropagation();
      if (typeof to === 'function') to();
      else place(to);
    },
  });

  const count = (fn: (p: ReturnType<typeof livePlacements>[number]) => boolean) =>
    notesOf(project).notes.reduce((n, note) => n + livePlacements(project, note).filter(fn).length, 0);

  const spine = trackNodes(project, spineLane(project).id);
  const player = playerLaneOf(project);
  const beats = player ? trackNodes(project, player.id) : [];
  const built = selected ? builtFrom(project, selected) : [];

  const node = (n: (typeof spine)[number], track: 'spine' | 'player') => {
    const o = n.object;
    if (o.type === 'begin' || o.type === 'end') return <span key={n.id} className="ns-pill">{o.type === 'begin' ? 'BEGIN' : 'END'}</span>;
    const notes = builtFrom(project, n.id).length;
    const isScene = o.type === 'scene';
    const t = isScene ? target(`scene:${n.id}`, () => setLayersOf(n.id)) : null;
    return (
      <div key={n.id} className="ns-node-wrap">
        <button
          className={`ns-node ns-node-${o.type}-type${selected === n.id ? ' on' : ''}${t?.className ?? ''}`}
          onDragOver={t?.onDragOver}
          onDragLeave={t?.onDragLeave}
          onDrop={t?.onDrop}
          onClick={(e) => {
            if (carry && isScene) t!.onClick(e);
            else setSelected(selected === n.id ? null : n.id);
          }}
          aria-label={`${TYPE_LABEL[o.type]} ${o.data.code ?? ''} ${o.name}`.replace(/\s+/g, ' ')}
        >
          {o.type === 'choice' ? (
            <span className="ns-node-choice" />
          ) : (
            <>
              <span className="ns-node-kicker">
                <Symbol type={o.type} size={9} /> {TYPE_LABEL[o.type].split(' ')[0]}
                {o.data.code ? ` · ${o.data.code}` : ''}
              </span>
              <span className="ns-node-name">{o.name}</span>
            </>
          )}
          {notes > 0 && (
            <span className="ns-node-notes">
              {notes} note{notes === 1 ? '' : 's'}
            </span>
          )}
        </button>
        {layersOf === n.id && (
          <div className="ns-layers" role="group" aria-label={`Drop into a layer of ${o.name}`}>
            <span className="ns-lbl small">Drop into a layer of {o.name}</span>
            {LAYERS.map((layer) => {
              const lt = target(`layer:${n.id}:${layer}`, { target: 'sceneLayer', sceneId: n.id, layer });
              return (
                <button key={layer} className={`ns-layer${lt.className}`} onDragOver={lt.onDragOver} onDragLeave={lt.onDragLeave} onDrop={lt.onDrop} onClick={lt.onClick}>
                  {LAYER_LABEL[layer]}
                  <span className="ns-muted">{LAYER_HINT[layer]}</span>
                </button>
              );
            })}
            <button className="tb-btn small" onClick={() => setLayersOf(null)}>
              Close
            </button>
          </div>
        )}
        {track === 'spine' && gap(n.id, 'spine')}
        {track === 'player' && gap(n.id, 'player')}
      </div>
    );
  };

  /** A slot after a node on a track: where a card dropped there goes. */
  const gap = (after: string, track: 'spine' | 'player') => {
    const t = target(`${track}:${after}`, track === 'spine' ? { target: 'spine', after } : { target: 'playerLane', after });
    return (
      <span
        className={`ns-gap${t.className}`}
        role="button"
        aria-label={`Place on the ${track === 'spine' ? 'Spine' : 'Player Lane'} after ${project.objects[after]?.name}`}
        onDragOver={t.onDragOver}
        onDragLeave={t.onDragLeave}
        onDrop={t.onDrop}
        onClick={t.onClick}
      >
        +
      </span>
    );
  };

  const shelf = (id: string, label: string, symbol: ObjectType, n: number, to: Place) => {
    const t = target(id, to);
    return (
      <button key={id} className={`ns-shelf${t.className}`} onDragOver={t.onDragOver} onDragLeave={t.onDragLeave} onDrop={t.onDrop} onClick={t.onClick}>
        <Symbol type={symbol} size={13} />
        {label}
        <span className="grow" />
        <span className="ns-count">{n}</span>
      </button>
    );
  };

  return (
    <div className="ns-build" onClick={() => carry && onCarry(null)}>
      <aside className="ns-staging" aria-label="Ready to place" onClick={(e) => e.stopPropagation()}>
        <header className="ns-panel-head">
          <span className="ns-lbl">Ready to place</span>
          <span className="grow" />
          <span className="ns-count">{items.filter((s) => !s.placed).length}</span>
        </header>
        <div className="ns-seg" role="tablist" aria-label="Show">
          {(
            [
              ['open', 'Not placed'],
              ['placed', 'Placed'],
              ['all', 'All'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        {(['Story', 'World', 'Systems'] as const).map((group) => {
          const list = shown.filter((s) => groupOf(project, s) === group);
          if (!list.length) return null;
          return (
            <div key={group}>
              <span className="ns-lbl small">{group}</span>
              {list.map((s) => {
                const { name, type, player: isPlayer } = labelOf(project, s);
                const carried = carry?.noteId === s.note.id && carry.objectId === s.destination.objectId;
                return (
                  <button
                    key={`${s.note.id}:${s.destination.objectId}`}
                    className={`ns-staged${carried ? ' carried' : ''}${s.placed ? ' placed' : ''}`}
                    draggable
                    aria-pressed={carried}
                    aria-label={`${name}${s.placed ? ', placed' : ''}`}
                    onDragStart={(e) => startDrag(e, { kind: 'object', noteId: s.note.id, objectId: s.destination.objectId }, name)}
                    onDragEnd={endDrag}
                    onClick={() => onCarry(carried ? null : { noteId: s.note.id, objectId: s.destination.objectId })}
                    title={carried ? 'Picked up: click where it goes' : 'Drag it, or click to pick it up'}
                  >
                    <Symbol type={type} size={13} color={isPlayer ? '#E8E0C8' : undefined} />
                    <span className="ns-staged-name">{name}</span>
                    <span className="ns-ref">{carried ? 'picked up' : refOf(project, s.note)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {!shown.length && <p className="ns-empty">{filter === 'placed' ? 'Nothing placed yet.' : 'Nothing to place: convert cards first.'}</p>}
        {loose.length > 0 && (
          <div className="ns-loose">
            <span className="ns-lbl small">Still just notes · {loose.length}</span>
            {loose.map((n) => (
              <div key={n.id} className="ns-loose-row">
                <span className="ns-mark ns-mark-sorted" />
                <span className="ns-staged-name">{n.name || n.text}</span>
                <button className="ns-link" onClick={() => onConvert(n.id)}>
                  Convert
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="grow" />
        <p className="ns-muted small">Drag a card onto the story, a level or the Bible, or click it and then where it goes. It stays here, marked placed, and keeps its source link.</p>
      </aside>

      <section className="ns-graph" aria-label="Story graph">
        <header className="ns-panel-head">
          <span className="ns-lbl">Story graph</span>
          <span className="ns-muted">{carry ? 'Click where it goes: a + on a track, a scene for its layers, or a place on the right' : 'drop on the Spine, a lane, or a scene’s layer'}</span>
        </header>
        <div className="ns-track spine" aria-label="Spine">
          <span className="ns-lbl small">Spine</span>
          <div className="ns-track-row">{spine.map((n) => node(n, 'spine'))}</div>
        </div>
        <div className="ns-track player" aria-label="Player Lane">
          <span className="ns-lbl small">Player Lane</span>
          <div className="ns-track-row">
            {beats.map((n) => node(n, 'player'))}
            {(() => {
              const t = target('player:end', { target: 'playerLane' });
              return (
                <button className={`ns-beat-slot${t.className}`} onDragOver={t.onDragOver} onDragLeave={t.onDragLeave} onDrop={t.onDrop} onClick={t.onClick}>
                  + drop a beat
                </button>
              );
            })()}
          </div>
        </div>
        {selected && project.objects[selected] && (
          <div className="ns-built" aria-label={`${project.objects[selected]!.name}: built from notes`}>
            <header className="ns-panel-head">
              <span className="ns-lbl">
                {project.objects[selected]!.name} · built from {built.length} note{built.length === 1 ? '' : 's'}
              </span>
              <span className="grow" />
              {built[0] && (
                <button className="tb-btn small" onClick={() => onShowSource(built[0]!.note)}>
                  Show in raw notes
                </button>
              )}
            </header>
            <div className="ns-built-list">
              {built.map((b, i) => (
                <button key={`${b.note.id}:${i}`} className="ns-built-card" onClick={() => onShowSource(b.note)}>
                  <span>“{b.note.text}”</span>
                  <span className="ns-ref">
                    {refOf(project, b.note)}
                    {b.layer ? ` → ${LAYER_LABEL[b.layer]}` : ''}
                  </span>
                </button>
              ))}
              {!built.length && <p className="ns-empty">Nothing from the notes here yet.</p>}
            </div>
          </div>
        )}
      </section>

      <aside className="ns-places" aria-label="Other places to drop" onClick={(e) => e.stopPropagation()}>
        <span className="ns-lbl">Other places to drop</span>
        <span className="ns-lbl small">Game Bible</span>
        {BIBLE_SECTIONS.map((b) => shelf(`bible:${b.key}`, b.label, b.symbol, count((p) => p.target === 'bible' && p.targetId === b.key), { target: 'bible', section: b.key }))}
        <span className="ns-lbl small">Levels</span>
        {(project.levels?.levels ?? []).map((l) => shelf(`level:${l.id}`, l.name, 'environment', count((p) => p.target === 'level' && p.targetId === l.id), { target: 'level', levelId: l.id }))}
        <button
          className="ns-shelf add"
          onClick={() => {
            const made = newLevel(project);
            onCommit(made.project);
            onSay('A new level. Drop cards on it; it opens in Levels.');
          }}
        >
          + New level
        </button>
        <span className="ns-lbl small">Gameplay</span>
        {SYSTEMS.map((s) => shelf(`system:${s.key}`, s.label, s.symbol, count((p) => p.target === 'system' && p.targetId === s.key), { target: 'system', section: s.key }))}
        <div className="grow" />
        <button className="tb-btn wide" onClick={onReview}>
          Review what’s left
        </button>
      </aside>
    </div>
  );
};
