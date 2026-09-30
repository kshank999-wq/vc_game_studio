import { describeRule, evaluate, isEmpty, type Effect, type PlayState, type Rule } from './rules';
import type { Project, StoryObject } from './types';

/**
 * Skills, abilities and upgrades (spec §8). Each is learned in ranks, up to
 * its ranks, within an unlock tree: a rank needs the skills it names first
 * (learned), its rule to hold, and its cost paid (so many of an item: skill
 * points, salvage, coins; an item is a progression track of its own). What
 * learning it does (its effects) happens with every rank. A rank can also be
 * given by an effect, free, still only up to its ranks. Conditions ask a
 * skill's rank, so anything in the story can depend on it. The engines apply
 * the same rules in the same order.
 */

export type SkillKind = 'Skill' | 'Ability' | 'Upgrade';

export interface SkillCost {
  /** The inventory item it costs. */
  item: string;
  amount: number;
}

export const ranksOf = (o: StoryObject): number => Math.max(1, Math.round(Number(o.data.ranks ?? 1)) || 1);
export const costOf = (o: StoryObject): SkillCost | undefined => {
  const c = o.data.cost as SkillCost | undefined;
  return c?.item && c.amount > 0 ? c : undefined;
};
export const requiresOf = (o: StoryObject): string[] => ((o.data.requires as string[] | undefined) ?? []).filter(Boolean);
export const treeOf = (o: StoryObject): string => String(o.data.tree ?? '').trim();
export const kindOf = (o: StoryObject): SkillKind => (['Skill', 'Ability', 'Upgrade'].includes(String(o.data.kind)) ? (o.data.kind as SkillKind) : 'Skill');

/** Every skill, by tree (named trees first, A–Z), then by code. */
export const skillsOf = (project: Project): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'skill')
    .sort((a, b) => {
      const ta = treeOf(a);
      const tb = treeOf(b);
      if (ta !== tb) return !ta ? 1 : !tb ? -1 : ta.localeCompare(tb);
      return (a.data.code ?? a.name).localeCompare(b.data.code ?? b.name, undefined, { numeric: true });
    });

export const rankIn = (state: Pick<PlayState, 'skills'>, id: string): number => state.skills?.[id] ?? 0;

export interface LearnCheck {
  ok: boolean;
  rank: number;
  ranks: number;
  /** Why not, in words: the first thing in the way (fully learned; a skill first; the rule; the cost). */
  needs?: string;
}

const name = (project: Project, id: string) => project.objects[id]?.name ?? 'a skill no longer in the story';

/** Whether the next rank of a skill can be learned now, and why not. */
export const learnCheck = (project: Project, state: PlayState, id: string): LearnCheck => {
  const skill = project.objects[id];
  if (!skill || skill.type !== 'skill') return { ok: false, rank: 0, ranks: 0, needs: 'Not a skill.' };
  const rank = rankIn(state, id);
  const ranks = ranksOf(skill);
  const no = (needs: string): LearnCheck => ({ ok: false, rank, ranks, needs });
  if (rank >= ranks) return no(ranks > 1 ? `All ${ranks} ranks learned.` : 'Learned.');
  const missing = requiresOf(skill).filter((r) => rankIn(state, r) < 1);
  if (missing.length) return no(`Learn ${missing.map((r) => name(project, r)).join(' and ')} first.`);
  const rule = skill.data.rule as Rule | undefined;
  if (!isEmpty(rule) && !evaluate(rule, state)) return no(`Needs ${describeRule(project, rule)}.`);
  const cost = costOf(skill);
  if (cost && (state.items[cost.item] ?? 0) < cost.amount) return no(`Costs ${cost.amount} × ${name(project, cost.item)} (you have ${state.items[cost.item] ?? 0}).`);
  return { ok: true, rank, ranks };
};

/** A skill's cost in words ("2 × Salvage"), or "Free". */
export const describeCost = (project: Project, o: StoryObject): string => {
  const cost = costOf(o);
  return cost ? `${cost.amount} × ${name(project, cost.item)}` : 'Free';
};

/** Paying for a rank: the cost taken from what is carried. */
export const payFor = (project: Project, state: PlayState, id: string): Record<string, number> => {
  const skill = project.objects[id];
  const cost = skill ? costOf(skill) : undefined;
  if (!cost) return state.items;
  return { ...state.items, [cost.item]: Math.max(0, (state.items[cost.item] ?? 0) - cost.amount) };
};

/** What learning a skill does, each rank. */
export const skillEffects = (o: StoryObject): Effect[] | undefined => o.data.effects as Effect[] | undefined;
