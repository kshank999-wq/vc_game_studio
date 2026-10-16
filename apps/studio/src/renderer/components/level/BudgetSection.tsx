import { countLabel, limitsOf, METRICS, PLATFORMS, tallyOf } from '../../model/level/budget';
import { updateMap } from '../../model/level/hierarchy';
import { levelsOf } from '../../model/level/level';
import type { AssetDefinition } from '../../model/level/types';
import type { Project } from '../../model/types';
import { NumberField, Section, SelectField } from './fields';

/**
 * A level's performance budget (spec §19): the platform it is made for, its
 * limits (the platform's, or set by hand), and what the level and this floor
 * cost now against them, as bars. Over budget shows in the preflight too.
 */
export const BudgetSection = ({ project, levelId, floorId, global, open, onToggle, onCommit }: { project: Project; levelId: string; floorId: string; global: readonly AssetDefinition[]; open: boolean; onToggle: () => void; onCommit: (p: Project) => void }) => {
  const level = levelsOf(project).levels.find((l) => l.id === levelId)!;
  const budget = level.budget;
  const total = budget ? tallyOf(project, levelId, undefined, global) : null;
  const here = budget && level.floors.length > 1 ? tallyOf(project, levelId, floorId, global) : null;
  const limits = budget ? limitsOf(budget) : null;
  const preset = budget ? limitsOf({ platform: budget.platform }) : null;
  const over = total && limits ? METRICS.filter((m) => total.counts[m.id] > limits[m.id]).length : 0;
  return (
    <Section title="Performance budget" open={open} onToggle={onToggle} count={over || undefined}>
      <SelectField
        label="Made for"
        value={budget?.platform ?? ''}
        options={[{ value: '', label: 'No budget' }, ...PLATFORMS.map((p) => ({ value: p.id, label: p.label }))]}
        onCommit={(v) => onCommit(updateMap(project, levelId, { budget: v ? { platform: v, ...(budget?.limits ? { limits: budget.limits } : {}) } : undefined }))}
      />
      {!budget && <p className="lvl-hint">Pick a platform to see what this level costs against its budget, and to have the preflight warn when it goes over.</p>}
      {budget && total && limits && preset && (
        <>
          <p className="lvl-hint">Estimates from the graybox, the people in it and its walkable cells. The engine team gets the budget and the counts, and profiles the real level.</p>
          {METRICS.map((m) => {
            const count = total.counts[m.id];
            const share = limits[m.id] > 0 ? count / limits[m.id] : 0;
            return (
              <div key={m.id} className={`lvl-budget${share > 1 ? ' over' : share > 0.8 ? ' near' : ''}`} title={m.hint}>
                <div className="lvl-budget-head">
                  <span>{m.label}</span>
                  <span className="mono">
                    {countLabel(count)} / {countLabel(limits[m.id])}
                    {here ? <span className="muted"> · this floor {countLabel(here.counts[m.id])}</span> : null}
                  </span>
                </div>
                <div className="lvl-budget-bar" role="meter" aria-label={`${m.label}: ${countLabel(count)} of ${countLabel(limits[m.id])}`} aria-valuemin={0} aria-valuemax={limits[m.id]} aria-valuenow={count}>
                  <span style={{ width: `${Math.min(100, share * 100)}%` }} />
                </div>
                <NumberField
                  label="Limit"
                  value={limits[m.id]}
                  min={0}
                  step={1}
                  hint={budget.limits?.[m.id] !== undefined ? 'set by hand' : `the ${PLATFORMS.find((p) => p.id === budget.platform)?.label}’s`}
                  onCommit={(v) => {
                    const { [m.id]: _was, ...rest } = budget.limits ?? {};
                    const next = v === preset[m.id] ? rest : { ...rest, [m.id]: v };
                    onCommit(updateMap(project, levelId, { budget: { platform: budget.platform, ...(Object.keys(next).length ? { limits: next } : {}) } }));
                  }}
                />
              </div>
            );
          })}
        </>
      )}
    </Section>
  );
};
