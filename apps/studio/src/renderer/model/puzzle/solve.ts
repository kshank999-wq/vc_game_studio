import { interactionsOf } from '../details';
import { levelsOf } from '../level/level';
import { applyStoryEffects, settleWorld, startWorld, useInteractionIn, type PlayWorld } from '../play';
import { evaluate, type Effect, type Rule } from '../rules';
import type { Project } from '../types';
import { nodeDone, nodesOf, type PuzzleIssue } from './design';
import { elementsOf } from './elements';
import { stepStatus } from './progress';
import { screenIssues, screenOf } from './screens';
import { usesProgress } from './tree';
import { clueOf, isClue } from './clues';

/**
 * Puzzle testing (puzzle spec §13): what the player can do from where they
 * stand, and whether they can solve it at all. The player's state moves
 * through the same rules as the play-through — interactions (a screen
 * puzzle's counted as solvable when it has nothing wrong with it), pickups
 * and clues in the levels, scenes reached — and a search over what that
 * allows says whether the puzzle can be solved, how, and what can never be
 * reached on the way.
 */

export interface PlayerAction {
  id: string;
  label: string;
  kind: 'use' | 'take' | 'examine' | 'visit';
  /** Do it. */
  run: (world: PlayWorld) => PlayWorld;
}

const allows = (project: Project, world: PlayWorld, objectId: string, i: ReturnType<typeof interactionsOf>[number]) => {
  if (i.when && world.objects[objectId] !== i.when) return false;
  return evaluate(i.requires, world);
};

const refsIn = (x: unknown, out: Set<string>) => {
  if (!x || typeof x !== 'object') return;
  if (Array.isArray(x)) return x.forEach((y) => refsIn(y, out));
  const o = x as Record<string, unknown>;
  if (typeof o.ref === 'string') out.add(o.ref);
  Object.values(o).forEach((v) => refsIn(v, out));
};

/**
 * What can matter to the puzzle: what its steps, rule and elements name, and
 * then whatever changes any of that (an interaction that sets it, a trigger
 * that does, a level rule that does), followed back until nothing new turns up.
 */
const relevantTo = (project: Project, puzzleId: string): Set<string> => {
  const puzzle = project.objects[puzzleId];
  const keep = new Set<string>([puzzleId, ...elementsOf(project, puzzleId).map((e) => e.id)]);
  refsIn([nodesOf(puzzle), puzzle?.data.rule, puzzle?.data.hints], keep);
  const touches = (x: unknown) => {
    const r = new Set<string>();
    refsIn(x, r);
    return [...r].some((id) => keep.has(id));
  };
  const items = levelsOf(project).items;
  for (let grew = true; grew; ) {
    grew = false;
    const add = (ids: Iterable<string>) => {
      for (const id of ids) if (!keep.has(id)) keep.add(id), (grew = true);
    };
    for (const o of Object.values(project.objects)) {
      const list = interactionsOf(o);
      const does = list.some((i) => (i.setsFlag && keep.has(i.setsFlag)) || (i.fires && keep.has(i.fires)) || touches(i.effects));
      if (o.type === 'object' && (keep.has(o.id) || does)) {
        const needs = new Set<string>([o.id]);
        refsIn(list.map((i) => i.requires), needs);
        add(needs);
      }
      if (o.type === 'trigger' && (keep.has(o.id) || (o.data.setsFlag && keep.has(String(o.data.setsFlag))) || touches(o.data.effects))) {
        const needs = new Set<string>([o.id]);
        refsIn(o.data.rule, needs);
        add(needs);
      }
    }
    for (const i of items) {
      const gives = i.params?.item;
      const linked = (i.links ?? []).some((l) => keep.has(l));
      if ((typeof gives === 'string' && keep.has(gives)) || linked || (i.rules ?? []).some((r) => touches(r.effects))) {
        const needs = new Set<string>();
        refsIn([i.activeWhen, (i.rules ?? []).map((r) => r.when)], needs);
        add(needs);
      }
    }
  }
  return keep;
};

/** Everything the player could try that can matter, available now or not: interactions, the level's pickups and clues, the scenes the puzzle names. */
const everyAction = (project: Project, puzzleId: string): (PlayerAction & { ready: (w: PlayWorld) => boolean })[] => {
  const out: (PlayerAction & { ready: (w: PlayWorld) => boolean })[] = [];
  const keep = relevantTo(project, puzzleId);
  for (const o of Object.values(project.objects)) {
    if (o.type !== 'object' || !keep.has(o.id)) continue;
    const screen = screenOf(o);
    for (const i of interactionsOf(o)) {
      // A screen with something wrong with it can't be solved; one without, the player can.
      if (i.screen && screen && screenIssues(project, o).length) continue;
      out.push({
        id: `use:${o.id}:${i.id}`,
        label: `${o.name}: ${i.verb}${i.screen && screen ? ' (solve its screen)' : ''}`,
        kind: 'use',
        ready: (w) => allows(project, w, o.id, i),
        run: (w) => useInteractionIn(project, w, o.id, i.id).world,
      });
    }
  }
  const set = levelsOf(project);
  for (const item of set.items) {
    const gives = item.params?.item;
    if (typeof gives === 'string' && project.objects[gives]?.type === 'inventory' && keep.has(gives)) {
      out.push({ id: `take:${item.id}`, label: `Pick up ${project.objects[gives]!.name} (${item.name})`, kind: 'take', ready: (w) => !(w.items[gives] ?? 0) && evaluate(item.activeWhen, w), run: (w) => applyStoryEffects(project, w, [{ kind: 'give', ref: gives }]).world });
    }
    for (const r of item.rules ?? []) {
      const effects = (r.effects ?? []) as Effect[];
      if (!effects.length || !['interact', 'enter', 'pickup', 'use'].includes(r.on)) continue;
      const refs = new Set<string>();
      refsIn(effects, refs);
      if (![...refs].some((id) => keep.has(id))) continue;
      out.push({ id: `rule:${item.id}:${r.id}`, label: `${r.on === 'enter' ? 'Walk into' : 'Examine'} ${item.name}`, kind: 'examine', ready: (w) => evaluate(item.activeWhen, w) && evaluate(r.when, w), run: (w) => applyStoryEffects(project, w, effects).world });
    }
  }
  // Scenes the puzzle names (Hear Mara at the door): the player can reach them.
  const named = new Set<string>();
  refsIn(nodesOf(project.objects[puzzleId]), named);
  refsIn(project.objects[puzzleId]?.data.hints, named);
  for (const e of elementsOf(project, puzzleId)) refsIn(interactionsOf(e), named);
  for (const id of named) {
    const o = project.objects[id];
    if (o?.type !== 'scene') continue;
    out.push({ id: `visit:${id}`, label: `Reach ${o.name}`, kind: 'visit', ready: (w) => !w.visited[id], run: (w) => settleWorld(project, { ...w, visited: { ...w.visited, [id]: true } }).world });
  }
  return out;
};

/** What the player can do now that changes something (test mode, §13). */
export const actionsNow = (project: Project, puzzleId: string, world: PlayWorld): PlayerAction[] =>
  everyAction(project, puzzleId).filter((a) => a.ready(world));

/** The world as the puzzle's test starts it: the story's start, settled. */
export const testWorld = (project: Project): PlayWorld => settleWorld(project, startWorld(project)).world;

const keyOf = (w: PlayWorld) => JSON.stringify([w.flags, w.items, w.objects, w.lore, w.solved, w.visited, w.fired, w.steps, w.quests]);

export interface Solution {
  solvable: boolean;
  /** The shortest way found, in order. */
  path: string[];
  /** Situations looked at, and whether the search stopped short. */
  explored: number;
  truncated: boolean;
  /** Required steps never done in any situation reached. */
  neverDone: string[];
  /** Needed clues never known. */
  neverKnown: string[];
  /** Required steps done before the player does anything. */
  doneAtStart: string[];
  /** Required steps not done when it was solved: a way round them. */
  bypassed: string[];
}

/** Whether a step is done in a world: its progress if the puzzle keeps one, else its condition. */
const doneIn = (project: Project, puzzleId: string, w: PlayWorld, nodeId: string) => {
  const nodes = nodesOf(project.objects[puzzleId]);
  if (usesProgress(nodes)) {
    const n = nodes.find((x) => x.id === nodeId);
    return !!n && stepStatus(nodes, w.steps?.[puzzleId], n) === 'done';
  }
  return nodeDone(nodes, nodeId, puzzleId, (r: Rule) => evaluate(r, w));
};

/**
 * Can the player solve it (§13)? A breadth-first search over what the player
 * can do, from the start (or a test's world), up to a limit of situations.
 */
export const canSolve = (project: Project, puzzleId: string, from?: PlayWorld, limit = 2500): Solution => {
  const start = from ?? testWorld(project);
  const nodes = nodesOf(project.objects[puzzleId]);
  const required = nodes.filter((n) => !n.optional && !nodes.some((p) => p.optional && isUnder(nodes, n.id, p.id)));
  const leaves = required.filter((n) => n.kind !== 'goal');
  const clues = elementsOf(project, puzzleId).filter((e) => isClue(e) && clueOf(e).mandatory);
  const actions = everyAction(project, puzzleId);
  const seen = new Map<string, { world: PlayWorld; path: string[] }>([[keyOf(start), { world: start, path: [] }]]);
  const queue = [keyOf(start)];
  const everDone = new Set<string>();
  const everKnown = new Set<string>();
  const note = (w: PlayWorld) => {
    for (const n of required) if (!everDone.has(n.id) && doneIn(project, puzzleId, w, n.id)) everDone.add(n.id);
    for (const c of clues) if (w.lore[c.id]) everKnown.add(c.id);
  };
  note(start);
  const doneAtStart = leaves.filter((n) => doneIn(project, puzzleId, start, n.id)).map((n) => n.label);
  let found: { world: PlayWorld; path: string[] } | undefined = start.solved[puzzleId] ? seen.get(keyOf(start)) : undefined;
  let truncated = false;
  while (queue.length && !found) {
    if (seen.size >= limit) {
      truncated = true;
      break;
    }
    const at = seen.get(queue.shift()!)!;
    for (const a of actions) {
      if (!a.ready(at.world)) continue;
      const next = a.run(at.world);
      const k = keyOf(next);
      if (seen.has(k)) continue;
      const entry = { world: next, path: [...at.path, a.label] };
      seen.set(k, entry);
      queue.push(k);
      note(next);
      if (next.solved[puzzleId]) {
        found = entry;
        break;
      }
    }
  }
  return {
    solvable: !!found,
    path: found?.path ?? [],
    explored: seen.size,
    truncated,
    neverDone: found ? [] : required.filter((n) => !everDone.has(n.id)).map((n) => n.label),
    neverKnown: clues.filter((c) => !everKnown.has(c.id)).map((c) => c.name),
    doneAtStart,
    bypassed: found ? leaves.filter((n) => !doneIn(project, puzzleId, found!.world, n.id) && !n.fail?.forward).map((n) => n.label) : [],
  };
};

const isUnder = (nodes: ReturnType<typeof nodesOf>, id: string, ancestor: string): boolean => {
  const n = nodes.find((x) => x.id === id);
  return !!n?.parentId && (n.parentId === ancestor || isUnder(nodes, n.parentId, ancestor));
};

/** The solvability pass as issues for the panel below (§13). */
export const solveIssues = (project: Project, puzzleId: string, s: Solution): PuzzleIssue[] => {
  const out: PuzzleIssue[] = [];
  const id = (label: string) => nodesOf(project.objects[puzzleId]).find((n) => n.label === label)?.id;
  if (!s.solvable && !s.truncated) out.push({ severity: 'error', message: 'The player can’t solve it: nothing they can do gets there.' });
  if (!s.solvable && s.truncated) out.push({ severity: 'warning', message: `No way found in ${s.explored} situations: it may need more than the search looks at.` });
  for (const l of s.neverDone) out.push({ severity: 'error', nodeId: id(l), message: `“${l}” can never be done.` });
  for (const c of s.neverKnown) out.push({ severity: 'error', message: `The needed clue “${c}” can never be found.` });
  for (const l of s.doneAtStart) out.push({ severity: 'warning', nodeId: id(l), message: `“${l}” is done before the player does anything: it can be skipped.` });
  for (const l of s.bypassed) out.push({ severity: 'warning', nodeId: id(l), message: `It can be solved without “${l}”: the step can be bypassed.` });
  return out;
};


/** Where a step stands in a test's world: done, open to do, or waiting on something first. */
export const stepNow = (project: Project, puzzleId: string, world: PlayWorld, nodeId: string): 'done' | 'open' | 'locked' => {
  const nodes = nodesOf(project.objects[puzzleId]);
  const n = nodes.find((x) => x.id === nodeId);
  if (!n) return 'locked';
  if (doneIn(project, puzzleId, world, nodeId)) return 'done';
  const s = stepStatus(nodes, world.steps?.[puzzleId], n);
  return s === 'locked' ? 'locked' : 'open';
};
