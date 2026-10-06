import { statNames } from '../../model/equipment';
import { statesOf, varTypeOf } from '../../model/details';
import {
  EFFECTS,
  SUBJECTS,
  describeCondition,
  describeEffects,
  describeRule,
  effectKindOf,
  isRule,
  newCondition,
  newEffect,
  subjectOf,
  type Condition,
  type Effect,
  type Rule,
} from '../../model/rules';
import type { ObjectType, OptionBehaviour, Project } from '../../model/types';

/** The options a choice can be answered with, from the graph and from scene timelines. */
export const choiceOptions = (project: Project, choiceId: string): string[] => {
  const labels = new Set<string>();
  for (const c of project.connections) if (c.kind === 'branch' && c.sourceId === choiceId && c.label) labels.add(c.label);
  for (const e of project.events) {
    if (e.refId !== choiceId || e.kind !== 'choice') continue;
    if (e.mainLabel) labels.add(e.mainLabel);
    for (const b of project.branches) if (b.choiceEventId === e.id) labels.add(b.label);
  }
  return [...labels];
};

const objectsOf = (project: Project, type: ObjectType, kind?: Condition['kind'] | Effect['kind']) =>
  Object.values(project.objects)
    .filter((o) => o.type === type)
    // Number conditions and effects are about number states; the rest about states with values or text.
    .filter((o) => o.type !== 'state' || !kind || (kind === 'number' || kind === 'addNumber' || kind === 'setNumber') === (varTypeOf(o) === 'number'))
    .sort((a, b) => a.name.localeCompare(b.name));

/** A text state takes any value, typed in. */
const isText = (project: Project, ref: string) => varTypeOf(project.objects[ref]) === 'text';

const valueChoices = (project: Project, ref: string, kind: 'states' | 'options'): string[] =>
  kind === 'states' ? statesOf(project.objects[ref]) : choiceOptions(project, ref);

const ConditionRow = ({ project, condition, onChange, onRemove }: { project: Project; condition: Condition; onChange: (c: Condition) => void; onRemove: () => void }) => {
  const subject = subjectOf(condition.kind);
  // A stat condition is about a stat's name (Damage, Light), not an element.
  const stats = condition.kind === 'stat' ? [...new Set([...statNames(project), ...(condition.ref ? [condition.ref] : [])])] : [];
  const targets = condition.kind === 'stat' ? stats.map((n) => ({ id: n, name: n })) : objectsOf(project, subject.type, condition.kind);
  const missing = condition.kind !== 'stat' && condition.ref && !project.objects[condition.ref];
  return (
    <div className={`rule-row${missing ? ' broken' : ''}`}>
      <select
        className="inp"
        aria-label="About"
        value={condition.kind}
        onChange={(e) => {
          const kind = e.currentTarget.value as Condition['kind'];
          onChange(newCondition(kind, kind === 'stat' ? (statNames(project)[0] ?? 'Damage') : (objectsOf(project, subjectOf(kind).type, kind)[0]?.id ?? '')));
        }}
      >
        {SUBJECTS.map((s) => (
          <option key={s.kind} value={s.kind}>
            {s.label}
          </option>
        ))}
      </select>
      <select className="inp" aria-label={subject.label} value={condition.ref} onChange={(e) => onChange({ ...condition, ref: e.currentTarget.value } as Condition)}>
        {missing && <option value={condition.ref}>(deleted)</option>}
        {!condition.ref && <option value="">Choose…</option>}
        {targets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <select className="inp" aria-label="Test" value={condition.op} onChange={(e) => onChange({ ...condition, op: e.currentTarget.value } as Condition)}>
        {subject.ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {condition.kind === 'flag' && isText(project, condition.ref) && (
        <input key={condition.value} className="inp" aria-label="Value" placeholder="Text" defaultValue={condition.value} onBlur={(e) => onChange({ ...condition, value: e.currentTarget.value })} />
      )}
      {(subject.value === 'states' || subject.value === 'options') && 'value' in condition && !(condition.kind === 'flag' && isText(project, condition.ref)) && (
        <select className="inp" aria-label="Value" value={String(condition.value)} onChange={(e) => onChange({ ...condition, value: e.currentTarget.value } as Condition)}>
          <option value="">{subject.value === 'options' ? 'any option' : 'Choose…'}</option>
          {valueChoices(project, condition.ref, subject.value).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
      {subject.value === 'number' && (condition.kind === 'arc' || condition.kind === 'skill' || condition.kind === 'stat' || condition.kind === 'number' || condition.kind === 'reputation') && (
        <input
          key={condition.value}
          className="inp num"
          type="number"
          aria-label={condition.kind === 'arc' ? 'Arc value' : condition.kind === 'skill' ? 'Rank' : condition.kind === 'number' ? 'Number' : condition.kind === 'reputation' ? 'Standing' : 'Stat value'}
          defaultValue={condition.value}
          onBlur={(e) => onChange({ ...condition, value: Number(e.currentTarget.value) || 0 })}
        />
      )}
      <button className="icon-btn small" aria-label="Remove condition" onClick={onRemove}>
        ×
      </button>
    </div>
  );
};

/** One condition (a puzzle step's "Done when"), or a way to give it one. */
export const ConditionEditor = ({ project, condition, onChange, label }: { project: Project; condition: Condition | undefined; onChange: (c: Condition | undefined) => void; label: string }) => {
  const firstKind: Condition['kind'] = objectsOf(project, 'inventory').length ? 'item' : objectsOf(project, 'state').length ? 'flag' : 'visited';
  return (
    <div className="rule">
      <div className="rule-head">
        <span className="rule-label">{label}</span>
        <span className="rule-says">{condition ? describeCondition(project, condition) : 'Nothing yet'}</span>
      </div>
      {condition ? (
        <ConditionRow project={project} condition={condition} onChange={onChange} onRemove={() => onChange(undefined)} />
      ) : (
        <div className="rule-add">
          <button className="chip-add small" onClick={() => onChange(newCondition(firstKind, objectsOf(project, subjectOf(firstKind).type)[0]?.id ?? ''))}>
            + Condition
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * A rule, built from conditions rather than written as code: all or any of
 * them, with one level of nested groups. Empty means "always".
 */
export const RuleEditor = ({ project, rule, onChange, label, nested = false }: {
  project: Project;
  rule: Rule | undefined;
  onChange: (rule: Rule | undefined) => void;
  label: string;
  nested?: boolean;
}) => {
  const current: Rule = rule ?? { match: 'all', items: [] };
  const set = (items: Rule['items'], match = current.match) => onChange(items.length ? { match, items } : undefined);
  const firstKind: Condition['kind'] = objectsOf(project, 'state').length ? 'flag' : objectsOf(project, 'inventory').length ? 'item' : 'visited';
  const add = () => set([...current.items, newCondition(firstKind, objectsOf(project, subjectOf(firstKind).type)[0]?.id ?? '')]);
  return (
    <div className={`rule${nested ? ' nested' : ''}`}>
      {!nested && (
        <div className="rule-head">
          <span className="rule-label">{label}</span>
          <span className="rule-says">{describeRule(project, rule)}</span>
        </div>
      )}
      {current.items.length > 1 && (
        <div className="rule-match">
          <select className="inp" aria-label="Match" value={current.match} onChange={(e) => set(current.items, e.currentTarget.value as Rule['match'])}>
            <option value="all">All of these</option>
            <option value="any">Any of these</option>
          </select>
        </div>
      )}
      {current.items.map((item, i) =>
        isRule(item) ? (
          <div key={i} className="rule-group">
            <RuleEditor
              project={project}
              rule={item}
              label=""
              nested
              onChange={(r) => set(r ? current.items.map((x, j) => (j === i ? r : x)) : current.items.filter((_, j) => j !== i))}
            />
          </div>
        ) : (
          <ConditionRow
            key={i}
            project={project}
            condition={item}
            onChange={(c) => set(current.items.map((x, j) => (j === i ? c : x)))}
            onRemove={() => set(current.items.filter((_, j) => j !== i))}
          />
        ),
      )}
      <div className="rule-add">
        <button className="chip-add small" onClick={add}>
          + Condition
        </button>
        {!nested && (
          <button className="chip-add small" onClick={() => set([...current.items, { match: 'any', items: [newCondition(firstKind, objectsOf(project, subjectOf(firstKind).type)[0]?.id ?? '')] }])}>
            + Group
          </button>
        )}
      </div>
    </div>
  );
};

/** What happens: set a state, give or take an item, move an arc, solve a puzzle, fire a trigger. */
export const EffectsEditor = ({ project, effects, onChange, label }: {
  project: Project;
  effects: Effect[] | undefined;
  onChange: (effects: Effect[] | undefined) => void;
  label: string;
}) => {
  const list = effects ?? [];
  const set = (next: Effect[]) => onChange(next.length ? next : undefined);
  return (
    <div className="rule">
      <div className="rule-head">
        <span className="rule-label">{label}</span>
        <span className="rule-says">{describeEffects(project, effects)}</span>
      </div>
      {list.map((effect, i) => {
        const kind = effectKindOf(effect.kind);
        const targets = objectsOf(project, kind.type, effect.kind);
        const change = (e: Effect) => set(list.map((x, j) => (j === i ? e : x)));
        return (
          <div key={i} className={`rule-row${effect.ref && !project.objects[effect.ref] ? ' broken' : ''}`}>
            <select
              className="inp"
              aria-label="Effect"
              value={effect.kind}
              onChange={(e) => {
                const next = e.currentTarget.value as Effect['kind'];
                change(newEffect(next, objectsOf(project, effectKindOf(next).type, next)[0]?.id ?? ''));
              }}
            >
              {EFFECTS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
            <select className="inp" aria-label={kind.label} value={effect.ref} onChange={(e) => change({ ...effect, ref: e.currentTarget.value } as Effect)}>
              {!effect.ref && <option value="">Choose…</option>}
              {effect.ref && !project.objects[effect.ref] && <option value={effect.ref}>(deleted)</option>}
              {targets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {effect.kind === 'setFlag' && isText(project, effect.ref) && (
              <input key={effect.value} className="inp" aria-label="To" placeholder="Text" defaultValue={effect.value} onBlur={(e) => change({ ...effect, value: e.currentTarget.value })} />
            )}
            {kind.value === 'states' && 'value' in effect && !(effect.kind === 'setFlag' && isText(project, effect.ref)) && (
              <select className="inp" aria-label="To" value={effect.value} onChange={(e) => change({ ...effect, value: e.currentTarget.value } as Effect)}>
                <option value="">Choose…</option>
                {statesOf(project.objects[effect.ref]).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {kind.value === 'number' && (effect.kind === 'arc' || effect.kind === 'addNumber' || effect.kind === 'setNumber' || effect.kind === 'reputation') && (
              <input key={effect.amount} className="inp num" type="number" aria-label={effect.kind === 'setNumber' ? 'To' : 'By'} defaultValue={effect.amount} onBlur={(e) => change({ ...effect, amount: Number(e.currentTarget.value) || 0 })} />
            )}
            <button className="icon-btn small" aria-label="Remove effect" onClick={() => set(list.filter((_, j) => j !== i))}>
              ×
            </button>
          </div>
        );
      })}
      <div className="rule-add">
        <button
          className="chip-add small"
          onClick={() => {
            const kind: Effect['kind'] = objectsOf(project, 'state').length ? 'setFlag' : 'arc';
            set([...list, newEffect(kind, objectsOf(project, effectKindOf(kind).type)[0]?.id ?? '')]);
          }}
        >
          + Effect
        </button>
      </div>
    </div>
  );
};

/** What an option does once picked, and whether it hides while it can't be picked (spec §14). */
export const OptionBehaviourEditor = ({ value, onChange, canHide = true }: {
  value: OptionBehaviour;
  onChange: (patch: OptionBehaviour) => void;
  /** The main option has no conditions, so it is never hidden for them. */
  canHide?: boolean;
}) => (
  <div className="rule option-behaviour">
    <div className="rule-head">
      <span className="rule-label">After it’s picked</span>
    </div>
    <select className="inp" aria-label="After it’s picked" value={value.after ?? ''} onChange={(e) => onChange({ after: (e.currentTarget.value || undefined) as OptionBehaviour['after'] })}>
      <option value="">Stays on offer</option>
      <option value="gone">Disappears</option>
      <option value="locked">Stays, but can’t be picked again</option>
    </select>
    {canHide && (
      <label className="option-hide">
        <input type="checkbox" checked={!!value.hideUnavailable} onChange={(e) => onChange({ hideUnavailable: e.currentTarget.checked })} />
        Hidden until its conditions are met (else shown greyed)
      </label>
    )}
  </div>
);
