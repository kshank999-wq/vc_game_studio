import { useState } from 'react';
import { ABILITY_LIBRARY } from '../../model/character/abilities';
import { TACTICS, type Tactics } from '../../model/character/ai';
import { fitsSlot, itemsLibrary, patchVariantRules, setVariants, updateVariant, type CharacterIssue, type CharacterProfile } from '../../model/character/profile';
import { blankVariant, differencesOf, difficultyOf, encounterCost, generateVariants, resolveVariant, type EnemyVariant } from '../../model/character/variants';
import type { Project } from '../../model/types';
import { Field } from '../puzzle/Field';
import { NumberField } from './NumberField';

interface Props {
  project: Project;
  id: string;
  name: string;
  profile: CharacterProfile;
  issues: CharacterIssue[];
  onCommit: (p: Project) => void;
}

/**
 * Variants (spec §6.2): escalating versions of this enemy by level or
 * encounter tier. Generate a chain, then tune each by hand; each lists what
 * it changes beside the base, its difficulty and what a group costs of the
 * encounter budget, and everything else it inherits.
 */
export const VariantsPanel = ({ project, id, name, profile, issues, onCommit }: Props) => {
  const [count, setCount] = useState(2);
  const [growth, setGrowth] = useState(30);
  const [open, setOpen] = useState<string | null>(profile.variants[0]?.id ?? null);
  const rules = profile.variantRules;
  const set = (vid: string, patch: Partial<EnemyVariant>) => onCommit(updateVariant(project, id, vid, patch));
  const items = itemsLibrary(project);
  const baseDifficulty = difficultyOf(profile);

  return (
    <div className="cc-variants">
      {!profile.roles.includes('enemy') && <p className="cc-note">Variants are for enemy NPCs; give it the Enemy NPC role to use them.</p>}
      <section className="pz-sec" aria-label="Guardrails">
        <span className="pz-label">Guardrails</span>
        <div className="cc-stats">
          <NumberField label="Stats grow at most" unit="× base" min={1} max={20} step={0.1} value={rules.maxGrowth} onCommit={(v) => onCommit(patchVariantRules(project, id, { maxGrowth: v }))} />
          <NumberField label="Attack at once, at most" unit="" min={1} max={50} step={1} value={rules.maxAttackers} onCommit={(v) => onCommit(patchVariantRules(project, id, { maxAttackers: v }))} />
          <NumberField label="Patrol area" unit="m" min={1} max={2000} step={1} value={rules.patrolRadius} onCommit={(v) => onCommit(patchVariantRules(project, id, { patrolRadius: v }))} />
          <NumberField label="Encounter budget" unit="pts" min={1} max={10000} step={1} value={rules.spawnBudget} onCommit={(v) => onCommit(patchVariantRules(project, id, { spawnBudget: v }))} />
        </div>
        <p className="pz-says">
          {name} itself is {baseDifficulty} difficulty points. Points add up health, speed, damage, sight and skill, so variants and encounters can be compared.
        </p>
      </section>

      <section className="pz-sec" aria-label="Generate">
        <span className="pz-label">Generate a chain</span>
        <div className="cc-gen">
          <NumberField label="Tiers" unit="" min={1} max={5} step={1} value={count} onCommit={setCount} />
          <NumberField label="Growth per tier" unit="%" min={5} max={200} step={5} value={growth} onCommit={setGrowth} />
          <button
            className="tb-btn small primary"
            onClick={() => {
              const made = generateVariants(project, profile, name, count, growth / 100);
              onCommit(setVariants(project, id, [...profile.variants, ...made]));
              setOpen(made[0]?.id ?? null);
            }}
          >
            Generate {count} variant{count === 1 ? '' : 's'}
          </button>
          <button
            className="tb-btn small"
            onClick={() => {
              const v = blankVariant(`${name} variant`, profile.variants.length + 2);
              onCommit(setVariants(project, id, [...profile.variants, v]));
              setOpen(v.id);
            }}
          >
            + Blank variant
          </button>
        </div>
        <p className="pref-hint">Each tier adds health, speed and damage, ranks, sharper senses, quicker reactions and bigger groups, a better weapon from the item library when there is one, and Block from the second tier for a fighter without it, all within the guardrails. Tune them after.</p>
      </section>

      {profile.variants.map((v) => {
        const resolved = resolveVariant(profile, v);
        const diffs = differencesOf(project, profile, v);
        const cost = encounterCost(profile, v);
        const mine = issues.filter((i) => i.ref === v.id);
        const isOpen = open === v.id;
        const hand = resolved.inventory.equipment.find((e) => e.slot === 'Hand');
        return (
          <div key={v.id} className={`cc-variant${isOpen ? ' open' : ''}${mine.some((i) => i.severity === 'error') ? ' broken' : ''}`}>
            <button className="cc-topic-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : v.id)}>
              <strong>{v.name}</strong>
              <span className="muted">
                tier {v.tier} · levels {v.levels.min}–{v.levels.max} · {difficultyOf(resolved)} pts{v.groupSize > 1 ? ` · groups of ${v.groupSize} = ${cost}` : ''} of {rules.spawnBudget}
              </span>
              <span className={`cc-budget${cost > rules.spawnBudget ? ' over' : ''}`} aria-hidden="true">
                <span style={{ width: `${Math.min(100, (cost / rules.spawnBudget) * 100)}%` }} />
              </span>
            </button>
            {isOpen && (
              <div className="cc-topic-body">
                <div className="cc-stats">
                  <Field label="Name" value={v.name} onCommit={(x) => x.trim() && set(v.id, { name: x.trim() })} />
                  <NumberField label="Tier" unit="" min={1} max={99} step={1} value={v.tier} onCommit={(x) => set(v.id, { tier: x })} />
                  <NumberField label="From level" unit="" min={1} max={999} step={1} value={v.levels.min} onCommit={(x) => set(v.id, { levels: { ...v.levels, min: x } })} />
                  <NumberField label="To level" unit="" min={1} max={999} step={1} value={v.levels.max} onCommit={(x) => set(v.id, { levels: { ...v.levels, max: x } })} />
                  <NumberField label="Health" unit="pts" min={1} max={1e6} step={1} value={resolved.stats.health} onCommit={(x) => set(v.id, { stats: { ...v.stats, health: x } })} />
                  <NumberField label="Speed" unit="m/s" min={0} max={30} step={0.1} value={resolved.stats.speed} onCommit={(x) => set(v.id, { stats: { ...v.stats, speed: x } })} />
                  <NumberField label="Damage" unit="×" min={0.1} max={20} step={0.1} value={v.damage} onCommit={(x) => set(v.id, { damage: x })} />
                  <NumberField label="Group size" unit="" min={1} max={50} step={1} value={v.groupSize} onCommit={(x) => set(v.id, { groupSize: x })} />
                  <NumberField label="Sight distance" unit="m" min={0} max={200} step={0.5} value={resolved.ai.viewDistance} onCommit={(x) => set(v.id, { ai: { ...v.ai, viewDistance: x } })} />
                  <NumberField label="Reaction time" unit="s" min={0} max={10} step={0.1} value={resolved.ai.reaction} onCommit={(x) => set(v.id, { ai: { ...v.ai, reaction: x } })} />
                  <NumberField label="Disengage distance" unit="m" min={0} max={1000} step={1} value={resolved.ai.disengageDistance} onCommit={(x) => set(v.id, { ai: { ...v.ai, disengageDistance: x } })} />
                  <label className="pz-field">
                    <span className="pz-label">Tactics</span>
                    <select className="inp small" aria-label="Variant tactics" value={resolved.ai.tactics} onChange={(e) => set(v.id, { ai: { ...v.ai, tactics: e.target.value as Tactics } })}>
                      {TACTICS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="pz-field">
                    <span className="pz-label">In hand</span>
                    <select className="inp small" aria-label="Variant hand slot" value={hand?.item ?? ''} onChange={(e) => set(v.id, { equipment: [...v.equipment.filter((x) => x.slot !== 'Hand'), { slot: 'Hand', ...(e.target.value ? { item: e.target.value } : {}) }] })}>
                      <option value="">Empty</option>
                      {items
                        .filter((it) => fitsSlot(project, it.id, 'Hand'))
                        .map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <span className="pz-label">Abilities</span>
                <div className="cc-states">
                  {profile.abilities.map((a) => {
                    const has = !v.remove.includes(a.id);
                    return (
                      <label key={a.id} className={`cc-state-chip${has ? ' on' : ''}`}>
                        <input type="checkbox" checked={has} onChange={() => set(v.id, { remove: has ? [...v.remove, a.id] : v.remove.filter((x) => x !== a.id) })} /> {a.name}
                        {has && (
                          <input
                            type="number"
                            className="cc-rank"
                            aria-label={`${a.name} rank`}
                            min={1}
                            max={99}
                            value={v.ranks[a.id] ?? a.rank}
                            onChange={(e) => set(v.id, { ranks: { ...v.ranks, [a.id]: Math.max(1, Number(e.target.value) || 1) } })}
                          />
                        )}
                      </label>
                    );
                  })}
                  {v.add.map((key) => (
                    <label key={key} className="cc-state-chip on added">
                      <input type="checkbox" checked onChange={() => set(v.id, { add: v.add.filter((x) => x !== key) })} /> {ABILITY_LIBRARY.find((a) => a.key === key)?.name ?? key} <span className="muted">added</span>
                    </label>
                  ))}
                  <select className="inp small" aria-label="Add an ability to the variant" value="" onChange={(e) => e.target.value && set(v.id, { add: [...v.add, e.target.value] })}>
                    <option value="">+ Ability…</option>
                    {ABILITY_LIBRARY.filter((a) => !v.add.includes(a.key) && !profile.abilities.some((c) => c.source.kind === 'library' && c.source.key === a.key)).map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="pz-label">What it changes ({diffs.length}); everything else is {name}’s</span>
                <table className="cc-table" aria-label={`${v.name} differences`}>
                  <tbody>
                    {diffs.map((d, i) => (
                      <tr key={i}>
                        <td>{d.label}</td>
                        <td className="muted">{d.base}</td>
                        <td>→ {d.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Field label="Notes" value={v.notes} onCommit={(x) => set(v.id, { notes: x.trim() })} />
                {mine.length > 0 && (
                  <ul className="pz-issues">
                    {mine.map((i, n) => (
                      <li key={n} className={`pz-issue ${i.severity}`}>
                        {i.severity === 'error' ? '✕' : '!'} {i.text}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="cc-row-tools">
                  <button
                    className="tb-btn small"
                    onClick={() => {
                      const copy = { ...structuredClone(v), id: blankVariant('', 0).id, name: `${v.name} copy` };
                      onCommit(setVariants(project, id, [...profile.variants, copy]));
                      setOpen(copy.id);
                    }}
                  >
                    Duplicate
                  </button>
                  <button className="tb-btn small" onClick={() => onCommit(setVariants(project, id, profile.variants.filter((x) => x.id !== v.id)))}>
                    Remove {v.name}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
