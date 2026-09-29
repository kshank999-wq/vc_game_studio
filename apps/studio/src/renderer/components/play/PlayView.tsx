import { useEffect, useMemo, useRef, useState } from 'react';
import type { Destination } from '../../model/details';
import { statesOf } from '../../model/details';
import { advance, choose, codexOf, codexProgress, codexSections, type CodexSection, endFreePlay, interact, playToDecision, promptOf, setWorld, startPlay, type Entry, type Play, type PlayWorld, type Voice } from '../../model/play';
import type { ObjectType, Project } from '../../model/types';
import { Symbol } from '../Symbol';
import { Inline } from '../Inline';

interface Props {
  project: Project;
  /** Start here (a node on the graph) instead of at the Beginning. */
  from?: string;
  onNavigate: (to: Destination) => void;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

const VoiceView = ({ voice }: { voice: Voice }) => (
  <div className="play-line">
    <div className="play-speaker">{voice.speaker?.toUpperCase() ?? 'NO SPEAKER'}</div>
    {voice.direction && <div className="play-direction">({voice.direction})</div>}
    <div className="play-said">{voice.text ? <Inline text={voice.text} /> : '…'}</div>
  </div>
);

const EntryView = ({ entry }: { entry: Entry }) => {
  switch (entry.kind) {
    case 'heading':
      return (
        <div className="play-heading">
          <div className="play-slug">{entry.text}</div>
          {entry.sub && <div className="play-sub">{entry.sub}</div>}
        </div>
      );
    case 'line':
      // Dual dialogue: both voices at once, side by side as the script sets them.
      return entry.with ? (
        <div className="play-dual" role="group" aria-label="Spoken at the same time">
          <VoiceView voice={entry} />
          <VoiceView voice={entry.with} />
        </div>
      ) : (
        <VoiceView voice={entry} />
      );
    case 'action':
      return (
        <div className="play-action">
          {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'cinematic':
      return (
        <div className="play-cinematic">
          <div>
            <Symbol type="cinematic" size={12} /> {entry.text}
            {entry.detail && <span className="play-note"> · {entry.detail}</span>}
            {entry.skippable === false && <span className="play-note"> · can’t be skipped</span>}
          </div>
          {entry.shots && (
            <ol className="play-shots">
              {entry.shots.map((s) => (
                <li key={s}>{s.replace(/^\d+\. /, '')}</li>
              ))}
            </ol>
          )}
        </div>
      );
    case 'picked':
      return <div className="play-picked">▸ {entry.text}</div>;
    case 'did':
      return <div className="play-picked">▸ {entry.text}</div>;
    case 'effect':
      return <div className="play-effect">{entry.text}</div>;
    case 'fired':
      return <div className="play-fired">⚡ {entry.text}</div>;
    case 'skip':
      return (
        <div className="play-skip" title={`Needs: ${entry.needs}`}>
          Skipped {entry.text} <span className="play-note">— needs {entry.needs}</span>
        </div>
      );
    case 'quest':
      return (
        <div className={`play-quest ${entry.state}`}>
          <Symbol type="quest" size={12} /> {entry.state === 'done' ? 'Quest complete' : 'New quest'}: {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'encounter':
      return (
        <div className="play-encounter">
          <Symbol type="encounter" size={12} /> {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
        </div>
      );
    case 'lore':
      return (
        <div className="play-lore">
          <Symbol type="lore" size={12} /> Discovered: {entry.text}
        </div>
      );
    case 'mechanic':
      return (
        <div className="play-mechanic">
          <Symbol type="mechanic" size={12} /> Now available: {entry.text}
        </div>
      );
    case 'end':
      return <div className="play-end">{entry.text}</div>;
  }
};

/** The codex as the player would read it: the quest log, the characters met, the locations visited, the items found, the objects used, the mechanics, the encounters met, then the lore found. */
const CodexPanel = ({ project, world, onClose }: { project: Project; world: PlayWorld; onClose: () => void }) => {
  const c = codexOf(project, world);
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  // With a search: the entries it finds, by section (the same rule as the engines' codex).
  const found = query.trim() ? new Map(codexSections(project, world, query).map((s) => [s.key, new Set(s.entries.map((e) => e.id))])) : null;
  const has = (key: CodexSection['key']) => !found || found.has(key);
  const keep = (key: CodexSection['key']) => (x: { id: string }) => !found || !!found.get(key)?.has(x.id);
  useEffect(() => {
    // "/" goes to the search box, as in the engines' codex screens.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="play-codex" role="dialog" aria-label="Codex">
      <div className="play-codex-head">
        <span className="rule-label">Codex</span>
        <span className="pref-hint">What the player has found, as a codex screen shows it.</span>
        <div className="grow" />
        <button className="tb-btn small" onClick={onClose}>
          Close <kbd>C</kbd>
        </button>
      </div>
      <input
        ref={search}
        className="play-codex-search"
        type="search"
        aria-label="Search the codex"
        placeholder="Search the codex  ( / )"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Escape clears the search, then leaves the box (so C and Escape work again).
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (query) setQuery('');
            else e.currentTarget.blur();
          }
        }}
      />
      {found && !found.size && <p className="play-note">Nothing matches “{query.trim()}”.</p>}
      {c.quests > 0 && has('quests') && (
        <section aria-label="Quests">
          <h3>
            Quests <span className="play-note">· {c.underWay.length} under way, {c.done.length} done</span>
          </h3>
          {!c.underWay.length && !c.done.length && <p className="play-note">None yet.</p>}
          <ul className="play-codex-quests">
            {c.underWay.filter(keep('quests')).map((q) => (
              <li key={q.id}>
                <Symbol type="quest" size={11} /> <strong>{q.name}</strong>
                {q.goal && <span className="play-note"> — {q.goal}</span>}
              </li>
            ))}
            {c.done.filter(keep('quests')).map((q) => (
              <li key={q.id} className="done">
                <Symbol type="quest" size={11} /> {q.name} <span className="play-note">(done)</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {c.charactersTotal > 0 && has('characters') && (
        <section aria-label="Characters">
          <h3>
            Characters <span className="play-note">· {c.characters.length} of {c.charactersTotal} met</span>
          </h3>
          {!c.characters.length && <p className="play-note">None yet.</p>}
          {c.characters.filter(keep('characters')).map((ch) => (
            <article key={ch.id} className="play-codex-lore play-codex-character">
              <h4>
                <Symbol type="character" size={11} /> {ch.name}
              </h4>
              <p>{ch.text}</p>
            </article>
          ))}
        </section>
      )}
      {c.locationsTotal > 0 && has('locations') && (
        <section aria-label="Locations">
          <h3>
            Locations <span className="play-note">· {c.locations.length} of {c.locationsTotal} visited</span>
          </h3>
          {!c.locations.length && <p className="play-note">None yet.</p>}
          {c.locations.filter(keep('locations')).map((l) => (
            <article key={l.id} className="play-codex-lore play-codex-location">
              <h4>
                <Symbol type="environment" size={11} /> {l.name}
              </h4>
              <p>{l.text}</p>
            </article>
          ))}
        </section>
      )}
      {c.itemsTotal > 0 && has('items') && (
        <section aria-label="Items">
          <h3>
            Items <span className="play-note">· {c.items.length} of {c.itemsTotal} found</span>
          </h3>
          {!c.items.length && <p className="play-note">None yet.</p>}
          {c.items.filter(keep('items')).map((i) => (
            <article key={i.id} className="play-codex-lore play-codex-item">
              <h4>
                <Symbol type="inventory" size={11} /> {i.name}
                {i.carried > 0 && <span className="play-note"> (carried{i.carried > 1 ? ` ×${i.carried}` : ''})</span>}
              </h4>
              <p>{i.text}</p>
            </article>
          ))}
        </section>
      )}
      {c.objectsTotal > 0 && has('objects') && (
        <section aria-label="Objects">
          <h3>
            Objects <span className="play-note">· {c.objects.length} of {c.objectsTotal} used</span>
          </h3>
          {!c.objects.length && <p className="play-note">None yet.</p>}
          {c.objects.filter(keep('objects')).map((o) => (
            <article key={o.id} className="play-codex-lore play-codex-object">
              <h4>
                <Symbol type="object" size={11} /> {o.name}
                {o.state && <span className="play-note"> ({o.state})</span>}
              </h4>
              <p>{o.text}</p>
            </article>
          ))}
        </section>
      )}
      {c.mechanicsTotal > 0 && has('mechanics') && (
        <section aria-label="Mechanics">
          <h3>
            Mechanics <span className="play-note">· {c.mechanics.length} of {c.mechanicsTotal} available</span>
          </h3>
          {!c.mechanics.length && <p className="play-note">None yet.</p>}
          {c.mechanics.filter(keep('mechanics')).map((m) => (
            <article key={m.id} className="play-codex-lore play-codex-mechanic">
              <h4>
                <Symbol type="mechanic" size={11} /> {m.name}
                {m.controls && <span className="play-note"> · {m.controls}</span>}
              </h4>
              <p>{m.text}</p>
            </article>
          ))}
        </section>
      )}
      {c.encountersTotal > 0 && has('encounters') && (
        <section aria-label="Encounters">
          <h3>
            Encounters <span className="play-note">· {c.encounters.length} met, {c.encounters.filter((e) => e.won).length} won</span>
          </h3>
          {!c.encounters.length && <p className="play-note">None yet.</p>}
          {c.encounters.filter(keep('encounters')).map((e) => (
            <article key={e.id} className="play-codex-lore play-codex-encounter">
              <h4>
                <Symbol type="encounter" size={11} /> {e.name}
                {e.won && <span className="play-note"> (won)</span>}
              </h4>
              {(e.enemies || e.weakness) && (
                <p className="play-note">{[e.enemies, e.weakness && `weak to ${e.weakness.toLowerCase()}`].filter(Boolean).join(' · ')}</p>
              )}
              <p>{e.text}</p>
            </article>
          ))}
        </section>
      )}
      {c.loreTotal > 0 && has('lore') && (
        <section aria-label="Lore">
          <h3>
            Lore <span className="play-note">· {c.lore.length} of {c.loreTotal} found</span>
          </h3>
          {!c.lore.length && <p className="play-note">Nothing found yet.</p>}
          {c.lore.filter(keep('lore')).map((l) => (
            <article key={l.id} className="play-codex-lore">
              <h4>
                <Symbol type="lore" size={11} /> {l.name}
              </h4>
              <p>{l.text}</p>
            </article>
          ))}
        </section>
      )}
    </div>
  );
};

/** The world, which the designer can change by hand to try another path. */
const WorldPanel = ({ project, world, onChange }: { project: Project; world: PlayWorld; onChange: (change: (w: PlayWorld) => PlayWorld) => void }) => {
  const of = (type: ObjectType) =>
    Object.values(project.objects)
      .filter((o) => o.type === type)
      .sort((a, b) => a.name.localeCompare(b.name));
  const states = of('state');
  const items = of('inventory');
  const objects = of('object').filter((o) => statesOf(o).length);
  const characters = of('character');
  const quests = of('quest');
  const known = (type: 'lore' | 'mechanic') => of(type);
  const toggles = (type: 'lore' | 'mechanic', title: string, label: string) => {
    const list = known(type);
    const key = type === 'lore' ? 'lore' : 'mechanics';
    return list.length > 0 ? (
      <section>
        <h3>{title}</h3>
        {list.map((o) => (
          <label key={o.id} className="play-row">
            <span>{o.name}</span>
            <input
              type="checkbox"
              className="pref-switch"
              aria-label={`${label} ${o.name}`}
              checked={!!world[key][o.id]}
              onChange={(e) => {
                const on = e.currentTarget.checked;
                onChange((w) => {
                  const next = { ...w[key] };
                  if (on) next[o.id] = true;
                  else delete next[o.id];
                  return { ...w, [key]: next };
                });
              }}
            />
          </label>
        ))}
      </section>
    ) : null;
  };
  const chosen = Object.entries(world.chosen).filter(([id]) => project.objects[id]);
  const named = (record: Record<string, boolean>) => Object.keys(record).filter((id) => record[id] && project.objects[id]).map((id) => project.objects[id]!.name);
  return (
    <aside className="play-world" aria-label="The world">
      <div className="play-world-head">
        <span className="rule-label">The world</span>
        <span className="pref-hint">Change anything to try another path.</span>
      </div>
      {states.length > 0 && (
        <section>
          <h3>States</h3>
          {states.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <select className="inp" value={world.flags[o.id] ?? ''} onChange={(e) => onChange((w) => ({ ...w, flags: { ...w.flags, [o.id]: e.currentTarget.value } }))}>
                {statesOf(o).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}
      {items.length > 0 && (
        <section>
          <h3>Carried</h3>
          {items.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <input
                type="checkbox"
                className="pref-switch"
                checked={(world.items[o.id] ?? 0) > 0}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  onChange((w) => ({ ...w, items: { ...w.items, [o.id]: on ? Math.max(1, w.items[o.id] ?? 0) : 0 } }));
                }}
              />
            </label>
          ))}
        </section>
      )}
      {objects.length > 0 && (
        <section>
          <h3>Objects</h3>
          {objects.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <select className="inp" value={world.objects[o.id] ?? ''} onChange={(e) => onChange((w) => ({ ...w, objects: { ...w.objects, [o.id]: e.currentTarget.value } }))}>
                {statesOf(o).map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </section>
      )}
      {characters.length > 0 && (
        <section>
          <h3>Arcs</h3>
          {characters.map((o) => (
            <div key={o.id} className="play-row">
              <span>{o.name}</span>
              <span className="play-arc">
                <button className="icon-btn small" aria-label={`${o.name} −1`} onClick={() => onChange((w) => ({ ...w, arcs: { ...w.arcs, [o.id]: (w.arcs[o.id] ?? 0) - 1 } }))}>
                  −
                </button>
                <span className="mono">{world.arcs[o.id] ?? 0}</span>
                <button className="icon-btn small" aria-label={`${o.name} +1`} onClick={() => onChange((w) => ({ ...w, arcs: { ...w.arcs, [o.id]: (w.arcs[o.id] ?? 0) + 1 } }))}>
                  +
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
      {quests.length > 0 && (
        <section>
          <h3>Quests</h3>
          {quests.map((o) => (
            <label key={o.id} className="play-row">
              <span>{o.name}</span>
              <select
                className="inp"
                aria-label={`Quest ${o.name}`}
                value={world.quests[o.id] ?? ''}
                onChange={(e) => {
                  const state = e.currentTarget.value;
                  onChange((w) => {
                    const next = { ...w.quests };
                    if (state === 'active' || state === 'done') next[o.id] = state;
                    else delete next[o.id];
                    return { ...w, quests: next };
                  });
                }}
              >
                <option value="">Not started</option>
                <option value="active">Under way</option>
                <option value="done">Done</option>
              </select>
            </label>
          ))}
        </section>
      )}
      {toggles('mechanic', 'Mechanics', 'Available:')}
      {toggles('lore', 'Lore', 'Discovered:')}
      <section>
        <h3>So far</h3>
        <dl className="play-facts">
          <dt>Choices</dt>
          <dd>{chosen.length ? chosen.map(([id, label]) => `${project.objects[id]!.name}: ${label}`).join(' · ') : 'none yet'}</dd>
          <dt>Solved</dt>
          <dd>{named(world.solved).join(' · ') || 'nothing yet'}</dd>
          <dt>Won</dt>
          <dd>{named(world.won).join(' · ') || 'no encounters yet'}</dd>
          <dt>Fired</dt>
          <dd>{named(world.fired).join(' · ') || 'nothing yet'}</dd>
          <dt>Visited</dt>
          <dd>{named(world.visited).join(' · ') || 'nowhere yet'}</dd>
        </dl>
      </section>
    </aside>
  );
};

/**
 * Play the story through, as the engine will: lines and actions in order,
 * choices with their options (those not on offer say what they need), free
 * play with the scene's objects to use, and the ending it reaches.
 */
export const PlayView = ({ project, from, onNavigate }: Props) => {
  const [history, setHistory] = useState<Play[]>(() => [startPlay(project, from)]);
  const play = history[history.length - 1]!;
  const prompt = useMemo(() => promptOf(project, play), [project, play]);
  const push = (next: Play) => next !== play && setHistory((h) => [...h, next]);
  const transcript = useRef<HTMLDivElement>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  // What the codex had when last read, for its "new" count.
  const [seen, setSeen] = useState(0);
  const progress = codexProgress(project, play.world);
  const book = codexOf(project, play.world);
  const hasCodex = book.quests + book.charactersTotal + book.locationsTotal + book.itemsTotal + book.objectsTotal + book.mechanicsTotal + book.encountersTotal + book.loreTotal > 0;
  const fresh = Math.max(0, progress - seen);
  useEffect(() => {
    // Read while open; after a step back there is less to have read.
    if (codexOpen || progress < seen) setSeen(progress);
  }, [codexOpen, progress, seen]);
  const restart = () => {
    setHistory([startPlay(project, from)]);
    setSeen(0);
  };

  useEffect(() => {
    const el = transcript.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
  }, [play.log.length, prompt.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (hasCodex && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        setCodexOpen((o) => !o);
        return;
      }
      if (codexOpen) {
        if (e.key === 'Escape') setCodexOpen(false);
        return;
      }
      if ((e.key === 'Enter' || e.key === ' ') && prompt.kind === 'continue') {
        e.preventDefault();
        push(advance(project, play));
      } else if (prompt.kind === 'choice' && /^[1-9]$/.test(e.key)) {
        const i = Number(e.key) - 1;
        if (prompt.options[i]?.available) push(choose(project, play, i));
      } else if (e.key === 'Backspace' && history.length > 1) {
        e.preventDefault();
        setHistory((h) => h.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const here = play.where.sceneId ?? play.where.nodeId;
  const hereName = here ? `${project.objects[here]?.data.code ?? ''} ${project.objects[here]?.name ?? ''}`.trim() : '';

  return (
    <div className="play-view">
      <section className="play-stage">
        <div className="play-bar">
          <span className="rule-label">Play-through</span>
          <span className="play-where">{hereName && `Now in ${hereName}`}</span>
          <div className="grow" />
          <button className="tb-btn small" disabled={history.length < 2} title="Step back (Backspace)" onClick={() => setHistory((h) => h.slice(0, -1))}>
            ↶ Step back
          </button>
          <button className="tb-btn small" disabled={prompt.kind !== 'continue'} onClick={() => push(playToDecision(project, play))}>
            ⏭ To the next decision
          </button>
          <button className="tb-btn small" onClick={restart}>
            ⟲ Restart
          </button>
          {hasCodex && (
            <button className={`tb-btn small${codexOpen ? ' on' : ''}`} aria-pressed={codexOpen} title="The codex: quests and lore found (C)" onClick={() => setCodexOpen(!codexOpen)}>
              Codex{fresh > 0 && <span className="play-codex-new"> · {fresh} new</span>}
            </button>
          )}
          {here && (
            <button
              className="tb-btn small"
              onClick={() => (play.where.sceneId ? onNavigate({ kind: 'scene', sceneId: play.where.sceneId, mode: 'timeline' }) : onNavigate({ kind: 'graph', id: here }))}
            >
              Show in the studio
            </button>
          )}
        </div>
        {codexOpen && <CodexPanel project={project} world={play.world} onClose={() => setCodexOpen(false)} />}
        <div className="play-transcript" ref={transcript} aria-live="polite">
          {play.log.map((entry, i) => (
            <EntryView key={i} entry={entry} />
          ))}
        </div>
        <div className="play-prompt">
          {prompt.kind === 'continue' && (
            <button className="tb-btn primary play-continue" autoFocus onClick={() => push(advance(project, play))}>
              Continue <kbd>↵</kbd>
            </button>
          )}
          {prompt.kind === 'choice' && (
            <div className="play-choice">
              <div className="play-choice-title">
                <Symbol type={prompt.symbol ?? 'choice'} size={12} /> {prompt.prompt || prompt.title}
              </div>
              {prompt.options.map((o, i) => (
                <button key={i} className="play-option" disabled={!o.available} title={o.needs ? `Needs: ${o.needs}` : undefined} onClick={() => push(choose(project, play, i))}>
                  <kbd>{i + 1}</kbd>
                  <span>{o.label}</span>
                  {o.needs && <span className="play-needs">needs {o.needs}</span>}
                </button>
              ))}
            </div>
          )}
          {prompt.kind === 'freePlay' && (
            <div className="play-free">
              <div className="play-choice-title">
                {prompt.title} <span className="play-note">· free play, ends {prompt.endsByRule ? `when ${prompt.ends}` : prompt.ends}</span>
              </div>
              <div className="play-objects">
                {prompt.objects.length === 0 && <span className="play-note">Nothing in this scene can be used.</span>}
                {prompt.objects.map((o) => (
                  <div key={o.id} className="play-object">
                    <div className="play-object-name">
                      <Symbol type="object" size={11} /> {o.name}
                      {o.state && <span className="play-note"> · {o.state}</span>}
                    </div>
                    {o.verbs.map((v) => (
                      <button key={v.id} className="tb-btn small" disabled={!v.available} title={v.available ? v.does : `Needs: ${v.needs}`} onClick={() => push(interact(project, play, o.id, v.id))}>
                        {v.verb}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <button className="tb-btn small" onClick={() => push(endFreePlay(project, play))}>
                {prompt.endsByRule ? 'Skip ahead' : 'Move on'}
              </button>
            </div>
          )}
          {prompt.kind === 'end' && (
            <div className={`play-over play-${prompt.outcome}`}>
              <span>{prompt.outcome === 'ending' ? 'The end' : prompt.outcome === 'gameOver' ? 'Game over' : 'Stopped'}</span>
              <span className="play-note">{prompt.text}</span>
              <button className="tb-btn primary" onClick={restart}>
                Play again
              </button>
            </div>
          )}
        </div>
      </section>
      <WorldPanel project={project} world={play.world} onChange={(change) => push(setWorld(project, play, change))} />
    </div>
  );
};
