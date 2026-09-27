import { statesOf } from '../../model/details';
import {
  EFFECTS,
  SUBJECTS,
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
import type { ObjectType, Project } from '../../model/types';

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

const objectsOf = (project: Project, type: ObjectType) =>
  Object.values(project.objects)
    .filter((o) => o.type === type)
    .sort((a, b) => a.name.localeCompare(b.name));

const valueChoices = (project: Project, ref: string, kind: 'states' | 'options'): string[] =>
  kind === 'states' ? statesOf(project.objects[ref]) : choiceOptions(project, ref);

const ConditionRow = ({ project, condition, onChange, onRemove }: { project: Project; condition: Condition; onChange: (c: Condition) => void; onRemove: () => void }) => {
  const subject = subjectOf(condition.kind);
  const targets = objectsOf(project, subject.type);
  const missing = condition.ref && !project.objects[condition.ref];
  return (
    <div className={`rule-row${missing ? ' broken' : ''}`}>
      <select
        className="inp"
        aria-label="About"
        value={condition.kind}
        onChange={(e) => onChange(newCondition(e.currentTarget.value as Condition['kind'], objectsOf(project, subjectOf(e.currentTarget.value as Condition['kind']).type)[0]?.id ?? ''))}
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
      {(subject.value === 'states' || subject.value === 'options') && 'value' in condition && (
        <select className="inp" aria-label="Value" value={String(condition.value)} onChange={(e) => onChange({ ...condition, value: e.currentTarget.value } as Condition)}>
          <option value="">{subject.value === 'options' ? 'any option' : 'Choose…'}</option>
          {valueChoices(project, condition.ref, subject.value).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
      {subject.value === 'number' && condition.kind === 'arc' && (
        <input
          key={condition.value}
          className="inp num"
          type="number"
          aria-label="Arc value"
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
        const targets = objectsOf(project, kind.type);
        const change = (e: Effect) => set(list.map((x, j) => (j === i ? e : x)));
        return (
          <div key={i} className={`rule-row${effect.ref && !project.objects[effect.ref] ? ' broken' : ''}`}>
            <select
              className="inp"
              aria-label="Effect"
              value={effect.kind}
              onChange={(e) => change(newEffect(e.currentTarget.value as Effect['kind'], objectsOf(project, effectKindOf(e.currentTarget.value as Effect['kind']).type)[0]?.id ?? ''))}
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
            {kind.value === 'states' && 'value' in effect && (
              <select className="inp" aria-label="To" value={effect.value} onChange={(e) => change({ ...effect, value: e.currentTarget.value } as Effect)}>
                <option value="">Choose…</option>
                {statesOf(project.objects[effect.ref]).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
            {kind.value === 'number' && effect.kind === 'arc' && (
              <input key={effect.amount} className="inp num" type="number" aria-label="By" defaultValue={effect.amount} onBlur={(e) => change({ ...effect, amount: Number(e.currentTarget.value) || 0 })} />
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
