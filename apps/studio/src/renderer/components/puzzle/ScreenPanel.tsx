import { useState } from 'react';
import { describeInteraction, interactionsOf } from '../../model/details';
import { elementKindOf, elementsOf } from '../../model/puzzle/elements';
import {
  defaultScreen,
  makeScreen,
  removeScreen,
  SCREEN_KINDS,
  screenInteraction,
  screenIssues,
  screenKind,
  screenOf,
  setScreenInteraction,
  updateScreen,
  type CircuitCell,
  type ScreenKind,
  type ScreenPuzzle,
} from '../../model/puzzle/screens';
import type { Project, StoryObject } from '../../model/types';
import { EffectsEditor } from '../rules/RuleEditor';
import { Field } from './Field';
import { ScreenPlayer } from './ScreenPlayer';

const PIECES: CircuitCell['piece'][] = ['empty', 'end', 'straight', 'corner', 'tee', 'cross'];

const nums = (v: string) =>
  v
    .split(/[\s,–-]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
const words = (v: string) => v.split(/\s+/).filter(Boolean);

const Num = ({ label, value, min = 0, max = 99, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (n: number) => void }) => (
  <label className="pz-field">
    <span className="pz-label">{label}</span>
    <input className="inp small" type="number" min={min} max={max} aria-label={label} value={value} onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || 0))))} />
  </label>
);

interface Props {
  project: Project;
  puzzleId: string;
  onCommit: (p: Project) => void;
  selected: string | null;
  onSelect: (id: string) => void;
}

/**
 * The screen-level puzzle designer (puzzle spec §8): pick an element, give it
 * a screen of a kind, set its parts, answer, feedback and tries, and play it
 * beside the design as the player will.
 */
export const ScreenTab = ({ project, puzzleId, onCommit, selected, onSelect }: Props) => {
  const objects = elementsOf(project, puzzleId).filter((o) => o.type === 'object');
  const o = selected && project.objects[selected]?.type === 'object' ? project.objects[selected] : objects.find((x) => screenOf(x)) ?? objects[0];
  const [plays, setPlays] = useState(0);
  return (
    <div className="pz-screens">
      <div className="pz-row">
        <label className="pz-field">
          <span className="pz-label">Element</span>
          <select className="inp small" aria-label="Screen element" value={o?.id ?? ''} onChange={(e) => onSelect(e.target.value)}>
            {!objects.length && <option value="">No objects in this puzzle</option>}
            {objects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
                {screenOf(x) ? ` · ${screenKind(screenOf(x)!.kind).label}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!o ? (
        <p className="lvl-hint">A screen puzzle belongs to an object: add a lock, a container, a door or any object in Elements first.</p>
      ) : !screenOf(o) ? (
        <section className="pz-sec">
          <span className="pz-label">Give {o.name} a screen</span>
          <div className="pz-palette" role="group" aria-label="Screen kinds">
            {SCREEN_KINDS.map((k) => (
              <button key={k.id} className="pz-kind" title={k.hint} aria-label={`Make a ${k.label.toLowerCase()}`} onClick={() => onCommit(makeScreen(project, o.id, k.id))}>
                <span className="pz-kind-icon">{k.icon}</span>
                {k.label}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="pz-screen-split">
          <ScreenDesigner project={project} object={o} onCommit={onCommit} />
          <div className="pz-screen-preview">
            <span className="pz-label">Preview: play it</span>
            <ScreenPlayer key={`${o.id}:${plays}`} preview project={project} screen={screenOf(o)!} seed={o.id} title={o.name} />
            <span className="pref-hint">
              Solved, it does what “{screenInteraction(o)?.verb ?? '?'}” does: {screenInteraction(o) ? describeInteraction(project, screenInteraction(o)!) : 'pick the interaction it opens on'}.
            </span>
            <button className="tb-btn small" onClick={() => setPlays(plays + 1)}>
              Shuffle anew
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const ScreenDesigner = ({ project, object: o, onCommit }: { project: Project; object: StoryObject; onCommit: (p: Project) => void }) => {
  const s = screenOf(o)!;
  const set = (patch: Partial<ScreenPuzzle>) => onCommit(updateScreen(project, o.id, patch));
  const issues = screenIssues(project, o);
  const codes = Object.values(project.objects).filter((x) => x.type === 'lore' && elementKindOf(x) === 'code');
  return (
    <div className="pz-screen-design">
      <div className="pz-row">
        <label className="pz-field">
          <span className="pz-label">Kind</span>
          <select className="inp small" aria-label="Screen kind" value={s.kind} onChange={(e) => onCommit(updateScreen(project, o.id, { ...defaultScreen(e.target.value as ScreenKind), prompt: s.prompt, feedback: s.feedback, attempts: s.attempts, onWrong: s.onWrong, art: s.art, audio: s.audio }))}>
            {SCREEN_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.icon} {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pz-field">
          <span className="pz-label">Opens on</span>
          <select className="inp small" aria-label="Opens on" value={screenInteraction(o)?.id ?? ''} onChange={(e) => e.target.value && onCommit(setScreenInteraction(project, o.id, e.target.value))}>
            <option value="">— an interaction —</option>
            {interactionsOf(o).map((i) => (
              <option key={i.id} value={i.id}>
                {describeInteraction(project, i)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Field label="What the player is told" value={s.prompt} onCommit={(v) => set({ prompt: v })} />

      {s.kind === 'keypad' && (
        <div className="pz-row">
          <Field label="Code" value={s.code ?? ''} placeholder="4271" onCommit={(v) => set({ code: v.trim() })} />
          <label className="pz-field">
            <span className="pz-label">Or the code of</span>
            <select className="inp small" aria-label="Code element" value={s.codeRef ?? ''} onChange={(e) => set({ codeRef: e.target.value || undefined })}>
              <option value="">—</option>
              {codes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({String(c.data.answer ?? '?')})
                </option>
              ))}
            </select>
          </label>
          <Field label="Keys" value={s.keys ?? ''} onCommit={(v) => set({ keys: v.replace(/\s/g, '') })} />
        </div>
      )}
      {s.kind === 'dial' && (
        <div className="pz-row">
          <Num label="Numbers round it" value={s.positions ?? 40} min={2} max={100} onChange={(positions) => set({ positions })} />
          <Field label="Combination" value={(s.combination ?? []).join(', ')} placeholder="12, 30, 7" onCommit={(v) => set({ combination: nums(v) })} />
        </div>
      )}
      {s.kind === 'tiles' && (
        <div className="pz-row">
          <Num label="Size" value={s.size ?? 3} min={2} max={6} onChange={(size) => set({ size })} />
          <Num label="Shuffled by (moves)" value={s.shuffle ?? 40} min={1} max={500} onChange={(shuffle) => set({ shuffle })} />
        </div>
      )}
      {s.kind === 'symbols' && (
        <>
          <Field label="Symbols (spaces between)" value={(s.symbols ?? []).join(' ')} onCommit={(v) => set({ symbols: words(v) })} />
          <Field label="Answer (in order)" value={(s.answer ?? []).join(' ')} onCommit={(v) => set({ answer: words(v) })} />
        </>
      )}
      {s.kind === 'rings' && (
        <div className="pz-row">
          <Num label="Rings" value={s.rings ?? 3} min={1} max={6} onChange={(rings) => set({ rings })} />
          <Num label="Segments" value={s.segments ?? 8} min={2} max={24} onChange={(segments) => set({ segments })} />
          <Field label="Where each starts" value={(s.start ?? []).join(', ')} placeholder="3, 6, 2" onCommit={(v) => set({ start: nums(v) })} />
          <label className="lvl-toggle">
            <input type="checkbox" checked={!!s.linked} onChange={(e) => set({ linked: e.target.checked || undefined })} /> Linked: each turns the next too
          </label>
        </div>
      )}
      {s.kind === 'circuit' && <CircuitDesigner s={s} set={set} />}
      {s.kind === 'assembly' && (
        <section className="pz-sec">
          <span className="pz-label">Parts</span>
          {(s.parts ?? []).map((p, i) => (
            <div key={p.id} className="pz-row">
              <input className="inp small" aria-label={`Part ${i + 1}`} defaultValue={p.label} key={p.label} onBlur={(e) => set({ parts: (s.parts ?? []).map((x) => (x.id === p.id ? { ...x, label: e.currentTarget.value.trim() || x.label } : x)) })} />
              <button className="icon-btn small" aria-label={`Remove part ${i + 1}`} onClick={() => set({ parts: (s.parts ?? []).filter((x) => x.id !== p.id) })}>
                ×
              </button>
            </div>
          ))}
          <button className="tb-btn small" onClick={() => set({ parts: [...(s.parts ?? []), { id: `p${Date.now().toString(36)}`, label: 'New part' }] })}>
            + Part
          </button>
          <span className="pz-label">Slots, and the part each takes</span>
          {(s.slots ?? []).map((sl, i) => (
            <div key={sl.id} className="pz-row">
              <input className="inp small" aria-label={`Slot ${i + 1}`} defaultValue={sl.label} key={sl.label} onBlur={(e) => set({ slots: (s.slots ?? []).map((x) => (x.id === sl.id ? { ...x, label: e.currentTarget.value.trim() || x.label } : x)) })} />
              <select className="inp small" aria-label={`Slot ${i + 1} takes`} value={sl.accepts} onChange={(e) => set({ slots: (s.slots ?? []).map((x) => (x.id === sl.id ? { ...x, accepts: e.target.value } : x)) })}>
                <option value="">—</option>
                {(s.parts ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <button className="icon-btn small" aria-label={`Remove slot ${i + 1}`} onClick={() => set({ slots: (s.slots ?? []).filter((x) => x.id !== sl.id) })}>
                ×
              </button>
            </div>
          ))}
          <button className="tb-btn small" onClick={() => set({ slots: [...(s.slots ?? []), { id: `s${Date.now().toString(36)}`, label: 'New slot', accepts: s.parts?.[0]?.id ?? '' }] })}>
            + Slot
          </button>
        </section>
      )}
      {s.kind === 'matching' && (
        <section className="pz-sec">
          <span className="pz-label">Pairs</span>
          {(s.pairs ?? []).map((p, i) => (
            <div key={`${i}:${p.left}:${p.right}`} className="pz-row">
              <input className="inp small" aria-label={`Pair ${i + 1} left`} defaultValue={p.left} onBlur={(e) => set({ pairs: (s.pairs ?? []).map((x, j) => (j === i ? { ...x, left: e.currentTarget.value } : x)) })} />
              <span>↔</span>
              <input className="inp small" aria-label={`Pair ${i + 1} right`} defaultValue={p.right} onBlur={(e) => set({ pairs: (s.pairs ?? []).map((x, j) => (j === i ? { ...x, right: e.currentTarget.value } : x)) })} />
              <button className="icon-btn small" aria-label={`Remove pair ${i + 1}`} onClick={() => set({ pairs: (s.pairs ?? []).filter((_, j) => j !== i) })}>
                ×
              </button>
            </div>
          ))}
          <button className="tb-btn small" onClick={() => set({ pairs: [...(s.pairs ?? []), { left: 'This', right: 'That' }] })}>
            + Pair
          </button>
        </section>
      )}
      {s.kind === 'ordering' && <Field label="The items, in the right order (one a line)" multiline rows={4} value={(s.items ?? []).join('\n')} onCommit={(v) => set({ items: v.split('\n').map((x) => x.trim()).filter(Boolean) })} />}
      {s.kind === 'levers' && <LeversDesigner s={s} set={set} />}
      {s.kind === 'custom' && <Field label="The answer that solves it" value={s.text ?? ''} onCommit={(v) => set({ text: v })} />}

      <div className="pz-row">
        <Field label="When right" value={s.feedback.correct} onCommit={(v) => set({ feedback: { ...s.feedback, correct: v } })} />
        <Field label="When wrong" value={s.feedback.wrong} onCommit={(v) => set({ feedback: { ...s.feedback, wrong: v } })} />
        <Num label="Tries (0: any)" value={s.attempts ?? 0} max={20} onChange={(attempts) => set({ attempts: attempts || undefined })} />
      </div>
      <EffectsEditor project={project} effects={s.onWrong} label="A wrong answer also does" onChange={(e) => set({ onWrong: e?.length ? e : undefined })} />
      <div className="pz-row">
        <Field label="Art (replaces the proxy)" value={s.art ?? ''} placeholder="ui/safe_keypad.png" onCommit={(v) => set({ art: v.trim() || undefined })} />
        <Field label="Audio" value={s.audio ?? ''} placeholder="sfx/keypad_beep.wav" onCommit={(v) => set({ audio: v.trim() || undefined })} />
      </div>
      {issues.length > 0 && (
        <ul className="pz-issues">
          {issues.map((i) => (
            <li key={i} className="pz-issue error">
              ● {i}
            </li>
          ))}
        </ul>
      )}
      <button className="tb-btn small" onClick={() => onCommit(removeScreen(project, o.id))}>
        Remove the screen
      </button>
    </div>
  );
};

/** The circuit's board: each cell's piece and its solved turn, the source and the sink. */
const CircuitDesigner = ({ s, set }: { s: ScreenPuzzle; set: (p: Partial<ScreenPuzzle>) => void }) => {
  const w = s.width ?? 3;
  const h = s.height ?? 3;
  const cells = s.cells ?? [];
  const resize = (nw: number, nh: number) =>
    set({
      width: nw,
      height: nh,
      // What fits stays where it was; new cells are empty.
      cells: Array.from({ length: nw * nh }, (_, i) => {
        const r = Math.floor(i / nw);
        const c = i % nw;
        return r < h && c < w ? (cells[r * w + c] ?? { piece: 'empty' as const, rot: 0 }) : { piece: 'empty' as const, rot: 0 };
      }),
      source: 0,
      sink: nw * nh - 1,
    });
  const cell = (i: number, patch: Partial<CircuitCell>) => set({ cells: cells.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <section className="pz-sec">
      <div className="pz-row">
        <Num label="Width" value={w} min={2} max={6} onChange={(nw) => resize(nw, h)} />
        <Num label="Height" value={h} min={2} max={6} onChange={(nh) => resize(w, nh)} />
        <Num label="Source cell" value={(s.source ?? 0) + 1} min={1} max={w * h} onChange={(n) => set({ source: n - 1 })} />
        <Num label="Sink cell" value={(s.sink ?? w * h - 1) + 1} min={1} max={w * h} onChange={(n) => set({ sink: n - 1 })} />
      </div>
      <span className="pz-label">The board, solved (the player gets it turned out of true)</span>
      <div className="pz-circuit-grid" style={{ gridTemplateColumns: `repeat(${w}, minmax(90px, 1fr))` }}>
        {cells.map((c, i) => (
          <div key={i} className={`pz-circuit-cell${i === s.source ? ' source' : ''}${i === s.sink ? ' sink' : ''}`}>
            <span className="muted">{i + 1}</span>
            <select className="inp small" aria-label={`Cell ${i + 1} piece`} value={c.piece} onChange={(e) => cell(i, { piece: e.target.value as CircuitCell['piece'] })}>
              {PIECES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <button className="icon-btn small" aria-label={`Turn cell ${i + 1}`} onClick={() => cell(i, { rot: (c.rot + 1) % 4 })}>
              ⟳{c.rot}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
};

/** The switches: what each flips besides itself, how it starts, how it must end. */
const LeversDesigner = ({ s, set }: { s: ScreenPuzzle; set: (p: Partial<ScreenPuzzle>) => void }) => {
  const sw = s.switches ?? [];
  const n = sw.length;
  const fit = <T,>(a: T[] | undefined, fill: T) => Array.from({ length: n }, (_, i) => a?.[i] ?? fill);
  return (
    <section className="pz-sec">
      <Field label="Switches (commas between)" value={sw.join(', ')} onCommit={(v) => {
        const next = v.split(',').map((x) => x.trim()).filter(Boolean);
        set({ switches: next, links: Array.from({ length: next.length }, (_, i) => (s.links?.[i] ?? []).filter((j) => j < next.length)), startOn: Array.from({ length: next.length }, (_, i) => !!s.startOn?.[i]), target: Array.from({ length: next.length }, (_, i) => s.target?.[i] ?? true) });
      }} />
      <table className="pz-clue-table" aria-label="Switch logic">
        <thead>
          <tr>
            <th>Switch</th>
            <th>Also flips</th>
            <th>Starts on</th>
            <th>Must end on</th>
          </tr>
        </thead>
        <tbody>
          {sw.map((label, i) => (
            <tr key={i}>
              <td>{label}</td>
              <td>
                {sw.map((other, j) =>
                  j === i ? null : (
                    <label key={j} className="lvl-toggle inline">
                      <input
                        type="checkbox"
                        aria-label={`${label} also flips ${other}`}
                        checked={!!s.links?.[i]?.includes(j)}
                        onChange={(e) => set({ links: fit(s.links, [] as number[]).map((l, k) => (k === i ? (e.target.checked ? [...l, j] : l.filter((x) => x !== j)) : l)) })}
                      />{' '}
                      {other}
                    </label>
                  ),
                )}
              </td>
              <td>
                <input type="checkbox" aria-label={`${label} starts on`} checked={!!s.startOn?.[i]} onChange={(e) => set({ startOn: fit(s.startOn, false).map((x, k) => (k === i ? e.target.checked : x)) })} />
              </td>
              <td>
                <input type="checkbox" aria-label={`${label} must end on`} checked={!!s.target?.[i]} onChange={(e) => set({ target: fit(s.target, false).map((x, k) => (k === i ? e.target.checked : x)) })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
