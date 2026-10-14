import { levelsOf } from '../../model/level/level';
import { addBasement, addRoof, floorKindOf, isStructure, STRUCTURE_PRESETS, TRAVERSAL_STYLES, updateStructure } from '../../model/level/structure';
import type { StructureType, TraversalStyle } from '../../model/level/types';
import type { Project } from '../../model/types';
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
