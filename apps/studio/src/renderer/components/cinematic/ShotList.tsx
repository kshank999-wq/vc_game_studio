import { useState } from 'react';
import type { Destination } from '../../model/details';
import { addShot, duplicateShot, FRAMINGS, linesFor, MOVES, moveShot, removeShot, runningTime, shotsOf, TRANSITIONS, updateShot, type Framing, type Shot } from '../../model/shots';
import type { Project } from '../../model/types';
import { ElementDetail } from '../detail/ElementDetail';
import { Symbol } from '../Symbol';

interface Props {
  project: Project;
  id: string;
  onCommit: (project: Project) => void;
  onNavigate: (to: Destination) => void;
  onOpenBible?: (id: string) => void;
  onOpenCode?: (id: string) => void;
}

/** A thumbnail of the framing: how big the subject sits in a 16:9 frame. */
export const FramingArt = ({ framing, size = 1 }: { framing: Framing; size?: number }) => {
  const W = 160;
  const H = 90;
  const figure = (cx: number, base: number, h: number, key: string | number = 0) => (
    <g key={key}>
      <circle cx={cx} cy={base - h * 0.82} r={h * 0.14} />
      <path d={`M${cx - h * 0.26} ${base} Q${cx - h * 0.24} ${base - h * 0.6} ${cx} ${base - h * 0.64} Q${cx + h * 0.24} ${base - h * 0.6} ${cx + h * 0.26} ${base} Z`} />
    </g>
  );
  let art: React.ReactNode;
  switch (framing) {
    case 'Extreme wide':
      art = (
        <>
          <path className="art-ground" d={`M0 ${H * 0.72} L${W} ${H * 0.66}`} />
          {figure(W * 0.5, H * 0.7, 12)}
        </>
      );
      break;
    case 'Wide':
      art = (
        <>
          <path className="art-ground" d={`M0 ${H * 0.86} L${W} ${H * 0.82}`} />
          {figure(W * 0.5, H * 0.86, 40)}
        </>
      );
      break;
    case 'Medium':
      art = figure(W * 0.5, H + 20, 110);
      break;
    case 'Medium close-up':
      art = figure(W * 0.5, H + 60, 170);
      break;
    case 'Close-up':
      art = <circle cx={W * 0.5} cy={H * 0.52} r={H * 0.4} />;
      break;
    case 'Extreme close-up':
      art = (
        <>
          <ellipse cx={W * 0.34} cy={H * 0.5} rx={22} ry={11} />
          <ellipse cx={W * 0.66} cy={H * 0.5} rx={22} ry={11} />
        </>
      );
      break;
    case 'Over the shoulder':
      art = (
        <>
          {figure(W * 0.68, H + 10, 80)}
          <g className="art-near">{figure(W * 0.16, H + 70, 190)}</g>
        </>
      );
      break;
    case 'Two-shot':
      art = [figure(W * 0.34, H + 16, 100, 'a'), figure(W * 0.66, H + 16, 100, 'b')];
      break;
    case 'POV':
      art = (
        <>
          {figure(W * 0.5, H * 0.9, 50)}
          <path className="art-vignette" d={`M0 0H${W}V${H}H0Z M${W / 2} ${H * 0.08} a${W * 0.46} ${H * 0.44} 0 1 0 0.1 0Z`} fillRule="evenodd" />
        </>
      );
      break;
    case 'Insert':
      art = <rect x={W * 0.3} y={H * 0.3} width={W * 0.4} height={H * 0.4} rx={4} />;
      break;
    case 'Aerial':
      art = (
        <>
          <path className="art-ground" d={`M0 ${H * 0.3}H${W}M0 ${H * 0.6}H${W}M${W * 0.33} 0V${H}M${W * 0.66} 0V${H}`} />
          <circle cx={W * 0.5} cy={H * 0.45} r={5} />
        </>
      );
      break;
  }
  return (
    <svg className="framing-art" viewBox={`0 0 ${W} ${H}`} width={W * size} height={H * size} aria-hidden="true">
      <rect className="art-frame" x={0} y={0} width={W} height={H} />
      <g className="art-subject">{art}</g>
    </svg>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="dfld">
    <span>{label}</span>
    {children}
  </label>
);

const TextInput = ({ value, onSave, placeholder, multiline = false }: { value: string; onSave: (v: string) => void; placeholder?: string; multiline?: boolean }) =>
  multiline ? (
    <textarea key={value} className="inp" rows={3} defaultValue={value} placeholder={placeholder} onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)} />
  ) : (
    <input
      key={value}
      className="inp"
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );

const ShotInspector = ({ project, id, shot, index, onCommit }: { project: Project; id: string; shot: Shot; index: number; onCommit: (p: Project) => void }) => {
  const set = (patch: Partial<Shot>) => onCommit(updateShot(project, id, shot.id, patch));
  const characters = Object.values(project.objects)
    .filter((o) => o.type === 'character')
    .sort((a, b) => a.name.localeCompare(b.name));
  const lines = linesFor(project, id);
  return (
    <aside className="detail detail-panel shot-inspector" aria-label={`Shot ${index + 1}`}>
      <div className="detail-head">
        <span className="detail-symbol">
          <Symbol type="cinematic" size={14} />
        </span>
        <div className="detail-names">
          <span className="detail-name static">Shot {index + 1}</span>
          <span className="detail-kind">
            {shot.framing} · {shot.seconds}s
          </span>
        </div>
      </div>
      <section className="detail-section">
        <div className="shot-pair">
          <Field label="Framing">
            <select className="inp" value={shot.framing} onChange={(e) => set({ framing: e.currentTarget.value as Shot['framing'] })}>
              {FRAMINGS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </Field>
          <Field label="Camera move">
            <select className="inp" value={shot.move} onChange={(e) => set({ move: e.currentTarget.value as Shot['move'] })}>
              {MOVES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="shot-pair">
          <Field label="Lens / field of view">
            <TextInput value={shot.lens} placeholder="35mm" onSave={(lens) => set({ lens })} />
          </Field>
          <Field label="Holds for (seconds)">
            <input
              key={shot.seconds}
              className="inp"
              type="number"
              min={0}
              step={0.5}
              defaultValue={shot.seconds}
              onBlur={(e) => set({ seconds: Math.max(0, Number(e.currentTarget.value) || 0) })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </Field>
        </div>
        <Field label="What we see">
          <TextInput multiline value={shot.action} placeholder="The seam weeps; water beads on the bronze" onSave={(action) => set({ action })} />
        </Field>
        <div className="dfld">
          <span>In frame</span>
          <div className="tag-list">
            {characters.length === 0 && <span className="detail-text muted">No characters yet.</span>}
            {characters.map((c) => {
              const on = shot.characters.includes(c.id);
              return (
                <button
                  key={c.id}
                  className={`tag${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => set({ characters: on ? shot.characters.filter((x) => x !== c.id) : [...shot.characters, c.id] })}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
        <Field label="Line spoken over it">
          <select className="inp" value={shot.lineId ?? ''} onChange={(e) => set({ lineId: e.currentTarget.value || undefined })}>
            <option value="">None</option>
            {shot.lineId && !lines.some((l) => l.id === shot.lineId) && <option value={shot.lineId}>(a line no longer in its scenes)</option>}
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {(l.speakerId ? project.objects[l.speakerId]?.name.toUpperCase() : 'NO SPEAKER') ?? '?'}: {l.text.slice(0, 60)}
              </option>
            ))}
          </select>
        </Field>
        <div className="shot-pair">
          <Field label="Audio / music">
            <TextInput value={shot.audio} placeholder="Grind of bronze" onSave={(audio) => set({ audio })} />
          </Field>
          <Field label="VFX / lighting">
            <TextInput value={shot.vfx} placeholder="Lantern flicker" onSave={(vfx) => set({ vfx })} />
          </Field>
        </div>
        <Field label="Into the next shot">
          <select className="inp" value={shot.transition} onChange={(e) => set({ transition: e.currentTarget.value as Shot['transition'] })}>
            {TRANSITIONS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <TextInput multiline value={shot.notes} onSave={(notes) => set({ notes })} />
        </Field>
      </section>
    </aside>
  );
};

/**
 * A cinematic's own authoring panel (spec §17): its shots as a sequencer
 * strip and a storyboard, the selected shot's detail beside them, and the
 * cinematic's own record when no shot is selected.
 */
export const ShotList = ({ project, id, onCommit, onNavigate, onOpenBible, onOpenCode }: Props) => {
  const cinematic = project.objects[id];
  const shots = shotsOf(cinematic);
  const [selected, setSelected] = useState<string | null>(shots[0]?.id ?? null);
  if (!cinematic) return <div className="window-waiting">This cinematic is not in the project any more.</div>;
  const total = runningTime(shots);
  const at = shots.findIndex((s) => s.id === selected);
  const shot = shots[at];

  const add = (afterId?: string) => {
    const r = addShot(project, id, afterId);
    onCommit(r.project);
    setSelected(r.shotId);
  };

  return (
    <div className="shotlist">
      <section className="shotlist-main">
        <div className="shotlist-bar">
          <Symbol type="cinematic" size={14} />
          <span className="shotlist-title">
            {cinematic.data.code ? `${cinematic.data.code} ` : ''}
            {cinematic.name}
          </span>
          <span className="shotlist-sum">
            {shots.length} shot{shots.length === 1 ? '' : 's'} · {total}s
          </span>
          <div className="grow" />
          <button className="tb-btn small" onClick={() => setSelected(null)} aria-pressed={!shot}>
            Cinematic details
          </button>
          <button className="tb-btn small primary" title="Add a shot after the selected one" onClick={() => add(shot?.id)}>
            + Shot
          </button>
        </div>

        {shots.length > 0 && (
          <div className="sequencer" role="listbox" aria-label="Shots in order">
            {shots.map((s, i) => (
              <button
                key={s.id}
                role="option"
                aria-selected={s.id === selected}
                className={`seq-shot${s.id === selected ? ' selected' : ''}`}
                style={{ flexGrow: Math.max(0.5, s.seconds) }}
                title={`${i + 1}. ${s.framing} · ${s.seconds}s${s.action ? ` — ${s.action}` : ''}`}
                onClick={() => setSelected(s.id)}
              >
                <span className="seq-n">{i + 1}</span>
                <span className="seq-f">{s.framing}</span>
                <span className="seq-s">{s.seconds}s</span>
                {i < shots.length - 1 && s.transition !== 'Cut' && <span className="seq-t">{s.transition}</span>}
              </button>
            ))}
          </div>
        )}

        <div className="storyboard">
          {shots.length === 0 && (
            <div className="storyboard-empty">
              <p>No shots yet. Break the cinematic into shots: framing, camera move, who is in frame, what we see, and how long each holds.</p>
              <button className="tb-btn primary" onClick={() => add()}>
                + First shot
              </button>
            </div>
          )}
          {shots.map((s, i) => (
            <article key={s.id} className={`shot-card${s.id === selected ? ' selected' : ''}`} onClick={() => setSelected(s.id)}>
              <FramingArt framing={s.framing} />
              <div className="shot-card-head">
                <span className="shot-n">{i + 1}</span>
                <span className="shot-f">
                  {s.framing}
                  {s.move !== 'Static' && ` · ${s.move.toLowerCase()}`}
                  {s.lens && ` · ${s.lens}`}
                </span>
                <span className="shot-s">{s.seconds}s</span>
              </div>
              <p className="shot-action">{s.action || <span className="muted">What we see…</span>}</p>
              {s.lineId && <p className="shot-line">“{project.lines.find((l) => l.id === s.lineId)?.text ?? '…'}”</p>}
              <div className="shot-tools" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn small" aria-label={`Move shot ${i + 1} earlier`} disabled={i === 0} onClick={() => onCommit(moveShot(project, id, s.id, i - 1))}>
                  ←
                </button>
                <button className="icon-btn small" aria-label={`Move shot ${i + 1} later`} disabled={i === shots.length - 1} onClick={() => onCommit(moveShot(project, id, s.id, i + 1))}>
                  →
                </button>
                <button
                  className="icon-btn small"
                  aria-label={`Duplicate shot ${i + 1}`}
                  title="Duplicate"
                  onClick={() => {
                    const r = duplicateShot(project, id, s.id);
                    onCommit(r.project);
                    setSelected(r.shotId);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="icon-btn small"
                  aria-label={`Delete shot ${i + 1}`}
                  title="Delete"
                  onClick={() => {
                    onCommit(removeShot(project, id, s.id));
                    if (selected === s.id) setSelected(shots[i + 1]?.id ?? shots[i - 1]?.id ?? null);
                  }}
                >
                  ×
                </button>
                <span className="shot-cut">{i < shots.length - 1 ? `${s.transition} →` : s.transition === 'Cut' ? 'End' : `${s.transition} out`}</span>
              </div>
            </article>
          ))}
          {shots.length > 0 && (
            <button className="shot-add" onClick={() => add()}>
              + Add a shot at the end
            </button>
          )}
        </div>
      </section>
      {shot ? (
        <ShotInspector project={project} id={id} shot={shot} index={at} onCommit={onCommit} />
      ) : (
        <ElementDetail project={project} id={id} onCommit={onCommit} onNavigate={onNavigate} onOpenBible={onOpenBible} onOpenCode={onOpenCode} variant="panel" />
      )}
    </div>
  );
};
