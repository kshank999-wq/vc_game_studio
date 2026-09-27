import { useEffect, useMemo, useRef, useState } from 'react';
import type { Destination } from '../../model/details';
import { statesOf } from '../../model/details';
import { advance, choose, endFreePlay, interact, playToDecision, promptOf, setWorld, startPlay, type Entry, type Play, type PlayWorld } from '../../model/play';
import type { ObjectType, Project } from '../../model/types';
import { Symbol } from '../Symbol';

interface Props {
  project: Project;
  /** Start here (a node on the graph) instead of at the Beginning. */
  from?: string;
  onNavigate: (to: Destination) => void;
}

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

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
      return (
        <div className="play-line">
          <div className="play-speaker">{entry.speaker?.toUpperCase() ?? 'NO SPEAKER'}</div>
          {entry.direction && <div className="play-direction">({entry.direction})</div>}
          <div className="play-said">{entry.text || '…'}</div>
        </div>
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
          <Symbol type="cinematic" size={12} /> {entry.text}
          {entry.detail && <span className="play-note"> · {entry.detail}</span>}
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
    case 'end':
      return <div className="play-end">{entry.text}</div>;
  }
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
      <section>
        <h3>So far</h3>
        <dl className="play-facts">
          <dt>Choices</dt>
          <dd>{chosen.length ? chosen.map(([id, label]) => `${project.objects[id]!.name}: ${label}`).join(' · ') : 'none yet'}</dd>
          <dt>Solved</dt>
          <dd>{named(world.solved).join(' · ') || 'nothing yet'}</dd>
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
  const restart = () => setHistory([startPlay(project, from)]);

  useEffect(() => {
    const el = transcript.current;
    el?.scrollTo?.({ top: el.scrollHeight, behavior: 'smooth' });
  }, [play.log.length, prompt.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
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
          {here && (
            <button
              className="tb-btn small"
              onClick={() => (play.where.sceneId ? onNavigate({ kind: 'scene', sceneId: play.where.sceneId, mode: 'timeline' }) : onNavigate({ kind: 'graph', id: here }))}
            >
              Show in the studio
            </button>
          )}
        </div>
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
                <Symbol type="choice" size={12} /> {prompt.prompt || prompt.title}
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
