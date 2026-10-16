import { updateMap } from '../../model/level/hierarchy';
import { levelsOf, updateItem } from '../../model/level/level';
import { assetOf } from '../../model/level/geometry';
import { DEFAULT_NETWORK, defaultReplication, networkLayout, REPLICATIONS, type Replication } from '../../model/level/network';
import type { AssetDefinition } from '../../model/level/types';
import type { Project } from '../../model/types';
import { BoolField, NumberField, Section, SelectField, TextField } from './fields';

const label = (r: Replication) => REPLICATIONS.find((x) => x.id === r)!.label;

/**
 * A map's multiplayer plan (spec §19): how many play at once, their teams,
 * where each team comes in, and how many things each player has to see the
 * same. Each item says what the network does with it in its own properties.
 */
export const MultiplayerSection = ({ project, levelId, global, open, onToggle, onCommit }: { project: Project; levelId: string; global: readonly AssetDefinition[]; open: boolean; onToggle: () => void; onCommit: (p: Project) => void }) => {
  const level = levelsOf(project).levels.find((l) => l.id === levelId)!;
  const plan = level.network;
  const layout = plan ? networkLayout(project, levelId, global) : null;
  const commit = (patch: Partial<typeof DEFAULT_NETWORK>) => plan && onCommit(updateMap(project, levelId, { network: { ...plan, ...patch } }));
  return (
    <Section title="Multiplayer" open={open} onToggle={onToggle} count={layout ? layout.plan.players : undefined}>
      <BoolField label="Plan for multiplayer" value={!!plan} onCommit={(v) => onCommit(updateMap(project, levelId, { network: v ? { ...DEFAULT_NETWORK } : undefined }))} />
      {!plan && <p className="lvl-hint">For a map several people play at once: say how many and in which teams, where each comes in, and what every player has to see the same. The engine team builds the networking from it.</p>}
      {plan && layout && (
        <>
          <NumberField label="Players" value={plan.players} min={1} step={1} hint="at once, at most" onCommit={(v) => commit({ players: Math.max(1, Math.round(v)) })} />
          <TextField
            label="Teams"
            value={(plan.teams ?? []).join(', ')}
            placeholder="none: everyone for themselves"
            onCommit={(v) => {
              const teams = [...new Set(v.split(',').map((t) => t.trim()).filter(Boolean))];
              commit({ teams: teams.length ? teams : undefined });
            }}
          />
          <p className="lvl-hint">
            {layout.plan.teams
              ? layout.plan.teams.map((t) => `${t}: ${layout.spawns.filter((s) => s.team === t).length} starts`).join(' · ')
              : `${layout.spawns.length} player ${layout.spawns.length === 1 ? 'start' : 'starts'} for ${plan.players} players`}
            . Give each player start its team in its properties.
          </p>
          <p className="lvl-hint">{REPLICATIONS.map((r) => `${r.label}: ${layout.items.filter((i) => i.replicate === r.id).length}`).join(' · ')}</p>
        </>
      )}
    </Section>
  );
};

/** For an item's properties, on a map planned for multiplayer: what the network does with it, and a player start's team. */
export const NetworkFields = ({ project, itemId, global, onCommit }: { project: Project; itemId: string; global: readonly AssetDefinition[]; onCommit: (p: Project) => void }) => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  const plan = item && set.levels.find((l) => l.id === item.levelId)?.network;
  if (!item || !plan) return null;
  const fallback = defaultReplication(set, item, global);
  const net = item.net ?? {};
  const put = (patch: typeof net) => {
    const next = { ...net, ...patch };
    const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== ''));
    onCommit(updateItem(project, item.id, { net: Object.keys(clean).length ? clean : undefined }, global));
  };
  const isStart = assetOf(set, item, global).role === 'playerStart';
  return (
    <>
      <SelectField
        label="Network"
        value={net.replicate ?? ''}
        hint={REPLICATIONS.find((r) => r.id === (net.replicate ?? fallback))!.hint}
        overridden={!!net.replicate}
        onReset={() => put({ replicate: undefined })}
        options={[{ value: '', label: `Default (${label(fallback)})` }, ...REPLICATIONS.map((r) => ({ value: r.id, label: r.label }))]}
        onCommit={(v) => put({ replicate: (v || undefined) as Replication | undefined })}
      />
      {isStart && plan.teams?.length ? (
        <SelectField label="Team" value={net.team ?? ''} options={[{ value: '', label: 'No team' }, ...plan.teams.map((t) => ({ value: t, label: t })), ...(net.team && !plan.teams.includes(net.team) ? [{ value: net.team, label: `${net.team} (not a team here)` }] : [])]} onCommit={(v) => put({ team: v || undefined })} />
      ) : null}
    </>
  );
};
