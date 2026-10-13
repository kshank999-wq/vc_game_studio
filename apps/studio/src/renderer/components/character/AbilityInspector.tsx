import { ABILITY_CATEGORIES, ACTION_CONDITIONS, ACTION_EFFECTS, ACTION_TIMINGS, abilityTemplate, actionProblems, describeAction, RESOURCES, TARGETS, type AbilityCategory, type AbilityParams, type AbilityTarget, type ActionCondition, type ActionEffect, type ActionTiming, type CustomAction, type Resource } from '../../model/character/abilities';
import { defaultsOf, grayboxOf, newAction, overrideAbility, paramsOf, updateAbility, type AbilityCard } from '../../model/character/profile';
import type { Project } from '../../model/types';
import { Field } from '../puzzle/Field';
import { NumberField } from './NumberField';

interface Props {
  project: Project;
  characterId: string;
  card: AbilityCard;
  onCommit: (p: Project) => void;
  onClose: () => void;
  onOpenBible: (id?: string) => void;
}

const TEXTS: { key: keyof AbilityParams; label: string; placeholder: string }[] = [
  { key: 'unlock', label: 'Unlocks', placeholder: 'At rank 2, or after the Forge quest' },
  { key: 'cue', label: 'Animation cue', placeholder: 'cast' },
  { key: 'vfx', label: 'VFX placeholder', placeholder: 'fireball' },
  { key: 'sfx', label: 'SFX placeholder', placeholder: 'whoosh' },
  { key: 'failure', label: 'When it can’t be used', placeholder: 'Out of mana: a fizzle, nothing else' },
  { key: 'aiUse', label: 'When an AI uses it', placeholder: 'Target in range and below half health' },
];

const NUMBERS: { key: 'cooldown' | 'range' | 'magnitude' | 'duration'; label: string; unit: string; max: number; step: number }[] = [
  { key: 'cooldown', label: 'Cooldown', unit: 's', max: 3600, step: 0.1 },
  { key: 'range', label: 'Range', unit: 'm', max: 1000, step: 0.5 },
  { key: 'magnitude', label: 'Magnitude', unit: '', max: 100000, step: 0.1 },
  { key: 'duration', label: 'Duration', unit: 's', max: 3600, step: 0.1 },
];

/**
 * The selected ability (spec §2 right pane, §4 detail editor): its defaults
 * with what this character overrides marked and resettable, and for a custom
 * power the typed actions it is built from (target, condition, effect,
 * timing, event): no code, every action validated.
 */
export const AbilityInspector = ({ project, characterId, card, onCommit, onClose, onOpenBible }: Props) => {
  const params = paramsOf(card);
  const base = defaultsOf(card);
  const t = card.source.kind === 'library' ? abilityTemplate(card.source.key) : undefined;
  const gb = grayboxOf(card);
  const set = (patch: Partial<AbilityParams>) => onCommit(overrideAbility(project, characterId, card.id, patch));
  const card1 = (patch: Partial<AbilityCard>) => onCommit(updateAbility(project, characterId, card.id, patch));
  const changed = (k: keyof AbilityParams) => k in card.overrides;
  const reset = (k: keyof AbilityParams) =>
    changed(k) && (
      <button className="cc-reset" title={`Back to the default: ${JSON.stringify(base[k])}`} onClick={() => set({ [k]: base[k] } as Partial<AbilityParams>)}>
        reset
      </button>
    );
  const actions = card.actions ?? [];
  const setActions = (next: CustomAction[]) => card1({ actions: next });
  const setAction = (id: string, patch: Partial<CustomAction>) => setActions(actions.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  return (
    <div className="pz-inspector cc-inspector">
      <div className="cc-sec-head">
        <span className="pz-label">{card.source.kind === 'custom' ? 'Custom power' : card.source.kind === 'skill' ? 'Skill' : 'Library ability'}</span>
        <button className="icon-btn small" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <Field label="Name" value={card.name} onCommit={(v) => v.trim() && card1({ name: v.trim() })} />
      <p className={`cc-gbnote ${gb}`}>{gb === 'working' ? `Plays in the 3D graybox. ${t?.note.replace('Plays in the 3D graybox. ', '') ?? ''}` : card.source.kind === 'library' ? t?.note : 'Kept and exported; not simulated in the studio. The engine side implements it.'}</p>
      {card.source.kind === 'skill' && (
        <button className="tb-btn small" onClick={() => onOpenBible(card.source.kind === 'skill' ? card.source.id : undefined)}>
          Open the skill (ranks, cost, effects) in the Bible
        </button>
      )}
      <div className="cc-pair">
        <label className="pz-field">
          <span className="pz-label">Category</span>
          <select className="inp small" aria-label="Category" value={card.category} onChange={(e) => card1({ category: e.target.value as AbilityCategory })}>
            {ABILITY_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="pz-field">
          <span className="pz-label">Kind</span>
          <select className="inp small" aria-label="Kind" value={card.kind} onChange={(e) => card1({ kind: e.target.value as 'active' | 'passive' })}>
            <option value="active">Active</option>
            <option value="passive">Passive</option>
          </select>
        </label>
        <NumberField label="Rank" unit="" min={1} max={99} step={1} value={card.rank} onCommit={(v) => card1({ rank: Math.round(v) })} />
      </div>
      <label className="cc-check">
        <input type="checkbox" checked={card.enabled} onChange={(e) => card1({ enabled: e.target.checked })} /> Enabled
      </label>
      <Field label="Description" multiline rows={2} value={params.description} onCommit={(v) => set({ description: v })} />
      <div className="cc-pair">
        <label className="pz-field">
          <span className="pz-label">Costs {reset('cost')}</span>
          <select className="inp small" aria-label="Cost resource" value={params.cost.resource} onChange={(e) => set({ cost: { ...params.cost, resource: e.target.value as Resource } })}>
            {RESOURCES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {params.cost.resource !== 'none' && <NumberField label="Amount" unit="pts" min={0} max={100000} step={1} value={params.cost.amount} onCommit={(v) => set({ cost: { ...params.cost, amount: v } })} />}
        <label className="pz-field">
          <span className="pz-label">Target {reset('target')}</span>
          <select className="inp small" aria-label="Target" value={params.target} onChange={(e) => set({ target: e.target.value as AbilityTarget })}>
            {TARGETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="cc-pair">
        {NUMBERS.map((n) => (
          <div key={n.key} className={changed(n.key) ? 'cc-tuned' : undefined}>
            <NumberField label={n.label} unit={n.unit} min={0} max={n.max} step={n.step} value={params[n.key]} onCommit={(v) => set({ [n.key]: v })} />
            {reset(n.key)}
          </div>
        ))}
      </div>
      {TEXTS.map((x) => (
        <div key={x.key} className={changed(x.key) ? 'cc-tuned' : undefined}>
          <Field label={x.label} value={String(params[x.key] ?? '')} placeholder={x.placeholder} onCommit={(v) => set({ [x.key]: v.trim() })} />
          {reset(x.key)}
        </div>
      ))}

      {card.source.kind === 'custom' && (
        <section className="pz-sec" aria-label="Actions">
          <div className="cc-sec-head">
            <span className="pz-label">Actions</span>
            <button className="tb-btn small" onClick={() => setActions([...actions, newAction()])}>
              + Action
            </button>
          </div>
          {actions.map((a, i) => {
            const problems = actionProblems(a);
            const cond = ACTION_CONDITIONS.find((c) => c.id === a.condition);
            const effect = ACTION_EFFECTS.find((e) => e.id === a.effect);
            return (
              <div key={a.id} className={`cc-action${problems.length ? ' broken' : ''}`} aria-label={`Action ${i + 1}`}>
                <div className="cc-pair">
                  <label className="pz-field">
                    <span className="pz-label">Effect</span>
                    <select className="inp small" aria-label={`Action ${i + 1} effect`} value={a.effect} onChange={(e) => setAction(a.id, { effect: e.target.value as ActionEffect })}>
                      {ACTION_EFFECTS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {effect?.unit && <NumberField label={`Action ${i + 1} amount`} unit={effect.unit} min={0} max={100000} step={1} value={a.amount} onCommit={(v) => setAction(a.id, { amount: v })} />}
                  <label className="pz-field">
                    <span className="pz-label">On</span>
                    <select className="inp small" aria-label={`Action ${i + 1} target`} value={a.target} onChange={(e) => setAction(a.id, { target: e.target.value as AbilityTarget })}>
                      {TARGETS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="cc-pair">
                  <label className="pz-field">
                    <span className="pz-label">When</span>
                    <select className="inp small" aria-label={`Action ${i + 1} condition`} value={a.condition} onChange={(e) => setAction(a.id, { condition: e.target.value as ActionCondition, conditionValue: '' })}>
                      {ACTION_CONDITIONS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {cond && cond.takes !== 'none' && (
                    <Field label={cond.takes === 'percent' ? 'Percent' : cond.id === 'hasItem' ? 'Item' : 'Flag'} value={a.conditionValue ?? ''} onCommit={(v) => setAction(a.id, { conditionValue: v.trim() })} />
                  )}
                  <label className="pz-field">
                    <span className="pz-label">Timing</span>
                    <select className="inp small" aria-label={`Action ${i + 1} timing`} value={a.timing} onChange={(e) => setAction(a.id, { timing: e.target.value as ActionTiming })}>
                      {ACTION_TIMINGS.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {a.timing !== 'instant' && <NumberField label={`Action ${i + 1} seconds`} unit="s" min={0} max={3600} step={0.1} value={a.seconds} onCommit={(v) => setAction(a.id, { seconds: v })} />}
                </div>
                <Field label="Sends event" value={a.event} placeholder="orc_roared" onCommit={(v) => setAction(a.id, { event: v.trim() })} />
                <p className="pz-says">{describeAction(a)}</p>
                {problems.map((p) => (
                  <p key={p} className="pz-issue error">
                    ✕ {p}
                  </p>
                ))}
                <button className="tb-btn small" aria-label={`Remove action ${i + 1}`} onClick={() => setActions(actions.filter((x) => x.id !== a.id))}>
                  Remove
                </button>
              </div>
            );
          })}
          <p className="pref-hint">Actions are typed and checked, never code. An engine-specific code hook belongs in the engine’s own scripts, in the custom-code regions the handoff keeps.</p>
        </section>
      )}
    </div>
  );
};
