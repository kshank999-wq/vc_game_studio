import { recipeOf, type Recipe } from '../../model/crafting';
import { setValue } from '../../model/details';
import type { Rule } from '../../model/rules';
import type { Project, StoryObject } from '../../model/types';
import { RuleEditor } from '../rules/RuleEditor';

/** An item's recipe (spec §8): the ingredients it takes, how many one craft makes, and when it can be crafted. */
export const RecipeEditor = ({ object, project, onCommit }: { object: StoryObject; project: Project; onCommit: (p: Project) => void }) => {
  const r = recipeOf(object);
  const set = (patch: Partial<Recipe> | null) => onCommit(setValue(project, object.id, 'recipe', patch === null ? undefined : { ...(r ?? { ingredients: [], makes: 1 }), ...patch }));
  const items = Object.values(project.objects).filter((o) => o.type === 'inventory' && o.id !== object.id).sort((a, b) => a.name.localeCompare(b.name));
  const unused = items.filter((i) => !r?.ingredients.some((x) => x.item === i.id));
  return (
    <div className="equipment-editor">
      <label className="check">
        <input type="checkbox" checked={!!r} onChange={(ev) => set(ev.currentTarget.checked ? {} : null)} /> Can be crafted
        <span className="pref-hint">from other items</span>
      </label>
      {r && (
        <>
          <div className="dfld">
            <span>Takes</span>
            {r.ingredients.map((i, n) => (
              <div key={i.item} className="equipment-stat">
                <input className="inp small equipment-number" type="number" min={1} aria-label={`How many ${project.objects[i.item]?.name ?? ''}`} value={i.amount} onChange={(ev) => set({ ingredients: r.ingredients.map((x, j) => (j === n ? { ...x, amount: Math.max(1, Number(ev.currentTarget.value) || 1) } : x)) })} />
                <span className="muted">×</span>
                <span className="detail-text">{project.objects[i.item]?.name ?? 'a missing item'}</span>
                <button className="icon-btn small" aria-label={`Doesn't take ${project.objects[i.item]?.name ?? 'it'}`} onClick={() => set({ ingredients: r.ingredients.filter((_, j) => j !== n) })}>
                  ×
                </button>
              </div>
            ))}
            {unused.length > 0 && (
              <select className="inp small" aria-label="Add an ingredient" value="" onChange={(ev) => ev.currentTarget.value && set({ ingredients: [...r.ingredients, { item: ev.currentTarget.value, amount: 1 }] })}>
                <option value="">+ Ingredient</option>
                {unused.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <label className="dfld">
            <span>One craft makes</span>
            <input className="inp small equipment-number" type="number" min={1} aria-label="Makes" value={r.makes} onChange={(ev) => set({ makes: Math.max(1, Number(ev.currentTarget.value) || 1) })} />
          </label>
          <RuleEditor project={project} rule={r.rule} label="Can be crafted when (empty: any time)" onChange={(rule: Rule | undefined) => set({ rule })} />
        </>
      )}
    </div>
  );
};
