import { describeRule, evaluate, isEmpty, type PlayState, type Rule } from './rules';
import type { Project, StoryObject } from './types';

/**
 * Crafting (spec §8). An inventory item can have a recipe: the ingredients it
 * takes (so many of each item), how many one craft makes, and when it can be
 * crafted (a rule, such as being at the camp, or a skill learned). Crafting
 * uses up the ingredients and gives what it makes. The engines apply the
 * same rules and say why not in the same words.
 */

export interface Ingredient {
  item: string;
  amount: number;
}

export interface Recipe {
  ingredients: Ingredient[];
  makes: number;
  rule?: Rule;
}

export const recipeOf = (o: StoryObject | undefined): Recipe | undefined => {
  if (!o || o.type !== 'inventory') return undefined;
  const r = o.data.recipe as Partial<Recipe> | undefined;
  if (!r) return undefined;
  return {
    ingredients: (r.ingredients ?? []).filter((i) => i?.item).map((i) => ({ item: i.item, amount: Math.max(1, Math.round(Number(i.amount)) || 1) })),
    makes: Math.max(1, Math.round(Number(r.makes ?? 1)) || 1),
    ...(r.rule && !isEmpty(r.rule) ? { rule: r.rule } : {}),
  };
};

/** Every item with a recipe, by name. */
export const recipesOf = (project: Project): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => recipeOf(o))
    .sort((a, b) => a.name.localeCompare(b.name));

const name = (project: Project, id: string) => project.objects[id]?.name ?? 'something no longer in the story';

/** A recipe in words: "1 × Salvage → 2 × Flare". */
export const describeRecipe = (project: Project, o: StoryObject): string => {
  const r = recipeOf(o);
  if (!r) return '';
  const takes = r.ingredients.map((i) => `${i.amount} × ${name(project, i.item)}`).join(' + ') || 'nothing';
  return `${takes} → ${r.makes} × ${o.name}`;
};

/** Why an item can't be crafted now ("" when it can): no recipe, its rule, or the first ingredient short. */
export const craftCheck = (project: Project, state: PlayState, id: string): string => {
  const r = recipeOf(project.objects[id]);
  if (!r) return 'Not craftable.';
  if (r.rule && !evaluate(r.rule, state)) return `Needs ${describeRule(project, r.rule)}.`;
  for (const i of r.ingredients) {
    const have = state.items[i.item] ?? 0;
    if (have < i.amount) return `Needs ${i.amount} × ${name(project, i.item)} (you have ${have}).`;
  }
  return '';
};
