import { useState } from 'react';
import { statesOf } from '../../model/details';
import { assetOf } from '../../model/level/geometry';
import { levelsOf } from '../../model/level/level';
import { addNote, gearDo, isOpen, presetFrom, removePreset, resolveNote, savePreset, setWorldByHand, type LevelPlayState, type Where } from '../../model/level/play';
import { recipesOf } from '../../model/crafting';
import { equipmentList } from '../../model/equipment';
import { skillsOf } from '../../model/skills';
import { CraftSection, GearSection, SkillsSection } from '../play/GearPanels';
import type { Project } from '../../model/types';
import { PlayControls } from './PlayControls';

interface Props {
  project: Project;
  levelId: string;
  state: LevelPlayState;
  /** The tab to open on (the gear screen, from I). */
  tab?: Tab;
  at: Where;
  /** The item the player is nearest, for a note. */
  nearest?: string;
  onState: (state: LevelPlayState) => void;
  onCommit: (project: Project) => void;
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}

type Tab = 'state' | 'gear' | 'log' | 'notes' | 'controls';

/**
 * Paused (spec §9.2–9.3): what the story and the level hold right now, which
 * can be changed by hand to set up a test and saved as a preset; the event log
 * of what was checked and what fired; notes against the responsible item.
 */
export const PlayInspect = (props: Props) => {
  const { project, state } = props;
  const set = levelsOf(project);
  const hasGear = equipmentList(project).length > 0 || skillsOf(project).length > 0 || recipesOf(project).length > 0;
  const [tab, setTab] = useState<Tab>(props.tab === 'gear' && !hasGear ? 'state' : (props.tab ?? 'state'));
  const [presetName, setPresetName] = useState('');
  const [note, setNote] = useState('');
  const [about, setAbout] = useState(props.nearest ?? '');
  const [filter, setFilter] = useState<'all' | 'check' | 'action'>('all');
  const objects = Object.values(project.objects);
  const w = state.world;
  const change = (world: typeof w, what: string) => props.onState(setWorldByHand(project, state, world, what));
  const items = objects.filter((o) => o.type === 'inventory');
  const flags = objects.filter((o) => o.type === 'state');
  const things = objects.filter((o) => o.type === 'object' && statesOf(o).length > 0);
  const puzzles = objects.filter((o) => o.type === 'puzzle');
  const levelItems = set.items.filter((i) => i.levelId === props.levelId);
  const doors = levelItems.filter((i) => assetOf(set, i).role === 'door');
  const notes = (set.notes ?? []).filter((n) => n.levelId === props.levelId && !n.resolved);
  const log = [...state.log].reverse().filter((l) => filter === 'all' || (filter === 'check' ? l.kind === 'check' : l.kind === 'action' || l.kind === 'effect'));

  return (
    <div className="play-inspect" role="dialog" aria-label="Paused">
      <header>
        <span className="play-kicker">PAUSED · {state.time.toFixed(1)}s</span>
        <div className="lvl-btnrow">
          <button className="tb-btn primary small" onClick={props.onResume} autoFocus>
            Resume
          </button>
          <button className="tb-btn small" onClick={props.onRestart}>
            Start again
          </button>
          <button className="tb-btn small" onClick={props.onExit}>
            Stop playing
          </button>
        </div>
      </header>
      <div className="lvl-tabs" role="tablist">
        {(
          [
            ['state', 'State'],
            ...(hasGear ? ([['gear', 'Gear']] as const) : []),
            ['log', `Event log (${state.log.length})`],
            ['notes', `Notes${notes.length ? ` (${notes.length})` : ''}`],
            ['controls', 'Controls'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="play-inspect-body">
        {tab === 'state' && (
          <>
            <section>
              <h3>Carrying</h3>
              {items.length === 0 && <p className="muted">The story has no inventory items.</p>}
              {items.map((o) => (
                <div key={o.id} className="play-row">
                  <span>{o.name}</span>
                  <span className="mono">{w.items[o.id] ?? 0}</span>
                  <button className="icon-btn small" aria-label={`Take ${o.name}`} disabled={!(w.items[o.id] ?? 0)} onClick={() => change({ ...w, items: { ...w.items, [o.id]: Math.max(0, (w.items[o.id] ?? 0) - 1) } }, `take ${o.name}`)}>
                    −
                  </button>
                  <button className="icon-btn small" aria-label={`Give ${o.name}`} onClick={() => change({ ...w, items: { ...w.items, [o.id]: (w.items[o.id] ?? 0) + 1 } }, `give ${o.name}`)}>
                    +
                  </button>
                </div>
              ))}
            </section>
            <section>
              <h3>States</h3>
              {[...flags, ...things].map((o) => {
                const value = o.type === 'state' ? w.flags[o.id] : w.objects[o.id];
                return (
                  <label key={o.id} className="play-row">
                    <span>{o.name}</span>
                    <select
                      className="inp small"
                      aria-label={o.name}
                      value={value ?? ''}
                      onChange={(e) =>
                        change(o.type === 'state' ? { ...w, flags: { ...w.flags, [o.id]: e.target.value } } : { ...w, objects: { ...w.objects, [o.id]: e.target.value } }, `${o.name} → ${e.target.value}`)
                      }
                    >
                      <option value="">—</option>
                      {statesOf(o).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              {puzzles.map((o) => (
                <label key={o.id} className="play-row">
                  <span>{o.name} (puzzle)</span>
                  <input type="checkbox" checked={!!w.solved[o.id]} aria-label={`${o.name} solved`} onChange={(e) => change({ ...w, solved: { ...w.solved, [o.id]: e.target.checked } }, `${o.name} ${e.target.checked ? 'solved' : 'unsolved'}`)} />
                </label>
              ))}
              <div className="play-row">
                <span>Scenes seen</span>
                <span className="muted">{Object.keys(w.visited).filter((id) => w.visited[id]).map((id) => project.objects[id]?.name).filter(Boolean).join(', ') || 'none yet'}</span>
              </div>
            </section>
            <section>
              <h3>The level</h3>
              <div className="play-row"><span>Objective</span><span>{state.objective ?? '—'}</span></div>
              <div className="play-row"><span>Health</span><span className="mono">{Math.round(state.health)}</span></div>
              <div className="play-row"><span>Checkpoint</span><span>{state.checkpoint ? `${state.checkpoint.x.toFixed(1)}, ${state.checkpoint.y.toFixed(1)}` : '—'}</span></div>
              <div className="play-row"><span>Standing in</span><span>{state.inside.map((id) => levelItems.find((i) => i.id === id)?.name).join(', ') || '—'}</span></div>
              {doors.map((d) => (
                <label key={d.id} className="play-row">
                  <span>{d.name}</span>
                  <span className="lvl-btnrow">
                    {isOpen(project, state, d) ? 'open' : 'closed'}
                    <input type="checkbox" aria-label={`${d.name} open`} checked={isOpen(project, state, d)} onChange={(e) => props.onState({ ...state, open: { ...state.open, [d.id]: e.target.checked } })} />
                  </span>
                </label>
              ))}
              <div className="play-row"><span>Spawned</span><span>{state.spawned.map((s) => s.name).join(', ') || '—'}</span></div>
            </section>
            <section>
              <h3>Test presets</h3>
              <p className="muted">Save the story state above to start Play Mode from it again (the list beside ▶ Play).</p>
              <form
                className="lvl-btnrow"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = presetName.trim() || `State at ${state.time.toFixed(0)}s`;
                  props.onCommit(savePreset(project, presetFrom(w, name)));
                  setPresetName('');
                }}
              >
                <input className="inp small" aria-label="Preset name" placeholder="e.g. Has the key" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
                <button className="tb-btn small" type="submit">
                  Save preset
                </button>
              </form>
              {(set.presets ?? []).map((p) => (
                <div key={p.id} className="play-row">
                  <span>{p.name}</span>
                  <button className="icon-btn small" aria-label={`Remove preset ${p.name}`} onClick={() => props.onCommit(removePreset(project, p.id))}>
                    ×
                  </button>
                </div>
              ))}
            </section>
          </>
        )}
        {tab === 'gear' && (
          <div className="play-gear" aria-label="Gear">
            <p className="muted">Equip, use, learn and craft here, as the player would; the level's rules see it at once.</p>
            <GearSection project={project} world={w} onGear={(id, act) => props.onState(gearDo(project, state, act, id))} />
            <SkillsSection project={project} world={w} onLearn={(id) => props.onState(gearDo(project, state, 'learn', id))} />
            <CraftSection project={project} world={w} onCraft={(id) => props.onState(gearDo(project, state, 'craft', id))} />
          </div>
        )}
        {tab === 'log' && (
          <>
            <div className="view-toggle" role="group" aria-label="Show">
              {(['all', 'check', 'action'] as const).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'Everything' : f === 'check' ? 'Conditions' : 'What fired'}
                </button>
              ))}
            </div>
            <ol className="play-log">
              {log.map((l, n) => (
                <li key={n} className={`play-log-line ${l.kind}${l.pass === false ? ' fail' : l.pass ? ' pass' : ''}`}>
                  <span className="mono">{l.t.toFixed(1)}s</span>
                  {l.kind === 'check' && <span className="play-pass">{l.pass ? '✓' : '✗'}</span>}
                  <span>{l.text}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {tab === 'notes' && (
          <>
            <form
              className="play-note"
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                props.onCommit(addNote(project, { levelId: props.levelId, itemId: about || undefined, text: note.trim(), x: props.at.x, y: props.at.y }).project);
                setNote('');
              }}
            >
              <label className="lvl-field wide">
                <span className="lvl-flabel">What’s wrong</span>
                <textarea className="inp" rows={3} aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="The lever is too far from the door to see both." />
              </label>
              <label className="lvl-field wide">
                <span className="lvl-flabel">About</span>
                <select className="inp small" aria-label="About" value={about} onChange={(e) => setAbout(e.target.value)}>
                  <option value="">The level as a whole</option>
                  {levelItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.id === props.nearest ? ' (nearest)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button className="tb-btn small primary" type="submit" disabled={!note.trim()}>
                Save the note
              </button>
              <p className="muted">Notes appear in the preflight and on the item’s inspector until marked resolved.</p>
            </form>
            {notes.map((n) => (
              <div key={n.id} className="play-row">
                <span>
                  <b>{levelItems.find((i) => i.id === n.itemId)?.name ?? 'Level'}</b> {n.text}
                </span>
                <button className="tb-btn small" onClick={() => props.onCommit(resolveNote(project, n.id))}>
                  Resolve
                </button>
              </div>
            ))}
          </>
        )}
        {tab === 'controls' && <PlayControls />}
      </div>
    </div>
  );
};
