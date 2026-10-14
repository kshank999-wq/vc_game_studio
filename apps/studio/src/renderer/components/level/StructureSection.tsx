import { assetOf } from '../../model/level/geometry';
import { guid, levelsOf } from '../../model/level/level';
import { addBasement, addRoof, floorCodes, floorKindOf, isStructure, STRUCTURE_PRESETS, TRAVERSAL_STYLES, updateStructure } from '../../model/level/structure';
import type { AssetDefinition, PersistRule, StructureObjective, StructurePersist, StructureType, TraversalStyle } from '../../model/level/types';
import type { Project } from '../../model/types';
import { EffectsEditor, RuleEditor } from '../rules/RuleEditor';
import { NumberField, RefField, Section, SelectField, TextField } from './fields';

/**
 * A structure's settings (structure spec §5, §10, §13): what it is and what it
 * is for, who made it, its tags, how its floors are reached (the validator
 * walks the structure graph with it), the generator's seed, and the scene it
 * plays as; and a basement or a roof to add. A plain building map can be
 * made a structure from here.
 */
export const StructureSection = ({ project, levelId, open, onToggle, onCommit, onFloor }: { project: Project; levelId: string; open: boolean; onToggle: () => void; onCommit: (p: Project) => void; onFloor: (id: string) => void }) => {
  const level = levelsOf(project).levels.find((l) => l.id === levelId);
  if (!level || !isStructure(level)) return null;
  const s = level.structure;
  const set = (patch: Parameters<typeof updateStructure>[2]) => onCommit(updateStructure(project, levelId, patch));
  const hasRoof = level.floors.some((f) => floorKindOf(f) === 'roof');
  return (
    <Section title="Structure" open={open} onToggle={onToggle}>
      {!s ? (
        <>
          <p className="pref-hint">A building map. Make it a structure to say what it is, how its floors are reached, and to see its structure graph checked.</p>
          <button className="tb-btn small" onClick={() => set({ type: 'custom' })}>
            Make it a structure
          </button>
        </>
      ) : (
        <>
          <SelectField label="Structure type" value={s.type} options={STRUCTURE_PRESETS.map((p) => ({ value: p.id, label: p.label }))} onCommit={(v) => set({ type: v as StructureType })} />
          <TextField label="Purpose" value={s.purpose} placeholder="What it is for in the game" onCommit={(v) => set({ purpose: v })} />
          <SelectField label="Between floors" hint={TRAVERSAL_STYLES.find((t) => t.id === s.traversal)?.hint} value={s.traversal} options={TRAVERSAL_STYLES.map((t) => ({ value: t.id, label: t.label }))} onCommit={(v) => set({ traversal: v as TraversalStyle })} />
          <RefField project={project} label="Plays as scene" value={s.scene ?? ''} types={['scene']} onCommit={(v) => set({ scene: v })} />
          <TextField label="Tags" value={s.tags.join(', ')} placeholder="ancient, act 2" onCommit={(v) => set({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} />
          <TextField label="Author" value={s.author} onCommit={(v) => set({ author: v.trim() })} />
          <NumberField label="Seed" hint="For the generator: the same seed gives the same layout." value={s.seed} step={1} min={1} onCommit={(v) => set({ seed: Math.max(1, Math.round(v)) })} />
        </>
      )}
      <div className="lvl-structure-actions">
        <button
          className="tb-btn small"
          onClick={() => {
            const made = addBasement(project, levelId);
            onCommit(made.project);
            onFloor(made.id);
          }}
        >
          + Basement
        </button>
        {!hasRoof && (
          <button
            className="tb-btn small"
            onClick={() => {
              const made = addRoof(project, levelId);
              onCommit(made.project);
              onFloor(made.id);
            }}
          >
            + Roof
          </button>
        )}
      </div>
    </Section>
  );
};

const PERSIST: { key: keyof StructurePersist; label: string; hint: string }[] = [
  { key: 'doors', label: 'Doors', hint: 'Opened, unlocked, found and broken doors' },
  { key: 'items', label: 'Items', hint: 'Pickups taken' },
  { key: 'enemies', label: 'Enemies', hint: 'Who was spawned, where they are, who is down' },
  { key: 'puzzles', label: 'Puzzles', hint: 'Puzzles solved here, and the structure’s own states' },
];

const AT_ROLES = new Set(['objective', 'interaction', 'puzzle', 'pickup', 'inventory', 'weapon', 'npc', 'enemy', 'companion', 'neutral', 'trigger', 'portal', 'door']);

/**
 * The structure as a scene of its own (structure spec §10): what the player
 * is there to do, in order (each done in a room or at an item, or when a
 * condition holds); when it is complete, and what that does to the story
 * outside; which story states are its own (local) rather than the world's;
 * and what it remembers when the player leaves and comes back.
 */
export const StructureSceneSection = ({ project, levelId, global, open, onToggle, onCommit }: { project: Project; levelId: string; global: readonly AssetDefinition[]; open: boolean; onToggle: () => void; onCommit: (p: Project) => void }) => {
  const set = levelsOf(project);
  const level = set.levels.find((l) => l.id === levelId);
  if (!level?.structure) return null;
  const s = level.structure;
  const commit = (patch: Parameters<typeof updateStructure>[2]) => onCommit(updateStructure(project, levelId, patch));
  const objectives = s.objectives ?? [];
  const setObjectives = (next: StructureObjective[]) => commit({ objectives: next });
  const patchObjective = (id: string, patch: Partial<StructureObjective>) => setObjectives(objectives.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const codes = floorCodes(level);
  const places = set.items
    .filter((i) => i.levelId === levelId && !i.hidden && (assetOf(set, i, global).kind === 'space' || AT_ROLES.has(assetOf(set, i, global).role)))
    .map((i) => ({ value: i.id, label: `${i.name} (${codes.get(i.floorId) ?? '?'})`, space: assetOf(set, i, global).kind === 'space' }))
    .sort((a, b) => Number(b.space) - Number(a.space) || a.label.localeCompare(b.label));
  const persist: StructurePersist = { doors: 'keep', items: 'keep', enemies: 'keep', puzzles: 'keep', ...s.persist };
  const states = Object.values(project.objects).filter((o) => o.type === 'state').sort((a, b) => a.name.localeCompare(b.name));
  const local = new Set(s.localStates ?? []);
  return (
    <Section title="As a scene" open={open} onToggle={onToggle} count={objectives.length || undefined}>
      <p className="pref-hint">What the player comes here to do, when it is done, and what the structure remembers between visits.</p>
      <div className="lvl-objectives" aria-label="Objectives">
        {objectives.map((o, n) => (
          <div key={o.id} className="lvl-objective">
            <span className="lvl-objective-n">{n + 1}</span>
            <input className="inp small" aria-label={`Objective ${n + 1}`} defaultValue={o.text} placeholder="What to do" onBlur={(e) => e.target.value.trim() !== o.text && patchObjective(o.id, { text: e.target.value.trim() || o.text })} />
            <select className="inp small" aria-label={`Where objective ${n + 1} is done`} value={o.at ?? ''} onChange={(e) => patchObjective(o.id, { at: e.target.value || undefined })}>
              <option value="">Anywhere (by its condition)</option>
              {o.at && !places.some((p) => p.value === o.at) && <option value={o.at}>(no longer here)</option>}
              {places.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.space ? '' : '· '}
                  {p.label}
                </option>
              ))}
            </select>
            <label className="lvl-check" title="Not needed to complete the structure">
              <input type="checkbox" aria-label={`Objective ${n + 1} is optional`} checked={!!o.optional} onChange={(e) => patchObjective(o.id, { optional: e.target.checked || undefined })} />
              <span>Optional</span>
            </label>
            <button className="icon-btn small" aria-label={`Remove objective ${n + 1}`} onClick={() => setObjectives(objectives.filter((x) => x.id !== o.id))}>
              ×
            </button>
            {!o.at && <RuleEditor project={project} rule={o.when} label="Done when" onChange={(when) => patchObjective(o.id, { when })} />}
          </div>
        ))}
        <button className="chip-add small" onClick={() => setObjectives([...objectives, { id: guid(), text: `Objective ${objectives.length + 1}` }])}>
          + Objective
        </button>
      </div>
      <RuleEditor project={project} rule={s.completeWhen} label="Complete when (empty: every objective that isn’t optional is done)" onChange={(completeWhen) => commit({ completeWhen })} />
      <EffectsEditor project={project} effects={s.onComplete} label="When it is complete, outside" onChange={(onComplete) => commit({ onComplete })} />
      <div className="lvl-field wide">
        <span className="lvl-flabel" title="Local states go back to how the story starts them whenever the structure's puzzles reset. Every other state is the world's.">
          Its own states (local)
        </span>
        {states.length ? (
          <div className="lvl-chips" role="group" aria-label="Local states">
            {states.map((st) => (
              <label key={st.id} className={`lvl-chip${local.has(st.id) ? ' on' : ''}`}>
                <input type="checkbox" checked={local.has(st.id)} onChange={(e) => commit({ localStates: e.target.checked ? [...local, st.id] : [...local].filter((x) => x !== st.id) })} />
                {st.name}
              </label>
            ))}
          </div>
        ) : (
          <span className="muted">No story states yet. Every state is the world’s.</span>
        )}
      </div>
      <span className="lvl-flabel">Coming back in</span>
      {PERSIST.map((p) => (
        <SelectField
          key={p.key}
          label={p.label}
          hint={p.hint}
          value={persist[p.key]}
          options={[
            { value: 'keep', label: 'As the player left them' },
            { value: 'reset', label: 'Reset each visit' },
          ]}
          onCommit={(v) => commit({ persist: { ...persist, [p.key]: v as PersistRule } })}
        />
      ))}
    </Section>
  );
};
