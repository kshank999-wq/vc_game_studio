import { countLabel, limitsOf, METRICS } from '../../model/level/budget';
import { updateMap } from '../../model/level/hierarchy';
import { levelsOf } from '../../model/level/level';
import { DEFAULT_PLAN, streamLayout } from '../../model/level/streaming';
import type { AssetDefinition } from '../../model/level/types';
import type { Project } from '../../model/types';
import { BoolField, NumberField, Section } from './fields';

/**
 * A level's streaming plan (spec §19 world partition): whether it is cut into
 * cells, how big they are, how far round the player they stay loaded, and
 * what that costs at its worst against the budget. The 2D map draws the grid.
 */
export const StreamingSection = ({ project, levelId, global, open, onToggle, onCommit }: { project: Project; levelId: string; global: readonly AssetDefinition[]; open: boolean; onToggle: () => void; onCommit: (p: Project) => void }) => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId)!;
  const plan = level.streaming;
  const layout = plan ? streamLayout(project, levelId, global) : null;
  const limits = level.budget ? limitsOf(level.budget) : null;
  const names = new Map(set.items.map((i) => [i.id, i.name]));
  const commit = (patch: Partial<typeof DEFAULT_PLAN>) => plan && onCommit(updateMap(project, levelId, { streaming: { ...plan, ...patch } }));
  return (
    <Section title="Streaming" open={open} onToggle={onToggle} count={layout ? layout.cells.length : undefined}>
      <BoolField label="Cut into streaming cells" value={!!plan} onCommit={(v) => onCommit(updateMap(project, levelId, { streaming: v ? { ...DEFAULT_PLAN } : undefined }))} />
      {!plan && <p className="lvl-hint">For a big map the game loads a piece at a time: plan the cells here, see what is loaded together, and hand the grid to the engine team.</p>}
      {plan && (
        <>
          <NumberField label="Cell size" value={plan.cell} min={4} step={8} hint="metres a side" onCommit={(v) => commit({ cell: Math.max(4, v) })} />
          <NumberField label="Load range" value={plan.range} min={0} step={16} hint="metres round the player" onCommit={(v) => commit({ range: Math.max(0, v) })} />
          {!layout && <p className="lvl-hint">Place something on the map to see its cells.</p>}
          {layout && (
            <>
              <p className="lvl-hint">
                {layout.cols} × {layout.rows} cells, A1 in the north-west. With the player in any cell, the cells within {plan.range} m of it are loaded, and what stays loaded everywhere.
              </p>
              <p className="lvl-hint">Loaded at once, at the worst:</p>
              {layout.worst.map((w) => {
                const m = METRICS.find((x) => x.id === w.metric)!;
                const limit = limits?.[w.metric];
                const share = limit ? w.count / limit : 0;
                return (
                  <div key={w.metric} className={`lvl-budget${share > 1 ? ' over' : share > 0.8 ? ' near' : ''}`} title={m.hint}>
                    <div className="lvl-budget-head">
                      <span>{m.label}</span>
                      <span className="mono">
                        {countLabel(w.count)}
                        {limit !== undefined ? ` / ${countLabel(limit)}` : ''}
                        <span className="muted"> · round {w.around}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
              {!limits && <p className="lvl-hint">Set a performance budget to check these against it.</p>}
              <p className="lvl-hint">
                Always loaded: {layout.always.length ? layout.always.map((id) => names.get(id) ?? id).join(', ') : 'nothing'}. Mark more in an item’s properties.
              </p>
            </>
          )}
        </>
      )}
    </Section>
  );
};

/** For an item's properties: whether it stays loaded wherever the player is. Only shown on a map with a plan. */
export const AlwaysLoadedField = ({ project, levelId, itemId, onCommit }: { project: Project; levelId: string; itemId: string; onCommit: (p: Project) => void }) => {
  const level = levelsOf(project).levels.find((l) => l.id === levelId);
  const plan = level?.streaming;
  if (!plan) return null;
  const on = (plan.always ?? []).includes(itemId);
  return (
    <BoolField
      label="Always loaded"
      hint="stays loaded wherever the player is"
      value={on}
      onCommit={(v) => {
        const always = (plan.always ?? []).filter((id) => id !== itemId);
        if (v) always.push(itemId);
        onCommit(updateMap(project, levelId, { streaming: { ...plan, ...(always.length ? { always } : { always: undefined }) } }));
      }}
    />
  );
};
