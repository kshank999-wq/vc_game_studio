import type { ObjectType, Project } from './types';

/**
 * Conditions and effects (spec §18). A rule is structured, never code: a
 * group of conditions, all or any of which must hold; groups nest. Effects
 * are what happens when something fires or is chosen. The same rules drive
 * the timeline, choices, gates, triggers and the generated engine code.
 */

export type Condition =
  | { kind: 'flag'; ref: string; op: 'is' | 'isNot'; value: string }
  | { kind: 'item'; ref: string; op: 'has' | 'hasNot' }
  | { kind: 'object'; ref: string; op: 'is' | 'isNot'; value: string }
  | { kind: 'choice'; ref: string; op: 'chose' | 'didNotChoose'; value: string }
  | { kind: 'arc'; ref: string; op: 'atLeast' | 'atMost'; value: number }
  | { kind: 'puzzle'; ref: string; op: 'solved' | 'unsolved' }
  | { kind: 'visited'; ref: string; op: 'visited' | 'notVisited' }
  | { kind: 'quest'; ref: string; op: 'done' | 'notDone' | 'active' | 'notStarted' }
  | { kind: 'lore'; ref: string; op: 'known' | 'unknown' }
  | { kind: 'mechanic'; ref: string; op: 'available' | 'unavailable' }
  /** A skill's rank: at least n (learned: at least 1), or below n (not learned: below 1). */
  | { kind: 'skill'; ref: string; op: 'atLeast' | 'below'; value: number }
  /** An item of equipment, in its slot or not. */
  | { kind: 'equipped'; ref: string; op: 'equipped' | 'notEquipped' }
  /** What the equipped items add up to for a stat (ref is the stat's name, such as Damage): at least n, or below n. */
  | { kind: 'stat'; ref: string; op: 'atLeast' | 'below'; value: number }
  /** A number state (spec §7: health, trust, coins): at least n, below n, or exactly n. */
  | { kind: 'number'; ref: string; op: 'atLeast' | 'below' | 'equals'; value: number }
  /** A faction's standing with the player (spec §7: reputation tracks), 0 to begin with. */
  | { kind: 'reputation'; ref: string; op: 'atLeast' | 'below'; value: number }
  /** A fight's result (spec §7, combat events): won, or come to at all. */
  | { kind: 'encounter'; ref: string; op: 'won' | 'notWon' | 'met' | 'notMet' };

export interface Rule {
  match: 'all' | 'any';
  items: (Condition | Rule)[];
}

export type Effect =
  | { kind: 'setFlag'; ref: string; value: string }
  | { kind: 'give'; ref: string }
  | { kind: 'take'; ref: string }
  | { kind: 'setObject'; ref: string; value: string }
  | { kind: 'arc'; ref: string; amount: number }
  | { kind: 'solve'; ref: string }
  | { kind: 'fire'; ref: string }
  | { kind: 'startQuest'; ref: string }
  | { kind: 'revealLore'; ref: string }
  | { kind: 'completeQuest'; ref: string }
  | { kind: 'enableMechanic'; ref: string }
  /** A rank of a skill, given: nothing paid, nothing needed first. */
  | { kind: 'learnSkill'; ref: string }
  /** Put an item of equipment in its slot (if it is carried), or take it out. */
  | { kind: 'equip'; ref: string }
  | { kind: 'unequip'; ref: string }
  /** A number state, raised (or lowered, with a negative amount) or set outright. */
  | { kind: 'addNumber'; ref: string; amount: number }
  | { kind: 'setNumber'; ref: string; amount: number }
  /** A faction's standing, raised or (with a negative amount) lowered. */
  | { kind: 'reputation'; ref: string; amount: number };

export const isRule = (x: Condition | Rule): x is Rule => 'match' in x;

export const emptyRule = (): Rule => ({ match: 'all', items: [] });

/** A rule with nothing in it always holds. */
export const isEmpty = (rule: Rule | undefined): boolean => !rule || rule.items.every((i) => (isRule(i) ? isEmpty(i) : false));

// ---------------------------------------------------------------- what a condition can be about

export interface Subject {
  kind: Condition['kind'];
  label: string;
  /** The element type the condition points at. */
  type: ObjectType;
  ops: { op: string; label: string }[];
  /** How the value is chosen: from the element's states, a choice's options, a number, or none. */
  value: 'states' | 'options' | 'number' | 'none';
}

export const SUBJECTS: readonly Subject[] = [
  { kind: 'flag', label: 'State', type: 'state', ops: [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }], value: 'states' },
  { kind: 'item', label: 'Item', type: 'inventory', ops: [{ op: 'has', label: 'is carried' }, { op: 'hasNot', label: 'is not carried' }], value: 'none' },
  { kind: 'object', label: 'Object', type: 'object', ops: [{ op: 'is', label: 'is' }, { op: 'isNot', label: 'is not' }], value: 'states' },
  { kind: 'choice', label: 'Choice', type: 'choice', ops: [{ op: 'chose', label: 'was answered' }, { op: 'didNotChoose', label: 'was not answered' }], value: 'options' },
  { kind: 'arc', label: 'Character arc', type: 'character', ops: [{ op: 'atLeast', label: 'is at least' }, { op: 'atMost', label: 'is at most' }], value: 'number' },
  { kind: 'puzzle', label: 'Puzzle', type: 'puzzle', ops: [{ op: 'solved', label: 'is solved' }, { op: 'unsolved', label: 'is not solved' }], value: 'none' },
  {
    kind: 'quest',
    label: 'Quest',
    type: 'quest',
    ops: [
      { op: 'done', label: 'is done' },
      { op: 'notDone', label: 'is not done' },
      { op: 'active', label: 'is under way' },
      { op: 'notStarted', label: 'has not started' },
    ],
    value: 'none',
  },
  { kind: 'lore', label: 'Lore', type: 'lore', ops: [{ op: 'known', label: 'is known' }, { op: 'unknown', label: 'is not known' }], value: 'none' },
  { kind: 'mechanic', label: 'Mechanic', type: 'mechanic', ops: [{ op: 'available', label: 'is available' }, { op: 'unavailable', label: 'is not available' }], value: 'none' },
  { kind: 'skill', label: 'Skill', type: 'skill', ops: [{ op: 'atLeast', label: 'is at rank at least' }, { op: 'below', label: 'is below rank' }], value: 'number' },
  { kind: 'number', label: 'Number', type: 'state', ops: [{ op: 'atLeast', label: 'is at least' }, { op: 'below', label: 'is below' }, { op: 'equals', label: 'is exactly' }], value: 'number' },
  { kind: 'reputation', label: 'Reputation', type: 'faction', ops: [{ op: 'atLeast', label: 'is at least' }, { op: 'below', label: 'is below' }], value: 'number' },
  { kind: 'stat', label: 'Stat', type: 'inventory', ops: [{ op: 'atLeast', label: 'is at least' }, { op: 'below', label: 'is below' }], value: 'number' },
  {
    kind: 'encounter',
    label: 'Encounter',
    type: 'encounter',
    ops: [
      { op: 'won', label: 'was won' },
      { op: 'notWon', label: 'was not won' },
      { op: 'met', label: 'was fought' },
      { op: 'notMet', label: 'was not fought' },
    ],
    value: 'none',
  },
  { kind: 'equipped', label: 'Equipment', type: 'inventory', ops: [{ op: 'equipped', label: 'is equipped' }, { op: 'notEquipped', label: 'is not equipped' }], value: 'none' },
  { kind: 'visited', label: 'Scene', type: 'scene', ops: [{ op: 'visited', label: 'was visited' }, { op: 'notVisited', label: 'was not visited' }], value: 'none' },
];

export interface EffectKind {
  kind: Effect['kind'];
  label: string;
  type: ObjectType;
  value: 'states' | 'number' | 'none';
}

export const EFFECTS: readonly EffectKind[] = [
  { kind: 'setFlag', label: 'Set state', type: 'state', value: 'states' },
  { kind: 'give', label: 'Give item', type: 'inventory', value: 'none' },
  { kind: 'take', label: 'Take item', type: 'inventory', value: 'none' },
  { kind: 'setObject', label: 'Set object', type: 'object', value: 'states' },
  { kind: 'arc', label: 'Move arc', type: 'character', value: 'number' },
  { kind: 'solve', label: 'Solve puzzle', type: 'puzzle', value: 'none' },
  { kind: 'fire', label: 'Fire trigger', type: 'trigger', value: 'none' },
  { kind: 'startQuest', label: 'Start quest', type: 'quest', value: 'none' },
  { kind: 'completeQuest', label: 'Complete quest', type: 'quest', value: 'none' },
  { kind: 'revealLore', label: 'Reveal lore', type: 'lore', value: 'none' },
  { kind: 'enableMechanic', label: 'Make mechanic available', type: 'mechanic', value: 'none' },
  { kind: 'learnSkill', label: 'Give a skill rank', type: 'skill', value: 'none' },
  { kind: 'equip', label: 'Equip item', type: 'inventory', value: 'none' },
  { kind: 'unequip', label: 'Put item away', type: 'inventory', value: 'none' },
  { kind: 'addNumber', label: 'Add to number', type: 'state', value: 'number' },
  { kind: 'setNumber', label: 'Set number', type: 'state', value: 'number' },
  { kind: 'reputation', label: 'Change reputation', type: 'faction', value: 'number' },
];

export const subjectOf = (kind: Condition['kind']): Subject => SUBJECTS.find((s) => s.kind === kind)!;
export const effectKindOf = (kind: Effect['kind']): EffectKind => EFFECTS.find((e) => e.kind === kind)!;

/** A fresh condition about an element, with its first operator and value. */
export const newCondition = (kind: Condition['kind'], ref = '', value = ''): Condition => {
  switch (kind) {
    case 'flag':
    case 'object':
      return { kind, ref, op: 'is', value };
    case 'item':
      return { kind, ref, op: 'has' };
    case 'choice':
      return { kind, ref, op: 'chose', value };
    case 'arc':
      return { kind, ref, op: 'atLeast', value: Number(value) || 1 };
    case 'puzzle':
      return { kind, ref, op: 'solved' };
    case 'visited':
      return { kind, ref, op: 'visited' };
    case 'quest':
      return { kind, ref, op: 'done' };
    case 'lore':
      return { kind, ref, op: 'known' };
    case 'mechanic':
      return { kind, ref, op: 'available' };
    case 'skill':
      return { kind, ref, op: 'atLeast', value: Number(value) || 1 };
    case 'equipped':
      return { kind, ref, op: 'equipped' };
    case 'stat':
      return { kind, ref, op: 'atLeast', value: Number(value) || 1 };
    case 'number':
      return { kind, ref, op: 'atLeast', value: Number(value) || 0 };
    case 'reputation':
      return { kind, ref, op: 'atLeast', value: Number(value) || 1 };
    case 'encounter':
      return { kind, ref, op: 'won' };
  }
};

export const newEffect = (kind: Effect['kind'], ref = '', value = ''): Effect => {
  switch (kind) {
    case 'setFlag':
    case 'setObject':
      return { kind, ref, value };
    case 'arc':
    case 'addNumber':
    case 'reputation':
      return { kind, ref, amount: Number(value) || 1 };
    case 'setNumber':
      return { kind, ref, amount: Number(value) || 0 };
    default:
      return { kind, ref };
  }
};

// ---------------------------------------------------------------- reading

const nameOf = (project: Project, id: string) => project.objects[id]?.name ?? '(missing)';

export const describeCondition = (project: Project, c: Condition): string => {
  const who = nameOf(project, c.ref);
  switch (c.kind) {
    case 'flag':
    case 'object':
      return `${who} ${c.op === 'is' ? 'is' : 'is not'} ${c.value || '…'}`;
    case 'item':
      return `${who} ${c.op === 'has' ? 'is carried' : 'is not carried'}`;
    case 'choice':
      return `${c.op === 'chose' ? 'chose' : 'did not choose'} ${c.value ? `“${c.value}” at ` : ''}${who}`;
    case 'arc':
      return `${who}’s arc ${c.op === 'atLeast' ? '≥' : '≤'} ${c.value}`;
    case 'puzzle':
      return `${who} is ${c.op === 'solved' ? 'solved' : 'not solved'}`;
    case 'visited':
      return `${who} was ${c.op === 'visited' ? '' : 'not '}visited`;
    case 'quest':
      return `${who} ${{ done: 'is done', notDone: 'is not done', active: 'is under way', notStarted: 'has not started' }[c.op]}`;
    case 'lore':
      return `${who} is ${c.op === 'known' ? '' : 'not '}known`;
    case 'mechanic':
      return `${who} is ${c.op === 'available' ? '' : 'not '}available`;
    case 'equipped':
      return `${who} is ${c.op === 'equipped' ? '' : 'not '}equipped`;
    case 'stat':
      return `${c.ref || '…'} is ${c.op === 'atLeast' ? 'at least' : 'below'} ${c.value}`;
    case 'number':
      return `${who} ${c.op === 'atLeast' ? '≥' : c.op === 'below' ? '<' : '='} ${c.value}`;
    case 'reputation':
      return `standing with ${who} ${c.op === 'atLeast' ? '≥' : '<'} ${c.value}`;
    case 'encounter':
      return `${who} ${{ won: 'was won', notWon: 'was not won', met: 'was fought', notMet: 'was not fought' }[c.op]}`;
    case 'skill':
      return c.value <= 1 ? `${who} is ${c.op === 'atLeast' ? '' : 'not '}learned` : `${who} ${c.op === 'atLeast' ? 'at rank' : 'below rank'} ${c.value}${c.op === 'atLeast' ? '+' : ''}`;
  }
};

/** A rule in words: "Vault Key is carried and door_solved is yes". */
export const describeRule = (project: Project, rule: Rule | undefined): string => {
  if (isEmpty(rule)) return 'Always';
  const parts = rule!.items.filter((i) => !(isRule(i) && isEmpty(i))).map((i) => (isRule(i) ? `(${describeRule(project, i)})` : describeCondition(project, i)));
  return parts.join(rule!.match === 'all' ? ' and ' : ' or ');
};

export const describeEffect = (project: Project, e: Effect): string => {
  const who = nameOf(project, e.ref);
  switch (e.kind) {
    case 'setFlag':
    case 'setObject':
      return `${who} → ${e.value || '…'}`;
    case 'give':
      return `give ${who}`;
    case 'take':
      return `take ${who}`;
    case 'arc':
      return `${who} ${e.amount >= 0 ? '+' : '−'}${Math.abs(e.amount)}`;
    case 'solve':
      return `solve ${who}`;
    case 'fire':
      return `fire ${who}`;
    case 'startQuest':
      return `start ${who}`;
    case 'revealLore':
      return `reveal ${who}`;
    case 'completeQuest':
      return `complete ${who}`;
    case 'enableMechanic':
      return `make ${who} available`;
    case 'learnSkill':
      return `give a rank of ${who}`;
    case 'equip':
      return `equip ${who}`;
    case 'unequip':
      return `put away ${who}`;
    case 'addNumber':
      return `${who} ${e.amount >= 0 ? '+' : '−'}${Math.abs(e.amount)}`;
    case 'setNumber':
      return `${who} = ${e.amount}`;
    case 'reputation':
      return `standing with ${who} ${e.amount >= 0 ? '+' : '−'}${Math.abs(e.amount)}`;
  }
};

export const describeEffects = (project: Project, effects: Effect[] | undefined): string =>
  effects && effects.length ? effects.map((e) => describeEffect(project, e)).join(' · ') : 'Nothing';

// ---------------------------------------------------------------- evaluating

/** What a playthrough knows at a moment: the same shape the engine runtimes keep. */
export interface PlayState {
  flags: Record<string, string>;
  items: Record<string, number>;
  objects: Record<string, string>;
  chosen: Record<string, string>;
  arcs: Record<string, number>;
  solved: Record<string, boolean>;
  visited: Record<string, boolean>;
  /** Quests under way ("active") or "done"; one not in here hasn't started. */
  quests: Record<string, QuestState>;
  /** Lore the player has come across (their codex). */
  lore: Record<string, boolean>;
  /** Mechanics the player can use now. */
  mechanics: Record<string, boolean>;
  /** Skills, abilities and upgrades learned, by rank (spec §8). */
  skills: Record<string, number>;
  /** What is equipped, by slot: an item each (spec §8). */
  equipped: Record<string, string>;
  /** How many times each item of equipment has been used, toward its durability. */
  wear: Record<string, number>;
  /** What the equipped items add up to, by stat name in lower case (kept up to date by the play-through). */
  stats?: Record<string, number>;
  /** Encounters won, and come to (the play-through keeps these; a won one counts as come to). */
  won?: Record<string, boolean>;
  met?: Record<string, boolean>;
}

export type QuestState = 'active' | 'done';

export const emptyState = (): PlayState => ({ flags: {}, items: {}, objects: {}, chosen: {}, arcs: {}, solved: {}, visited: {}, quests: {}, lore: {}, mechanics: {}, skills: {}, equipped: {}, wear: {} });

export const holds = (c: Condition, s: PlayState): boolean => {
  switch (c.kind) {
    case 'flag':
      return (s.flags[c.ref] === c.value) === (c.op === 'is');
    case 'object':
      return (s.objects[c.ref] === c.value) === (c.op === 'is');
    case 'item':
      return (s.items[c.ref] ?? 0) > 0 === (c.op === 'has');
    case 'choice': {
      const picked = s.chosen[c.ref];
      const match = c.value ? picked === c.value : picked !== undefined;
      return match === (c.op === 'chose');
    }
    case 'arc':
      return c.op === 'atLeast' ? (s.arcs[c.ref] ?? 0) >= c.value : (s.arcs[c.ref] ?? 0) <= c.value;
    case 'puzzle':
      return !!s.solved[c.ref] === (c.op === 'solved');
    case 'visited':
      return !!s.visited[c.ref] === (c.op === 'visited');
    case 'quest': {
      const state = s.quests[c.ref];
      return c.op === 'done' ? state === 'done' : c.op === 'notDone' ? state !== 'done' : c.op === 'active' ? state === 'active' : !state;
    }
    case 'lore':
      return !!s.lore[c.ref] === (c.op === 'known');
    case 'mechanic':
      return !!s.mechanics[c.ref] === (c.op === 'available');
    case 'equipped':
      return Object.values(s.equipped ?? {}).includes(c.ref) === (c.op === 'equipped');
    case 'stat': {
      const total = s.stats?.[c.ref.trim().toLowerCase()] ?? 0;
      return c.op === 'atLeast' ? total >= c.value : total < c.value;
    }
    case 'skill':
      return c.op === 'atLeast' ? (s.skills?.[c.ref] ?? 0) >= c.value : (s.skills?.[c.ref] ?? 0) < c.value;
    case 'number': {
      const n = toNumber(s.flags[c.ref]);
      return c.op === 'atLeast' ? n >= c.value : c.op === 'below' ? n < c.value : Math.abs(n - c.value) < 1e-9;
    }
    case 'encounter': {
      const won = !!s.won?.[c.ref];
      const met = won || !!s.met?.[c.ref];
      return c.op === 'won' ? won : c.op === 'notWon' ? !won : c.op === 'met' ? met : !met;
    }
    case 'reputation': {
      // Kept with the states, under the faction's own key, as a number.
      const n = toNumber(s.flags[c.ref]);
      return c.op === 'atLeast' ? n >= c.value : n < c.value;
    }
  }
};

/** A number state's value (kept as text, as every state is): 0 when it isn't one. */
export const toNumber = (value: string | undefined): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** A number as a state keeps it: "3", "2.5", never "0.30000000000000004". */
export const fromNumber = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/** Nothing left of an item: it comes out of its slot, and a new one starts unworn. */
export const dropEquipped = (s: PlayState, item: string) => {
  for (const [slot, held] of Object.entries(s.equipped)) if (held === item) delete s.equipped[slot];
  delete s.wear[item];
};

export const evaluate = (rule: Rule | undefined, s: PlayState): boolean => {
  if (!rule || rule.items.length === 0) return true;
  const results = rule.items.map((i) => (isRule(i) ? evaluate(i, s) : holds(i, s)));
  return rule.match === 'all' ? results.every(Boolean) : results.some(Boolean);
};

/** Apply effects to a state. Firing a trigger is left to the caller, which knows the trigger's own effects. */
export const apply = (effects: Effect[] | undefined, s: PlayState): PlayState => {
  const next: PlayState = { ...s, flags: { ...s.flags }, items: { ...s.items }, objects: { ...s.objects }, arcs: { ...s.arcs }, solved: { ...s.solved }, quests: { ...s.quests }, lore: { ...s.lore }, mechanics: { ...s.mechanics }, skills: { ...(s.skills ?? {}) }, equipped: { ...(s.equipped ?? {}) }, wear: { ...(s.wear ?? {}) } };
  for (const e of effects ?? []) {
    if (e.kind === 'setFlag') next.flags[e.ref] = e.value;
    if (e.kind === 'setObject') next.objects[e.ref] = e.value;
    if (e.kind === 'give') next.items[e.ref] = (next.items[e.ref] ?? 0) + 1;
    if (e.kind === 'take') {
      next.items[e.ref] = Math.max(0, (next.items[e.ref] ?? 0) - 1);
      if (!next.items[e.ref]) dropEquipped(next, e.ref);
    }
    if (e.kind === 'arc') next.arcs[e.ref] = (next.arcs[e.ref] ?? 0) + e.amount;
    if (e.kind === 'solve') next.solved[e.ref] = true;
    // Starting a quest that is under way or done changes nothing.
    if (e.kind === 'startQuest' && !next.quests[e.ref]) next.quests[e.ref] = 'active';
    if (e.kind === 'revealLore') next.lore[e.ref] = true;
    // Completing a quest pays its reward too; the play-through does that (its reward is the quest's own effects).
    if (e.kind === 'completeQuest') next.quests[e.ref] = 'done';
    if (e.kind === 'enableMechanic') next.mechanics[e.ref] = true;
    if (e.kind === 'learnSkill') next.skills[e.ref] = (next.skills[e.ref] ?? 0) + 1;
    if (e.kind === 'addNumber' || e.kind === 'reputation') next.flags[e.ref] = fromNumber(toNumber(next.flags[e.ref]) + e.amount);
    if (e.kind === 'setNumber') next.flags[e.ref] = fromNumber(e.amount);
  }
  return next;
};

// ---------------------------------------------------------------- references

export const conditionsIn = (rule: Rule | undefined): Condition[] =>
  rule ? rule.items.flatMap((i) => (isRule(i) ? conditionsIn(i) : [i])) : [];

/** Everything in the project that holds a rule or effects, so validation and "set by" can see them all. */
export const everyRule = (project: Project): { rule?: Rule; effects?: Effect[]; owner: string; where: string }[] => {
  const out: { rule?: Rule; effects?: Effect[]; owner: string; where: string }[] = [];
  for (const o of Object.values(project.objects)) {
    if (o.data.rule || o.data.effects) out.push({ rule: o.data.rule as Rule | undefined, effects: o.data.effects as Effect[] | undefined, owner: o.id, where: o.name });
    if (o.data.starts) out.push({ rule: o.data.starts as Rule, owner: o.id, where: `${o.name} · starts` });
    if (o.data.loseEffects) out.push({ effects: o.data.loseEffects as Effect[], owner: o.id, where: `${o.name} · on a loss` });
    for (const i of (o.data.interactions as { verb: string; requires?: Rule; effects?: Effect[] }[] | undefined) ?? []) {
      out.push({ rule: i.requires, effects: i.effects, owner: o.id, where: `${o.name} · ${i.verb}` });
    }
  }
  for (const c of project.connections) if (c.conditions || c.effects) out.push({ rule: c.conditions as Rule | undefined, effects: c.effects, owner: c.sourceId, where: 'a branch' });
  for (const e of project.events) {
    if (e.when || e.effects) out.push({ rule: e.when, effects: e.effects, owner: e.sceneId, where: 'a timeline event' });
    if (e.ends) out.push({ rule: e.ends, owner: e.sceneId, where: 'the end of a free play' });
  }
  for (const b of project.branches) if (b.when || b.effects) out.push({ rule: b.when, effects: b.effects, owner: b.sceneId, where: `option “${b.label}”` });
  for (const l of project.lines) if (l.conditions) out.push({ rule: l.conditions as Rule, owner: l.sceneId, where: 'a line' });
  return out;
};

/** Conditions and effects that point at something no longer in the project (spec §25). */
export const brokenReferences = (project: Project): { owner: string; where: string }[] =>
  everyRule(project)
    .filter(({ rule, effects }) => conditionsIn(rule).some((c) => c.kind !== 'stat' && !project.objects[c.ref]) || (effects ?? []).some((e) => !project.objects[e.ref]))
    .map(({ owner, where }) => ({ owner, where }));

/** Every effect that sets this state, wherever it is. */
/** Whether an effect changes this state: sets its value, or adds to or sets its number. */
export const setsState = (e: Effect, stateId: string): boolean => (e.kind === 'setFlag' || e.kind === 'addNumber' || e.kind === 'setNumber') && e.ref === stateId;

export const effectsSetting = (project: Project, stateId: string): string[] =>
  everyRule(project)
    .filter(({ effects }) => (effects ?? []).some((e) => setsState(e, stateId)))
    .map(({ where }) => where);
