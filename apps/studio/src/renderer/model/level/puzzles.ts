import { interactionsOf } from '../details';
import { describeCondition, describeEffect, isRule, type Condition, type Effect, type Rule } from '../rules';
import type { Project, StoryObject } from '../types';
import { assetOf, paramOf } from './geometry';
import { levelsOf, linkItem, setParam, unlinkItem, updateItem } from './level';
import type { AssetDefinition, LevelItem, LevelRule, PuzzleBinding, PuzzleRole } from './types';

/**
 * Puzzles in the level (Level Designer spec V2 §14). A puzzle is defined
 * once, in the Puzzle Creator (its rule: what solves it; its effects: what
 * solving does). The level shows where its parts are: where it is played
 * (entry), what it needs (required objects), where its clues are, what it
 * holds shut (gates) and what solving it brings (outputs). Some of that is
 * read from the level as it is (a door present only while the puzzle is
 * unsolved is a gate); the rest the designer binds. Binding points an item at
 * the puzzle, never copies its logic.
 */

export const PUZZLE_ROLES: readonly { id: PuzzleRole; label: string; color: string; mark: string; hint: string }[] = [
  { id: 'entry', label: 'Entry', color: '#6fae5e', mark: '◉', hint: 'where the puzzle is played: its room, area or puzzle node' },
  { id: 'required', label: 'Required', color: '#4a86d8', mark: '●', hint: 'something the solution needs: a lever, a key, a switch' },
  { id: 'clue', label: 'Clue', color: '#e8c872', mark: '?', hint: 'where the player learns how; a clue can reveal lore' },
  { id: 'gate', label: 'Gate', color: '#e5484d', mark: '▮', hint: 'held shut until it is solved: there only while unsolved' },
  { id: 'output', label: 'Output', color: '#9a7fc0', mark: '★', hint: 'what solving it brings: there only once solved' },
];

export const roleOf = (role: PuzzleRole) => PUZZLE_ROLES.find((r) => r.id === role)!;

export const puzzlesOf = (project: Project): StoryObject[] => Object.values(project.objects).filter((o) => o.type === 'puzzle').sort((a, b) => a.name.localeCompare(b.name));

const ruleOf = (o: StoryObject | undefined) => o?.data.rule as Rule | undefined;
const effectsOf = (o: StoryObject | undefined) => (o?.data.effects as Effect[] | undefined) ?? [];

/** Every condition in a rule, through its groups. */
export const conditionsIn = (rule: Rule | undefined): Condition[] => (rule ? rule.items.flatMap((i) => (isRule(i) ? conditionsIn(i) : [i])) : []);

const isPuzzleCond = (c: Condition, puzzle: string, op: 'solved' | 'unsolved') => c.kind === 'puzzle' && c.ref === puzzle && c.op === op;

/** Whether this rule asks for the puzzle solved (or not), anywhere in it. */
export const asksFor = (rule: Rule | undefined, puzzle: string, op: 'solved' | 'unsolved'): boolean => conditionsIn(rule).some((c) => isPuzzleCond(c, puzzle, op));

/** What sets a story element: the effects and interactions that change it. */
const setsIt = (o: StoryObject, ref: string): boolean =>
  effectsOf(o).some((e) => 'ref' in e && e.ref === ref && (e.kind === 'setFlag' || e.kind === 'setObject' || e.kind === 'give' || e.kind === 'fire' || e.kind === 'solve')) ||
  interactionsOf(o).some((i) => i.setsFlag === ref || i.fires === ref);

export interface PuzzleStep {
  /** The story element the step is about. */
  id: string;
  name: string;
  type: StoryObject['type'];
  /** How it feeds the puzzle, in words. */
  why: string;
  /** How far from the puzzle: 1 is in its own rule. */
  depth: number;
}

/**
 * What a puzzle needs, step by step: the elements its rule is about, and what
 * sets those (a trigger whose rule needs a lever up needs the lever), up to a
 * few steps back. These are the "puzzle nodes" an item can be bound to.
 */
export const puzzleSteps = (project: Project, puzzleId: string): PuzzleStep[] => {
  const puzzle = project.objects[puzzleId];
  if (!puzzle) return [];
  const out = new Map<string, PuzzleStep>();
  let frontier: { rule: Rule | undefined; via?: string }[] = [{ rule: ruleOf(puzzle) }];
  for (let depth = 1; depth <= 5 && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { rule, via } of frontier) {
      for (const c of conditionsIn(rule)) {
        const el = project.objects[c.ref];
        if (!el || el.id === puzzleId || out.has(el.id)) continue;
        out.set(el.id, { id: el.id, name: el.name, type: el.type, why: `${describeCondition(project, c)}${via ? `, for ${via}` : ''}`, depth });
        // Whatever sets it is a step too, and so is what that needs.
        for (const setter of Object.values(project.objects)) {
          if (setter.id === puzzleId || out.has(setter.id) || !setsIt(setter, el.id)) continue;
          out.set(setter.id, { id: setter.id, name: setter.name, type: setter.type, why: `sets ${el.name}`, depth });
          next.push({ rule: ruleOf(setter), via: setter.name });
        }
        if (el.type === 'trigger' || el.type === 'puzzle' || el.type === 'gate') next.push({ rule: ruleOf(el), via: el.name });
      }
    }
    frontier = next;
  }
  return [...out.values()];
};

/** The story elements an item points at: its links, and what its parameters name (the item a pickup gives, a door's key). */
const refsOf = (project: Project, item: LevelItem): string[] => [
  ...(item.links ?? []),
  ...Object.values(item.params ?? {}).filter((v): v is string => typeof v === 'string' && !!project.objects[v]),
];

/** What an item's rules change. */
const ruleRefs = (item: LevelItem): string[] => (item.rules ?? []).flatMap((r) => (r.effects ?? []).filter((e): e is Effect & { ref: string } => 'ref' in e).map((e) => e.ref));

export interface PuzzlePart {
  role: PuzzleRole;
  itemId?: string;
  travelId?: string;
  /** Why it plays this part, in words. */
  why: string;
  /** Bound by the designer, rather than read from the level. */
  bound: boolean;
}

const withAll = (rule: Rule | undefined, c: Condition): Rule => (rule && rule.match === 'all' ? { ...rule, items: [...rule.items, c] } : rule && rule.items.length ? { match: 'all', items: [rule, c] } : { match: 'all', items: [c] });

const withoutCond = (rule: Rule | undefined, drop: (c: Condition) => boolean): Rule | undefined => {
  if (!rule) return rule;
  const items = rule.items.map((i) => (isRule(i) ? withoutCond(i, drop) : i)).filter((i): i is Condition | Rule => !!i && (isRule(i) ? i.items.length > 0 : !drop(i)));
  return items.length ? { ...rule, items } : undefined;
};

/** The parts one item plays for one puzzle. */
export const partsOfItem = (project: Project, puzzleId: string, item: LevelItem, global?: readonly AssetDefinition[]): PuzzlePart[] => {
  const set = levelsOf(project);
  const def = assetOf(set, item, global);
  const steps = new Map(puzzleSteps(project, puzzleId).map((s) => [s.id, s]));
  const parts: PuzzlePart[] = [];
  const add = (role: PuzzleRole, why: string, bound = false) => {
    const had = parts.find((p) => p.role === role);
    if (had) {
      had.bound ||= bound;
      return;
    }
    parts.push({ role, itemId: item.id, why, bound });
  };
  const name = (id?: string) => (id ? project.objects[id]?.name ?? '?' : '');
  // Bound by hand first, so its words are the designer's.
  for (const b of item.puzzles ?? []) {
    if (b.puzzle !== puzzleId) continue;
    const node = b.node && project.objects[b.node];
    add(b.role, node ? (b.role === 'clue' && node.type === 'lore' ? `reveals ${node.name}` : `is ${node.name}`) : roleOf(b.role).hint, true);
  }
  // Where it is played: a puzzle node naming it, or a room or area tied to it.
  if (String(paramOf(set, item, 'puzzle', global) ?? '') === puzzleId) add('entry', 'its puzzle node');
  else if (item.links?.includes(puzzleId) && (def.kind === 'space' || (def.kind === 'volume' && def.role === 'zone'))) add('entry', 'where it is played');
  // What it needs: an item that is (or gives, or works) one of its steps.
  const refs = refsOf(project, item);
  const step = refs.map((r) => steps.get(r)).find(Boolean) ?? ruleRefs(item).map((r) => steps.get(r)).find(Boolean);
  if (step) add('required', `${refs.includes(step.id) ? 'is' : 'works'} ${step.name} — ${step.why}`);
  // Held shut until it is solved, or until a step is done.
  if (asksFor(item.activeWhen, puzzleId, 'unsolved')) add('gate', 'there until it is solved');
  else {
    const c = conditionsIn(item.activeWhen).find((x) => steps.has(x.ref) && x.kind !== 'puzzle');
    if (c) add('gate', `there while ${describeCondition(project, c)}`);
  }
  // What solving it brings: there once solved, a rule waiting on it, the lore or element its effects reach.
  if (asksFor(item.activeWhen, puzzleId, 'solved')) add('output', 'appears when it is solved');
  const waiting = (item.rules ?? []).find((r) => asksFor(r.when, puzzleId, 'solved'));
  if (waiting) add('output', `when it is solved: ${[...(waiting.actions ?? []).map((a) => `${a.kind} ${set.items.find((i) => i.id === a.target)?.name ?? name(a.target)}`), ...(waiting.effects ?? []).map((e) => describeEffect(project, e))].join(', ') || 'its rule runs'}`);
  const reached = effectsOf(project.objects[puzzleId]).find((e) => 'ref' in e && refs.includes(e.ref));
  if (reached) add('output', `solving it: ${describeEffect(project, reached)}`);
  return parts;
};

export interface PuzzleOverlay {
  puzzle: StoryObject;
  /** On this map. */
  parts: PuzzlePart[];
  /** What solving it does to the story, in words. */
  outputs: string[];
  /** Its parts on other maps, by map. */
  elsewhere: { levelId: string; count: number }[];
}

/** A puzzle's parts on a map (spec V2 §14): items, and the routes it opens. */
export const puzzleOverlay = (project: Project, puzzleId: string, levelId: string, global?: readonly AssetDefinition[]): PuzzleOverlay | null => {
  const puzzle = project.objects[puzzleId];
  if (!puzzle || puzzle.type !== 'puzzle') return null;
  const set = levelsOf(project);
  const parts: PuzzlePart[] = [];
  const elsewhere = new Map<string, number>();
  for (const item of set.items) {
    const found = partsOfItem(project, puzzleId, item, global);
    if (!found.length) continue;
    if (item.levelId === levelId) parts.push(...found);
    else elsewhere.set(item.levelId, (elsewhere.get(item.levelId) ?? 0) + 1);
  }
  for (const t of set.travel ?? []) {
    if (!asksFor(t.unlockWhen, puzzleId, 'solved')) continue;
    if (t.levelId === levelId) parts.push({ role: 'gate', travelId: t.id, why: 'locked until it is solved', bound: false });
    else elsewhere.set(t.levelId, (elsewhere.get(t.levelId) ?? 0) + 1);
  }
  return {
    puzzle,
    parts,
    outputs: effectsOf(puzzle).map((e) => describeEffect(project, e)),
    elsewhere: [...elsewhere].map(([id, count]) => ({ levelId: id, count })),
  };
};

/** The puzzles with a part on this map. */
export const puzzlesOnMap = (project: Project, levelId: string, global?: readonly AssetDefinition[]): PuzzleOverlay[] =>
  puzzlesOf(project)
    .map((p) => puzzleOverlay(project, p.id, levelId, global))
    .filter((o): o is PuzzleOverlay => !!o && o.parts.length > 0);

/** Every part an item plays, in every puzzle. */
export const puzzleRolesOf = (project: Project, itemId: string, global?: readonly AssetDefinition[]): (PuzzlePart & { puzzle: string })[] => {
  const item = levelsOf(project).items.find((i) => i.id === itemId);
  if (!item) return [];
  return puzzlesOf(project).flatMap((p) => partsOfItem(project, p.id, item, global).map((part) => ({ ...part, puzzle: p.id })));
};

// ---------------------------------------------------------------- binding

const clueRuleId = (puzzle: string) => `puzzle_clue_${puzzle}`;

/**
 * Bind an item to a puzzle (spec V2 §14). What the part does in play is
 * written once, through what the level already has, so the engines and Play
 * Mode need nothing new:
 * - a gate is there only while the puzzle is unsolved; an output only once it is solved;
 * - a required object bound to a step is tied to that element (a pickup gives the item), so it works the puzzle's own logic;
 * - a clue bound to lore reveals it when examined;
 * - an entry is tied to the puzzle, as where it is played.
 */
export const bindToPuzzle = (project: Project, itemId: string, binding: PuzzleBinding, global?: readonly AssetDefinition[]): Project => {
  const set = levelsOf(project);
  const item = set.items.find((i) => i.id === itemId);
  if (!item || !project.objects[binding.puzzle] || item.locked) return project;
  const clean: PuzzleBinding = { puzzle: binding.puzzle, role: binding.role, ...(binding.node && project.objects[binding.node] ? { node: binding.node } : {}) };
  if ((item.puzzles ?? []).some((b) => b.puzzle === clean.puzzle && b.role === clean.role && b.node === clean.node)) return project;
  let p = updateItem(project, itemId, { puzzles: [...(item.puzzles ?? []).filter((b) => !(b.puzzle === clean.puzzle && b.role === clean.role)), clean] }, global);
  const now = () => levelsOf(p).items.find((i) => i.id === itemId)!;
  const def = assetOf(set, item, global);
  switch (clean.role) {
    case 'gate':
    case 'output': {
      const op = clean.role === 'gate' ? 'unsolved' : 'solved';
      const other = clean.role === 'gate' ? 'solved' : 'unsolved';
      // A gate and an output of the same puzzle can't both hold: the new part replaces the old.
      let when = withoutCond(now().activeWhen, (c) => isPuzzleCond(c, clean.puzzle, other));
      if (!asksFor(when, clean.puzzle, op)) when = withAll(when, { kind: 'puzzle', ref: clean.puzzle, op });
      p = updateItem(p, itemId, { activeWhen: when, puzzles: (now().puzzles ?? []).filter((b) => !(b.puzzle === clean.puzzle && b.role === (clean.role === 'gate' ? 'output' : 'gate'))) }, global);
      break;
    }
    case 'required':
      if (clean.node) {
        const node = project.objects[clean.node]!;
        p = linkItem(p, itemId, clean.node);
        // A pickup bound to an item gives it.
        if (node.type === 'inventory' && ['pickup', 'inventory', 'weapon', 'ammo'].includes(def.role)) p = setParam(p, itemId, 'item', clean.node, global);
      }
      break;
    case 'clue':
      if (clean.node && project.objects[clean.node]?.type === 'lore') {
        const rule: LevelRule = { id: clueRuleId(clean.puzzle), on: 'interact', effects: [{ kind: 'revealLore', ref: clean.node }] };
        p = updateItem(p, itemId, { rules: [...(now().rules ?? []).filter((r) => r.id !== rule.id), rule] }, global);
        if (def.params.some((x) => x.key === 'interactive')) p = setParam(p, itemId, 'interactive', true, global);
      }
      break;
    case 'entry':
      p = linkItem(p, itemId, clean.puzzle);
      break;
  }
  return p;
};

/** Undo a binding: the item goes back to how it was before it, as far as the binding changed it. */
export const unbindFromPuzzle = (project: Project, itemId: string, binding: Pick<PuzzleBinding, 'puzzle' | 'role'>, global?: readonly AssetDefinition[]): Project => {
  const item = levelsOf(project).items.find((i) => i.id === itemId);
  const had = item?.puzzles?.find((b) => b.puzzle === binding.puzzle && b.role === binding.role);
  if (!item || !had || item.locked) return project;
  const left = item.puzzles!.filter((b) => b !== had);
  let p = updateItem(project, itemId, { puzzles: left.length ? left : undefined }, global);
  switch (had.role) {
    case 'gate':
    case 'output':
      p = updateItem(p, itemId, { activeWhen: withoutCond(item.activeWhen, (c) => isPuzzleCond(c, had.puzzle, had.role === 'gate' ? 'unsolved' : 'solved')) }, global);
      break;
    case 'required':
      // The link goes unless another binding still needs it.
      if (had.node && !left.some((b) => b.node === had.node)) p = unlinkItem(p, itemId, had.node);
      break;
    case 'clue': {
      const rules = (item.rules ?? []).filter((r) => r.id !== clueRuleId(had.puzzle));
      p = updateItem(p, itemId, { rules: rules.length ? rules : undefined }, global);
      break;
    }
    case 'entry':
      if (!left.some((b) => b.puzzle === had.puzzle)) p = unlinkItem(p, itemId, had.puzzle);
      break;
  }
  return p;
};

/** What a step can be bound as: the elements a required object can be, the lore a clue can reveal. */
export const bindableNodes = (project: Project, puzzleId: string, role: PuzzleRole): { id: string; label: string }[] => {
  if (role === 'required') return puzzleSteps(project, puzzleId).filter((s) => ['object', 'inventory', 'trigger', 'character'].includes(s.type)).map((s) => ({ id: s.id, label: `${s.name} (${s.why})` }));
  if (role === 'clue')
    return Object.values(project.objects)
      .filter((o) => o.type === 'lore')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((o) => ({ id: o.id, label: `Reveals ${o.name}` }));
  return [];
};
