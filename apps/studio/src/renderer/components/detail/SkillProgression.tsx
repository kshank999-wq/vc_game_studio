import { setValue } from '../../model/details';
import { costOf, ranksOf, requiresOf, skillsOf, treeOf } from '../../model/skills';
import type { Project, StoryObject } from '../../model/types';

/** A skill's progression (spec §8): how many ranks, what a rank costs, and what must be learned first. */
export const SkillProgression = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => {
  const cost = costOf(object);
  const items = Object.values(project.objects).filter((o) => o.type === 'inventory').sort((a, b) => a.name.localeCompare(b.name));
  const others = skillsOf(project).filter((o) => o.id !== object.id);
  const requires = requiresOf(object);
  const setCost = (item: string, amount: number) => onCommit(setValue(project, object.id, 'cost', item && amount > 0 ? { item, amount } : undefined));
  return (
    <div className="skill-progression">
      <label className="dfld">
        <span>Ranks</span>
        <input className="inp small skill-ranks" type="number" min={1} max={20} aria-label="Ranks" value={ranksOf(object)} onChange={(e) => onCommit(setValue(project, object.id, 'ranks', Math.max(1, Math.min(20, Number(e.currentTarget.value) || 1))))} />
      </label>
      <div className="dfld">
        <span>Each rank costs</span>
        <div className="skill-cost">
          <input className="inp small skill-amount" type="number" min={1} aria-label="Cost amount" value={cost?.amount ?? 1} disabled={!cost} onChange={(e) => setCost(cost!.item, Math.max(1, Number(e.currentTarget.value) || 1))} />
          <span className="muted">×</span>
          <select className="inp small" aria-label="Cost item" value={cost?.item ?? ''} onChange={(e) => setCost(e.currentTarget.value, cost?.amount ?? 1)}>
            <option value="">Nothing (free)</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        {!items.length && <span className="pref-hint">Add an inventory item (skill points, salvage, coins) to price a rank with it.</span>}
      </div>
      <div className="dfld">
        <span>Learn first</span>
        <div className="tag-list">
          {requires.map((r) => (
            <span key={r} className="tag on">
              {project.objects[r]?.name ?? 'a missing skill'}
              <button className="icon-btn small" aria-label={`Doesn't need ${project.objects[r]?.name ?? 'it'}`} onClick={() => onCommit(setValue(project, object.id, 'requires', requires.filter((x) => x !== r)))}>
                ×
              </button>
            </span>
          ))}
          {others.some((o) => !requires.includes(o.id)) && (
            <select className="inp small" aria-label="Add a skill to learn first" value="" onChange={(e) => e.currentTarget.value && onCommit(setValue(project, object.id, 'requires', [...requires, e.currentTarget.value]))}>
              <option value="">+ Skill</option>
              {others
                .filter((o) => !requires.includes(o.id))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {treeOf(o) ? ` (${treeOf(o)})` : ''}
                  </option>
                ))}
            </select>
          )}
          {!requires.length && !others.length && <span className="pref-hint">Nothing: it is the first in its tree.</span>}
        </div>
      </div>
    </div>
  );
};

