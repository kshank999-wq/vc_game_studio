import { useState } from 'react';
import { setValue } from '../../model/details';
import { CLUE_FORMS, clueOf, CUE_KINDS, cuesOf, DISCOVERY, HINT_STRENGTHS, hintsOf, isClue, removeCue, removeHint, traceClues, updateClue, updateCue, updateHint, addCue, addHint, type CueKind } from '../../model/puzzle/clues';
import { nodesOf, type PuzzleNode } from '../../model/puzzle/design';
import { addElement, ELEMENT_KINDS, elementKindOf, elementsOf, itemsFor, kindSpec, linkElement, setElementKind, stepFromElement, stepsUsing, unlinkElement, type ElementKind } from '../../model/puzzle/elements';
import { statesOf } from '../../model/details';
import { renameObject } from '../../model/project';
import type { Project, StoryObject } from '../../model/types';
import { Interactions, StateList } from '../detail/ElementDetail';
import { ConditionEditor } from '../rules/RuleEditor';
import { Field } from './Field';

const ELEMENT_TYPES = new Set(['object', 'inventory', 'lore', 'state', 'trigger']);
const TYPE_WORD: Record<string, string> = { object: 'object', inventory: 'item', lore: 'lore', state: 'state', trigger: 'trigger' };

const icon = (o: StoryObject) => kindSpec(elementKindOf(o)).icon;

/** What an element is, in a few words: its states, or what kind of story element it is. */
const summary = (o: StoryObject) => (o.type === 'object' && statesOf(o).length ? statesOf(o).join(' → ') : TYPE_WORD[o.type]);

interface Common {
  project: Project;
  puzzleId: string;
  onCommit: (p: Project) => void;
  onSay: (text: string) => void;
}

/** The element library (puzzle spec §9): the kinds to make, and the elements this puzzle is made of. */
export const ElementsTab = ({ project, puzzleId, onCommit, onSay, selected, onSelect }: Common & { selected: string | null; onSelect: (id: string) => void }) => {
  const [name, setName] = useState('');
  const elements = elementsOf(project, puzzleId);
  const others = Object.values(project.objects)
    .filter((o) => ELEMENT_TYPES.has(o.type) && !elements.some((e) => e.id === o.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const make = (kind: ElementKind) => {
    const made = addElement(project, puzzleId, kind, name);
    onCommit(made.project);
    onSelect(made.elementId);
    setName('');
    onSay(`${made.project.objects[made.elementId]!.name} is in the Bible and part of this puzzle.`);
  };
  return (
    <div className="pz-elements">
      <section className="pz-sec">
        <div className="pz-row">
          <span className="pz-label">Add an element</span>
          <input className="inp small" aria-label="New element name" placeholder="Name (optional), e.g. Study safe" value={name} onChange={(e) => setName(e.target.value)} />
          <select
            className="inp small"
            aria-label="Add from the Bible"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onCommit(linkElement(project, puzzleId, e.target.value));
              onSelect(e.target.value);
            }}
          >
            <option value="">+ one already in the Bible…</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({TYPE_WORD[o.type]})
              </option>
            ))}
          </select>
        </div>
        <div className="pz-palette" role="group" aria-label="Element kinds">
          {ELEMENT_KINDS.map((k) => (
            <button key={k.id} className="pz-kind" title={k.hint} aria-label={`Add ${k.label}`} onClick={() => make(k.id)}>
              <span className="pz-kind-icon">{k.icon}</span>
              {k.label}
            </button>
          ))}
        </div>
      </section>
      <section className="pz-sec">
        <span className="pz-label">This puzzle’s elements</span>
        {elements.length ? (
          <div className="pz-element-list" role="listbox" aria-label="Puzzle elements">
            {elements.map((o) => {
              const uses = stepsUsing(project, puzzleId, o.id).length;
              const items = itemsFor(project, o.id).length;
              return (
                <button key={o.id} role="option" aria-selected={selected === o.id} className={`pz-element${selected === o.id ? ' on' : ''}`} onClick={() => onSelect(o.id)}>
                  <span className="pz-kind-icon">{icon(o)}</span>
                  <span className="pz-element-name">{o.name}</span>
                  <span className="muted">
                    {kindSpec(elementKindOf(o)).label} · {summary(o)}
                  </span>
                  <span className={`pz-badge${uses ? '' : ' soft'}`}>{uses ? `${uses} step${uses === 1 ? '' : 's'}` : 'no step'}</span>
                  {items > 0 && <span className="pz-badge soft">in a level</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="lvl-hint">No elements yet. Add a kind above, or one already in the Bible. Elements its steps name join it by themselves.</p>
        )}
      </section>
    </div>
  );
};

/** The clue system (§10): every clue and what it is for, and the staged hints. */
export const CluesTab = ({ project, puzzleId, onCommit, onSelect }: Common & { onSelect: (id: string) => void }) => {
  const traces = traceClues(project, puzzleId);
  const nodes = nodesOf(project.objects[puzzleId]);
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  const hints = hintsOf(project.objects[puzzleId]);
  return (
    <div className="pz-clues">
      <section className="pz-sec">
        <span className="pz-label">Clues and what each is for</span>
        {traces.length ? (
          <table className="pz-clue-table" aria-label="Clues">
            <thead>
              <tr>
                <th>Clue</th>
                <th>Form</th>
                <th>Where · how</th>
                <th>Strength</th>
                <th>Helps with</th>
                <th>Reached</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr key={t.clue.id} className={t.used ? '' : 'unused'}>
                  <td>
                    <button className="lvl-link-go" onClick={() => onSelect(t.clue.id)}>
                      {t.clue.name}
                      <span className="muted">{t.info.mandatory ? 'needed' : 'optional'}</span>
                    </button>
                  </td>
                  <td>{t.info.form}</td>
                  <td>{[t.info.location, t.info.discovery].filter(Boolean).join(' · ')}</td>
                  <td>{t.info.strength}</td>
                  <td>{t.used ? t.usedBy.map(label).join(', ') : <span className="pz-warn">⚠ unused</span>}</td>
                  <td>{t.reached === 'nothing' ? <span className="pz-warn">⚠ nothing reveals it</span> : t.reached === 'effect' ? 'revealed' : t.reached === 'rule' ? 'by its rule' : 'from the start'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="lvl-hint">No clues yet. In Elements, add a Clue; say where it is, how it is found, what it tells and which steps it helps with.</p>
        )}
      </section>
      <section className="pz-sec">
        <span className="pz-label">Staged hints</span>
        <span className="pref-hint">More help as the player struggles: each is given once, after so many wrong moves, once its condition holds, or both.</span>
        {hints.map((h, i) => (
          <div key={h.id} className="pz-hint">
            <span className="lvl-count">{i + 1}</span>
            <Field label={`Hint ${i + 1}`} value={h.text} onCommit={(v) => onCommit(updateHint(project, puzzleId, h.id, { text: v.trim() || h.text }))} />
            <label className="pz-field">
              <span className="pz-label">After wrong moves</span>
              <input className="inp small" type="number" min={0} aria-label={`Hint ${i + 1} after wrong moves`} value={h.afterFails ?? 0} onChange={(e) => onCommit(updateHint(project, puzzleId, h.id, { afterFails: Math.max(0, Math.round(Number(e.target.value) || 0)) || undefined }))} />
            </label>
            <ConditionEditor project={project} condition={h.when} label="And once" onChange={(c) => onCommit(updateHint(project, puzzleId, h.id, { when: c }))} />
            <button className="icon-btn small" aria-label={`Remove hint ${i + 1}`} onClick={() => onCommit(removeHint(project, puzzleId, h.id))}>
              ×
            </button>
          </div>
        ))}
        <button className="tb-btn small" onClick={() => onCommit(addHint(project, puzzleId))}>
          + Hint
        </button>
      </section>
    </div>
  );
};

/** The selected element: its kind and properties, states and verbs (§11), the clue it is (§10), the steps that use it. */
export const ElementInspector = ({ project, puzzleId, elementId, onCommit, onSay, onOpenBible, onOpenLevels, onSelectNode, parentFor }: Common & { elementId: string; onOpenBible: (id?: string) => void; onOpenLevels?: (itemId?: string) => void; onSelectNode: (id: string) => void; parentFor: string | null }) => {
  const o = project.objects[elementId];
  if (!o) return null;
  const kind = elementKindOf(o);
  const spec = kindSpec(kind);
  const uses = stepsUsing(project, puzzleId, o.id);
  const items = itemsFor(project, o.id);
  const nodes = nodesOf(project.objects[puzzleId]);
  const clue = isClue(o) ? clueOf(o) : undefined;
  const listed = ((project.objects[puzzleId]?.data.elements as string[] | undefined) ?? []).includes(o.id);
  const step = (state?: string) => {
    const made = stepFromElement(project, puzzleId, o.id, { state, parentId: parentFor });
    if (!made.nodeId) return;
    onCommit(made.project);
    onSelectNode(made.nodeId);
    onSay(`A step done when ${o.name}${state ? ` is ${state}` : o.type === 'inventory' ? ' is carried' : o.type === 'lore' ? ' is known' : ' is set'}.`);
  };
  return (
    <div className="pz-inspector">
      <span className="lvl-kind">
        {spec.icon} {spec.label} · {TYPE_WORD[o.type]}
      </span>
      <Field label="Name" value={o.name} onCommit={(v) => v.trim() && onCommit(renameObject(project, o.id, v.trim()))} />
      <label className="pz-field">
        <span className="pz-label">Element kind</span>
        <select className="inp small" aria-label="Element kind" value={kind} onChange={(e) => onCommit(setElementKind(project, o.id, e.target.value as ElementKind))}>
          {ELEMENT_KINDS.filter((k) => k.type === o.type || k.id === 'custom' || k.id === kind).map((k) => (
            <option key={k.id} value={k.id}>
              {k.icon} {k.label}
            </option>
          ))}
        </select>
        <span className="pref-hint">{spec.hint}</span>
      </label>
      {(spec.props ?? []).map((p) => (
        <Field key={p.key} label={p.label} value={String(o.data[p.key] ?? '')} placeholder={p.placeholder} onCommit={(v) => onCommit(setValue(project, o.id, p.key, v.trim() || undefined))} />
      ))}
      {clue && (
        <section className="pz-sec">
          <span className="pz-label">The clue</span>
          <div className="pz-row">
            <label className="pz-field">
              <span className="pz-label">Form</span>
              <select className="inp small" aria-label="Clue form" value={clue.form} onChange={(e) => onCommit(updateClue(project, o.id, { form: e.target.value }))}>
                {CLUE_FORMS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="pz-field">
              <span className="pz-label">Found by</span>
              <select className="inp small" aria-label="Found by" value={clue.discovery} onChange={(e) => onCommit(updateClue(project, o.id, { discovery: e.target.value }))}>
                {DISCOVERY.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="pz-field">
              <span className="pz-label">Hint strength</span>
              <select className="inp small" aria-label="Hint strength" value={clue.strength} onChange={(e) => onCommit(updateClue(project, o.id, { strength: e.target.value }))}>
                {HINT_STRENGTHS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
          </div>
          <Field label="What it is" multiline rows={2} value={clue.content} placeholder="The words, the picture, the sound" onCommit={(v) => onCommit(updateClue(project, o.id, { content: v }))} />
          <Field label="Where" value={clue.location} placeholder="Behind the painting" onCommit={(v) => onCommit(updateClue(project, o.id, { location: v }))} />
          <Field label="What it tells the player" value={clue.knowledge} placeholder="The code starts 4, 2" onCommit={(v) => onCommit(updateClue(project, o.id, { knowledge: v }))} />
          <label className="lvl-toggle">
            <input type="checkbox" checked={clue.mandatory} onChange={(e) => onCommit(updateClue(project, o.id, { mandatory: e.target.checked }))} /> Needed to solve it (not an optional extra)
          </label>
          <span className="pz-label">Helps with</span>
          <div className="pz-checks">
            {nodes.map((n) => (
              <label key={n.id} className="lvl-toggle">
                <input
                  type="checkbox"
                  checked={clue.supports.includes(n.id)}
                  onChange={(e) => onCommit(updateClue(project, o.id, { supports: e.target.checked ? [...clue.supports, n.id] : clue.supports.filter((x) => x !== n.id) }))}
                />{' '}
                {n.label}
              </label>
            ))}
          </div>
        </section>
      )}
      {o.type === 'object' && (
        <section className="pz-sec">
          <StateList object={o} project={project} onCommit={onCommit} label="States" />
          <Interactions object={o} project={project} onCommit={onCommit} />
        </section>
      )}
      <section className="pz-sec">
        <span className="pz-label">Steps that use it</span>
        {uses.map((n: PuzzleNode) => (
          <button key={n.id} className="lvl-link-go" onClick={() => onSelectNode(n.id)}>
            {n.label}
            <span className="muted">select the step</span>
          </button>
        ))}
        <div className="lvl-btnrow wrap">
          {o.type === 'object' ? (
            statesOf(o).map((st) => (
              <button key={st} className="tb-btn small" onClick={() => step(st)}>
                + Step: {st}
              </button>
            ))
          ) : o.type !== 'trigger' ? (
            <button className="tb-btn small" onClick={() => step()}>
              + Step that needs it
            </button>
          ) : null}
        </div>
      </section>
      <section className="pz-sec">
        <span className="pz-label">In the levels</span>
        {items.length ? (
          items.map((i) => (
            <button key={i.id} className="lvl-link-go" onClick={() => onOpenLevels?.(i.id)}>
              {i.name}
              <span className="muted">open in the Level Designer ↗</span>
            </button>
          ))
        ) : (
          <p className="lvl-hint">Not placed. It can stay a piece of logic, or stand for something in a level: link a level item to it there.</p>
        )}
      </section>
      <div className="lvl-btnrow wrap">
        <button className="tb-btn small" onClick={() => onOpenBible(o.id)}>
          Open in the Bible ↗
        </button>
        {listed && (
          <button className="tb-btn small" onClick={() => onCommit(unlinkElement(project, puzzleId, o.id))}>
            Take off this puzzle
          </button>
        )}
      </div>
    </div>
  );
};

/** What solving it plays (§11): animations, sounds, effects, a line, a cinematic, a message. */
export const CuesEditor = ({ project, puzzleId, onCommit }: Omit<Common, 'onSay'>) => {
  const cues = cuesOf(project.objects[puzzleId]);
  return (
    <section className="pz-sec">
      <span className="pz-label">When solved, it plays</span>
      {cues.map((c, i) => {
        const refKind = CUE_KINDS.find((k) => k.id === c.kind)?.ref;
        const refs = refKind ? Object.values(project.objects).filter((o) => o.type === refKind) : [];
        return (
          <div key={c.id} className="pz-cue">
            <select className="inp small" aria-label={`Cue ${i + 1} kind`} value={c.kind} onChange={(e) => onCommit(updateCue(project, puzzleId, c.id, { kind: e.target.value as CueKind }))}>
              {CUE_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            {refKind && (
              <select className="inp small" aria-label={`Cue ${i + 1} plays`} value={c.ref ?? ''} onChange={(e) => onCommit(updateCue(project, puzzleId, c.id, { ref: e.target.value || undefined }))}>
                <option value="">— which {refKind} —</option>
                {refs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            )}
            <input key={c.text} className="inp small" aria-label={`Cue ${i + 1}`} defaultValue={c.text} placeholder={c.kind === 'message' ? 'The passage grinds open.' : 'The asset, or what happens'} onBlur={(e) => e.currentTarget.value !== c.text && onCommit(updateCue(project, puzzleId, c.id, { text: e.currentTarget.value.trim() }))} />
            <button className="icon-btn small" aria-label={`Remove cue ${i + 1}`} onClick={() => onCommit(removeCue(project, puzzleId, c.id))}>
              ×
            </button>
          </div>
        );
      })}
      <button className="tb-btn small" onClick={() => onCommit(addCue(project, puzzleId))}>
        + Cue
      </button>
      <span className="pref-hint">Doors and travel links it opens are bound in the Level Designer; items it gives are in When solved.</span>
    </section>
  );
};
