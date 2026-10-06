import { laneSequence, spineSequence } from './layout';
import { initialState } from './details';
import { conditionsIn, everyRule, type Effect } from './rules';
import type { Project } from './types';

/**
 * Checks that look across the whole story rather than at one node (Game
 * Studio spec §15, Writer spec §11): content nothing on the way from the
 * Beginning leads to, a state the story waits for that nothing ever sets, an
 * item it needs that the player can never get, effects that undo each other,
 * and setups that are never paid off. Each issue is on the element to fix.
 */

export interface DeepIssue {
  id: string;
  message: string;
}

/** Effects of the given kinds anywhere in the project, levels included (their rules hold effects too). */
const allEffects = (project: Project): Effect[] => {
  const out: Effect[] = everyRule(project).flatMap((r) => r.effects ?? []);
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      const v = value as { kind?: unknown; ref?: unknown };
      if (typeof v.kind === 'string' && typeof v.ref === 'string' && 'ref' in v) out.push(v as Effect);
      Object.values(value).forEach(walk);
    }
  };
  walk(project.levels);
  return out;
};

/** Branches and alternate routes nothing on the way from the Beginning leads to (they may lead to each other). */
const unreachable = (project: Project): DeepIssue[] => {
  const start = new Set([...spineSequence(project), ...project.lanes.filter((l) => l.kind === 'subplot').flatMap((l) => laneSequence(project, l.id))]);
  const next = new Map<string, string[]>();
  for (const c of project.connections) {
    if (c.kind === 'contains' || c.kind === 'arcEvent' || c.kind === 'references') continue;
    (next.get(c.sourceId) ?? next.set(c.sourceId, []).get(c.sourceId)!).push(c.targetId);
  }
  const seen = new Set(start);
  const queue = [...start];
  while (queue.length) for (const to of next.get(queue.shift()!) ?? []) if (!seen.has(to)) (seen.add(to), queue.push(to));
  const hasIncoming = new Set(project.connections.filter((c) => c.kind !== 'contains' && c.kind !== 'arcEvent').map((c) => c.targetId));
  return Object.entries(project.placements)
    .filter(([id, p]) => p.laneId === null && hasIncoming.has(id) && !seen.has(id) && project.objects[id] && project.objects[id]!.type !== 'arcEvent')
    .map(([id]) => ({ id, message: 'Unreachable: it is only reached from other branches that nothing on the way from the Beginning leads to.' }));
};

/** A state value the story waits for that nothing ever sets (and it doesn't start with). */
const unsetValues = (project: Project, effects: Effect[]): DeepIssue[] => {
  const set = new Map<string, Set<string>>();
  for (const e of effects) if (e.kind === 'setFlag' || e.kind === 'setObject') (set.get(e.ref) ?? set.set(e.ref, new Set()).get(e.ref)!).add(e.value);
  const issues: DeepIssue[] = [];
  const reported = new Set<string>();
  for (const { rule } of everyRule(project)) {
    for (const c of conditionsIn(rule)) {
      if ((c.kind !== 'flag' && c.kind !== 'object') || c.op !== 'is' || !c.value) continue;
      const target = project.objects[c.ref];
      if (!target || initialState(target) === c.value || set.get(c.ref)?.has(c.value)) continue;
      const key = `${c.ref}:${c.value}`;
      if (reported.has(key)) continue;
      reported.add(key);
      issues.push({ id: c.ref, message: `The story waits for “${target.name}” to be “${c.value}”, but nothing ever sets it to that.` });
    }
  }
  return issues;
};

/** An item a condition needs that the player can never get: nothing gives it, it has no recipe, and no level places it. */
const unobtainable = (project: Project, effects: Effect[]): DeepIssue[] => {
  const given = new Set(effects.filter((e) => e.kind === 'give').map((e) => e.ref));
  const inLevels = JSON.stringify(project.levels ?? {});
  const pickedUp = new Set(project.connections.filter((c) => c.kind === 'contains' && c.use?.here === 'Picked up').map((c) => c.targetId));
  const issues: DeepIssue[] = [];
  const reported = new Set<string>();
  for (const { rule } of everyRule(project)) {
    for (const c of conditionsIn(rule)) {
      if (c.kind !== 'item' || c.op !== 'has' || reported.has(c.ref)) continue;
      const item = project.objects[c.ref];
      // A recipe (crafting.ts) is enough: the item can be made.
      if (!item || given.has(c.ref) || item.data.recipe || pickedUp.has(c.ref) || inLevels.includes(`"${c.ref}"`)) continue;
      reported.add(c.ref);
      issues.push({ id: c.ref, message: `The story needs “${item.name}”, but the player can never get it: nothing gives it, it has no recipe, and no level places it.` });
    }
  }
  return issues;
};

/** One set of effects that undoes itself: a state set to two values, an item given and taken, equipped and put away. */
const conflicts = (project: Project): DeepIssue[] => {
  const issues: DeepIssue[] = [];
  for (const { effects, owner, where } of everyRule(project)) {
    if (!effects || effects.length < 2) continue;
    const values = new Map<string, Set<string>>();
    const kinds = new Map<string, Set<string>>();
    for (const e of effects) {
      if (e.kind === 'setFlag' || e.kind === 'setObject') (values.get(e.ref) ?? values.set(e.ref, new Set()).get(e.ref)!).add(e.value);
      (kinds.get(e.ref) ?? kinds.set(e.ref, new Set()).get(e.ref)!).add(e.kind);
    }
    const clash = [...values.entries()].find(([, v]) => v.size > 1)?.[0] ?? [...kinds.entries()].find(([, k]) => (k.has('give') && k.has('take')) || (k.has('equip') && k.has('unequip')))?.[0];
    if (clash) issues.push({ id: owner, message: `In ${where}, the effects on “${project.objects[clash]?.name ?? 'something'}” undo each other.` });
  }
  return issues;
};

/** A setup with nowhere it pays off (Writer spec §11: unconsumed setup/payoff). */
const unpaid = (project: Project): DeepIssue[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'theme' && o.data.kind === 'Setup / payoff' && String(o.data.setUp ?? '').trim() && !String(o.data.paidOff ?? '').trim())
    .map((o) => ({ id: o.id, message: 'Set up but never paid off: say where it pays off, or cut the setup.' }));

export const deepIssues = (project: Project): DeepIssue[] => {
  const effects = allEffects(project);
  return [...unreachable(project), ...unsetValues(project, effects), ...unobtainable(project, effects), ...conflicts(project), ...unpaid(project)];
};
