import type { Condition, Effect, Rule } from '../rules';
import type { LevelItem, LevelRule, LevelSet, ParamValue } from './types';

/**
 * What a level item points at in the story, and cleaning that up when a story
 * element is deleted. Kept free of the rest of the level model so the story's
 * own delete can use it.
 */

const conditions = (rule: Rule | undefined): Condition[] =>
  !rule ? [] : rule.items.flatMap((i) => ('match' in i ? conditions(i) : [i]));

/** Every story element an item refers to: its links, ref parameters, rules and conditions. */
export const referencesOf = (item: LevelItem, refKeys: readonly string[] = []): string[] => {
  const out = new Set<string>(item.links ?? []);
  for (const key of refKeys) {
    const v = item.params?.[key];
    if (typeof v === 'string' && v) out.add(v);
  }
  for (const c of conditions(item.activeWhen)) if (c.ref) out.add(c.ref);
  for (const r of item.rules ?? []) {
    for (const c of conditions(r.when)) if (c.ref) out.add(c.ref);
    for (const e of r.effects ?? []) if (e.ref) out.add(e.ref);
    for (const a of r.actions ?? []) if (a.target) out.add(a.target);
  }
  return [...out];
};

const dropFromRule = (rule: Rule | undefined, id: string): Rule | undefined => {
  if (!rule) return rule;
  const items = rule.items
    .map((i) => ('match' in i ? dropFromRule(i, id) : i.ref === id ? undefined : i))
    .filter((i): i is Rule | Condition => !!i);
  return { ...rule, items };
};

/**
 * A story element was deleted: items stop linking to it. Ref parameters that
 * named it are cleared (the item stays and validation says it needs one).
 * Conditions and effects that named it go too.
 */
export const dropStoryLinks = (set: LevelSet | undefined, id: string): LevelSet | undefined => {
  if (!set) return set;
  let changed = false;
  const items = set.items.map((item) => {
    const params = item.params && Object.values(item.params).includes(id)
      ? Object.fromEntries(Object.entries(item.params).map(([k, v]): [string, ParamValue] => [k, v === id ? '' : v]))
      : item.params;
    const links = item.links?.includes(id) ? item.links.filter((l) => l !== id) : item.links;
    const touches = referencesOf(item).includes(id);
    if (params === item.params && links === item.links && !touches) return item;
    changed = true;
    const rules = item.rules?.map((r): LevelRule => ({
      ...r,
      when: dropFromRule(r.when, id),
      effects: r.effects?.filter((e: Effect) => e.ref !== id),
      actions: r.actions?.filter((a) => a.target !== id),
    }));
    return { ...item, params, links, activeWhen: dropFromRule(item.activeWhen, id), rules };
  });
  const levels = set.levels.map((l) => (l.links?.includes(id) ? ((changed = true), { ...l, links: l.links.filter((x) => x !== id) }) : l));
  return changed ? { ...set, items, levels } : set;
};
