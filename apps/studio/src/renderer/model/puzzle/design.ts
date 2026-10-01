import { setData } from '../details';
import { ENTRY_CODE, makeObject, newId, nextCode } from '../project';
import { describeCondition, isEmpty, type Condition, type Effect, type Rule } from '../rules';
import type { Project, StoryObject } from '../types';

/**
 * The Puzzle Creator's model (docs/specs/puzzle-creator-spec.md). A puzzle is
 * a story element (type 'puzzle'); its design lives in its data: the written
 * concept and definition (§2, §4) as plain fields, and its hierarchy (§5) as
 * a tree of nodes. The tree compiles into the puzzle's own "Solved when"
 * rule, so the play-through, Play Mode and every engine solve it as they
 * always have: the logic is written once, here.
 */

export type PuzzleScale = 'area' | 'object' | 'screen' | 'multiArea';

export const SCALES: readonly { id: PuzzleScale; label: string; example: string; focus: string }[] = [
  { id: 'area', label: 'Area / room', example: 'An escape-room sequence', focus: 'Several clues and sub-puzzles spread through a room or area.' },
  { id: 'object', label: 'Object', example: 'A locked safe', focus: 'One object with prerequisites, clues, states and an unlock result.' },
  { id: 'screen', label: 'Screen', example: 'A dial, a symbol grid, a circuit', focus: 'The player works a dedicated puzzle screen.' },
  { id: 'multiArea', label: 'Multi-area', example: 'Pieces from several rooms open a temple door', focus: 'Steps across rooms, levels or places revisited.' },
];

export type { NodeKind, PuzzleNode } from './tree';
import type { NodeKind, PuzzleNode } from './tree';

export const NODE_KINDS: readonly { id: NodeKind; label: string; hint: string }[] = [
  { id: 'goal', label: 'Sub-goal', hint: 'a step that breaks into others: unlock the cabinet, restore power' },
  { id: 'requirement', label: 'Requirement', hint: 'something that must be true: an item held, a clue known, a switch on' },
  { id: 'interaction', label: 'Interaction', hint: 'what the player does: inspect the painting, rotate the dial' },
];

/** The written design and definition (§2, §4). Strings, so the Bible and the engines read them as fields. */
export interface PuzzleDefinition {
  scale: PuzzleScale;
  /** §2: the puzzle in plain words, before anything else. */
  concept: string;
  /** Why it is in the scene or world. */
  purpose: string;
  /** What the player is told they are doing. */
  objective: string;
  /** The intended solution (the Bible's Solution field). */
  solution: string;
  /** What the player knows and can reach at the start. */
  knows: string;
  /** Discoveries, clues, objects, actions: one per line, to turn into steps. */
  discoveries: string;
  /** 1 (easy) to 5. */
  difficulty: number;
  /** Expected minutes to solve. */
  minutes: number;
  /** What a failure does (the Bible's Fail state field). */
  failState: string;
  reset: 'never' | 'onFail' | 'onLeave' | 'byHand';
  /** 0 for as many as the player likes. */
  retries: number;
}

export const RESETS: readonly { id: PuzzleDefinition['reset']; label: string }[] = [
  { id: 'never', label: 'Never: what is done stays done' },
  { id: 'onFail', label: 'On a failure' },
  { id: 'onLeave', label: 'When the player leaves' },
  { id: 'byHand', label: 'Only by a reset effect' },
];

const DEFINITION_DEFAULTS: PuzzleDefinition = { scale: 'area', concept: '', purpose: '', objective: '', solution: '', knows: '', discoveries: '', difficulty: 2, minutes: 5, failState: '', reset: 'never', retries: 0 };

export const puzzles = (project: Project): StoryObject[] =>
  Object.values(project.objects)
    .filter((o) => o.type === 'puzzle')
    .sort((a, b) => (a.data.code ?? a.name).localeCompare(b.data.code ?? b.name, undefined, { numeric: true }));

export const definitionOf = (puzzle: StoryObject | undefined): PuzzleDefinition => {
  const d = puzzle?.data ?? {};
  const str = (k: keyof PuzzleDefinition) => (typeof d[k] === 'string' ? (d[k] as string) : (DEFINITION_DEFAULTS[k] as string));
  const num = (k: keyof PuzzleDefinition) => (typeof d[k] === 'number' ? (d[k] as number) : typeof d[k] === 'string' && d[k] !== '' && Number.isFinite(Number(d[k])) ? Number(d[k]) : (DEFINITION_DEFAULTS[k] as number));
  const scale = str('scale');
  const reset = str('reset');
  return {
    scale: SCALES.some((s) => s.id === scale) ? (scale as PuzzleScale) : 'area',
    concept: str('concept'),
    purpose: str('purpose'),
    objective: str('objective'),
    solution: str('solution'),
    knows: str('knows'),
    discoveries: str('discoveries'),
    difficulty: Math.min(5, Math.max(1, Math.round(num('difficulty')))),
    minutes: Math.max(0, num('minutes')),
    failState: str('failState'),
    reset: RESETS.some((r) => r.id === reset) ? (reset as PuzzleDefinition['reset']) : 'never',
    retries: Math.max(0, Math.round(num('retries'))),
  };
};

/**
 * Change the definition. Text fields are kept as strings (so the engines'
 * fields carry them); numbers too, as the Bible's fields are text.
 */
export const updateDefinition = (project: Project, id: string, patch: Partial<PuzzleDefinition>): Project => {
  if (project.objects[id]?.type !== 'puzzle') return project;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) data[k] = typeof v === 'number' ? String(v) : v;
  return setData(project, id, data);
};

// ---------------------------------------------------------------- the tree

export { nodesOf, treeDrives } from './tree';
import { nodesOf } from './tree';

/** A node's steps, in order. */
export const childrenOf = (nodes: readonly PuzzleNode[], parentId: string | null): PuzzleNode[] => nodes.filter((n) => (n.parentId ?? null) === parentId);

/** Everything under a node. */
export const descendantsOf = (nodes: readonly PuzzleNode[], id: string): PuzzleNode[] => {
  const out: PuzzleNode[] = [];
  const walk = (pid: string) => {
    for (const c of childrenOf(nodes, pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
};

/** The nodes in reading order (depth first), each with its depth. */
export const flatten = (nodes: readonly PuzzleNode[]): { node: PuzzleNode; depth: number }[] => {
  const out: { node: PuzzleNode; depth: number }[] = [];
  const walk = (pid: string | null, depth: number, seen: Set<string>) => {
    for (const c of childrenOf(nodes, pid)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ node: c, depth });
      walk(c.id, depth + 1, seen);
    }
  };
  walk(null, 0, new Set());
  return out;
};

/**
 * The rule the tree comes to (§5, §6): a sub-goal holds when all (or any) of
 * its required steps do; a requirement or interaction when its condition
 * does. Optional steps never hold a goal up. A step with nothing that marks
 * it done can't be done, so the goal it is in can't be either (validation says so).
 */
export const compileTree = (nodes: readonly PuzzleNode[], puzzleId: string): Rule => {
  // Never holds before the puzzle is solved, in the studio and every engine alike (an empty rule would always hold).
  const NEVER: Condition = { kind: 'puzzle', ref: puzzleId, op: 'solved' };
  const of = (n: PuzzleNode, seen: Set<string>): Rule | Condition => {
    if (seen.has(n.id)) return NEVER;
    const next = new Set(seen).add(n.id);
    if (n.kind === 'goal') {
      const steps = childrenOf(nodes, n.id).filter((c) => !c.optional);
      if (!steps.length) return NEVER;
      return { match: n.gate === 'any' ? 'any' : 'all', items: steps.map((c) => of(c, next)) };
    }
    return n.when ?? NEVER;
  };
  const top = childrenOf(nodes, null).filter((c) => !c.optional);
  return { match: 'all', items: top.length ? top.map((c) => of(c, new Set())) : [NEVER] };
};

/** Write the tree and, while it drives it, the rule it comes to. One undo step. */
export const setTree = (project: Project, id: string, nodes: PuzzleNode[]): Project => {
  const puzzle = project.objects[id];
  if (puzzle?.type !== 'puzzle') return project;
  const drives = puzzle.data.treeRule !== false;
  // The last step gone: the rule the tree wrote goes with it.
  const rule = drives ? (nodes.length ? compileTree(nodes, id) : nodesOf(puzzle).length ? undefined : puzzle.data.rule) : puzzle.data.rule;
  return setData(project, id, { tree: nodes, rule });
};

/** Let the tree write the rule, or keep the rule the designer wrote. */
export const setTreeDrives = (project: Project, id: string, on: boolean): Project => {
  const puzzle = project.objects[id];
  if (puzzle?.type !== 'puzzle') return project;
  const nodes = nodesOf(puzzle);
  return setData(project, id, { treeRule: on, ...(on && nodes.length ? { rule: compileTree(nodes, id) } : {}) });
};

export const addNode = (project: Project, id: string, node: Partial<Omit<PuzzleNode, 'id'>> & { kind: NodeKind }, after?: string): { project: Project; nodeId: string } => {
  const nodes = nodesOf(project.objects[id]);
  const made: PuzzleNode = {
    id: newId('pzn'),
    parentId: node.parentId ?? null,
    kind: node.kind,
    label: node.label?.trim() || (node.kind === 'goal' ? 'New sub-goal' : node.kind === 'requirement' ? 'New requirement' : 'New interaction'),
    ...(node.kind === 'goal' ? { gate: node.gate ?? 'all' } : {}),
    ...(node.when ? { when: node.when } : {}),
    ...(node.optional ? { optional: true } : {}),
    ...(node.notes ? { notes: node.notes } : {}),
  };
  const at = after ? nodes.findIndex((n) => n.id === after) : -1;
  const next = at >= 0 ? [...nodes.slice(0, at + 1), made, ...nodes.slice(at + 1)] : [...nodes, made];
  return { project: setTree(project, id, next), nodeId: made.id };
};

export const updateNode = (project: Project, id: string, nodeId: string, patch: Partial<Omit<PuzzleNode, 'id'>>): Project => {
  const nodes = nodesOf(project.objects[id]);
  return setTree(
    project,
    id,
    nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const next: PuzzleNode = { ...n, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
      if (next.kind === 'goal') {
        next.gate ??= 'all';
        delete next.when;
      } else delete next.gate;
      return next;
    }),
  );
};

/** Take a node out, and everything under it. */
export const removeNode = (project: Project, id: string, nodeId: string): Project => {
  const nodes = nodesOf(project.objects[id]);
  const gone = new Set([nodeId, ...descendantsOf(nodes, nodeId).map((n) => n.id)]);
  return setTree(project, id, nodes.filter((n) => !gone.has(n.id)));
};

/** Put a node under another sub-goal (or the puzzle's goal), never under itself. */
export const moveNode = (project: Project, id: string, nodeId: string, parentId: string | null): Project => {
  const nodes = nodesOf(project.objects[id]);
  const parent = parentId ? nodes.find((n) => n.id === parentId) : null;
  if (parentId && (!parent || parent.kind !== 'goal' || parentId === nodeId || descendantsOf(nodes, nodeId).some((d) => d.id === parentId))) return project;
  return updateNode(project, id, nodeId, { parentId });
};

/** Up or down among its siblings. */
export const reorderNode = (project: Project, id: string, nodeId: string, by: -1 | 1): Project => {
  const nodes = nodesOf(project.objects[id]);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return project;
  const siblings = childrenOf(nodes, node.parentId);
  const at = siblings.findIndex((s) => s.id === nodeId);
  const other = siblings[at + by];
  if (!other) return project;
  const i = nodes.indexOf(node);
  const j = nodes.indexOf(other);
  const next = [...nodes];
  next[i] = other;
  next[j] = node;
  return setTree(project, id, next);
};

/** Make a node into a sub-goal holding a new step under it (nest). */
export const nestNode = (project: Project, id: string, nodeId: string): Project => {
  const nodes = nodesOf(project.objects[id]);
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return project;
  const at = childrenOf(nodes, node.parentId).findIndex((s) => s.id === nodeId);
  const above = childrenOf(nodes, node.parentId)[at - 1];
  if (!above || above.kind !== 'goal') return project;
  return moveNode(project, id, nodeId, above.id);
};

/** Out of its sub-goal, beside it. */
export const outdentNode = (project: Project, id: string, nodeId: string): Project => {
  const nodes = nodesOf(project.objects[id]);
  const node = nodes.find((n) => n.id === nodeId);
  const parent = node?.parentId ? nodes.find((n) => n.id === node.parentId) : undefined;
  if (!node || !parent) return project;
  return moveNode(project, id, nodeId, parent.parentId ?? null);
};

/**
 * Turn the written discoveries (one per line) into steps (§2): each line not
 * yet a step becomes a requirement under the puzzle's goal. A line ending in
 * a colon starts a sub-goal for the lines after it, until a blank line.
 */
export const stepsFromWriting = (project: Project, id: string): { project: Project; added: number } => {
  const puzzle = project.objects[id];
  const def = definitionOf(puzzle);
  const nodes = [...nodesOf(puzzle)];
  const have = new Set(nodes.map((n) => n.label.trim().toLowerCase()));
  let group: string | null = null;
  let added = 0;
  for (const raw of def.discoveries.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
    if (!line) {
      group = null;
      continue;
    }
    if (line.endsWith(':')) {
      const label = line.slice(0, -1).trim();
      const existing = nodes.find((n) => n.kind === 'goal' && n.label.trim().toLowerCase() === label.toLowerCase());
      if (existing) group = existing.id;
      else {
        const goal: PuzzleNode = { id: newId('pzn'), parentId: null, kind: 'goal', label, gate: 'all' };
        nodes.push(goal);
        have.add(label.toLowerCase());
        group = goal.id;
        added++;
      }
      continue;
    }
    if (have.has(line.toLowerCase())) continue;
    const verb = /^(inspect|look|read|move|push|pull|turn|rotate|enter|open|press|pick|take|use|place|put|combine|talk|ask|light)\b/i.test(line);
    nodes.push({ id: newId('pzn'), parentId: group, kind: verb ? 'interaction' : 'requirement', label: line });
    have.add(line.toLowerCase());
    added++;
  }
  return { project: added ? setTree(project, id, nodes) : project, added };
};

// ---------------------------------------------------------------- progress

/** Whether a node is done in a play state (its condition, or its steps), for the tree's ticks. */
export const nodeDone = (nodes: readonly PuzzleNode[], nodeId: string, puzzleId: string, holds: (rule: Rule) => boolean): boolean => {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return false;
  if (node.kind !== 'goal') return !!node.when && holds({ match: 'all', items: [node.when] });
  const rule = compileTree(nodes.filter((n) => n.id === nodeId || descendantsOf(nodes, nodeId).some((d) => d.id === n.id)).map((n) => (n.id === nodeId ? { ...n, parentId: null } : n)), puzzleId);
  return !isEmpty(rule) && holds(rule);
};

/** A step's condition in words, or why it has none. */
export const nodeWhenText = (project: Project, node: PuzzleNode): string =>
  node.kind === 'goal' ? (node.gate === 'any' ? 'Any one of its steps' : 'All of its steps') : node.when ? describeCondition(project, node.when) : 'Nothing marks it done yet';

// ---------------------------------------------------------------- validation (basic; §13 grows in phase 5)

export interface PuzzleIssue {
  severity: 'error' | 'warning';
  nodeId?: string;
  message: string;
}

/** What stops the puzzle being solved, or looks unfinished. */
export const puzzleIssues = (project: Project, id: string): PuzzleIssue[] => {
  const puzzle = project.objects[id];
  if (!puzzle) return [];
  const nodes = nodesOf(puzzle);
  const out: PuzzleIssue[] = [];
  const def = definitionOf(puzzle);
  if (!def.objective.trim()) out.push({ severity: 'warning', message: 'No player-facing objective yet.' });
  if (!nodes.length && isEmpty(puzzle.data.rule as Rule | undefined)) out.push({ severity: 'warning', message: 'Nothing solves it yet: build its steps, or give it a rule.' });
  for (const n of nodes) {
    if (n.parentId && !nodes.some((p) => p.id === n.parentId)) out.push({ severity: 'error', nodeId: n.id, message: `“${n.label}” is under a step that is gone.` });
    if (n.kind !== 'goal' && !n.when && !n.optional) out.push({ severity: 'error', nodeId: n.id, message: `“${n.label}” has nothing that marks it done, so the puzzle can't be solved.` });
    if (n.kind !== 'goal' && n.when && !project.objects[n.when.ref] && n.when.kind !== 'stat') out.push({ severity: 'error', nodeId: n.id, message: `“${n.label}” checks an element that is gone.` });
    if (n.kind === 'goal' && !childrenOf(nodes, n.id).some((c) => !c.optional)) out.push({ severity: 'error', nodeId: n.id, message: `“${n.label}” has no required steps under it.` });
    if (n.kind === 'goal' && n.gate === 'any' && childrenOf(nodes, n.id).filter((c) => !c.optional).length === 1) out.push({ severity: 'warning', nodeId: n.id, message: `“${n.label}” takes any one of its steps, but has only one.` });
    if (n.when?.kind === 'puzzle' && n.when.ref === id) out.push({ severity: 'error', nodeId: n.id, message: `“${n.label}” needs the puzzle itself solved: it never can be.` });
  }
  return out;
};

// ---------------------------------------------------------------- making one

/** A new puzzle, with its code and scale, ready to write (§2). */
export const createPuzzle = (project: Project, name: string, scale: PuzzleScale = 'area'): { project: Project; id: string } => {
  const format = ENTRY_CODE.puzzle;
  const object = makeObject('puzzle', name.trim() || 'New puzzle', new Date().toISOString(), { ...(format ? { code: nextCode(project, format) } : {}), scale });
  return { project: { ...project, objects: { ...project.objects, [object.id]: object } }, id: object.id };
};

/** What solving it does, in effects (§4 outputs): the puzzle's own "When solved". */
export const outputsOf = (puzzle: StoryObject | undefined): Effect[] => (puzzle?.data.effects as Effect[] | undefined) ?? [];

/** What a step can be made into in one go (§2: from words to game objects). */
export const MAKES: readonly { kind: 'item' | 'lore' | 'flag' | 'visited'; type: 'inventory' | 'lore' | 'state' | 'scene'; label: string }[] = [
  { kind: 'item', type: 'inventory', label: 'An item to carry' },
  { kind: 'lore', type: 'lore', label: 'A clue to learn (lore)' },
  { kind: 'flag', type: 'state', label: 'A state set to yes' },
];

/**
 * Make the story element a step is about, named after it, and have the step
 * done when it is carried, known or set (§2). The element is a Bible entry
 * like any other; the step only points at it.
 */
export const makeElementFor = (project: Project, id: string, nodeId: string, kind: (typeof MAKES)[number]['kind']): { project: Project; elementId: string } => {
  const node = nodesOf(project.objects[id]).find((n) => n.id === nodeId);
  const make = MAKES.find((m) => m.kind === kind);
  if (!node || node.kind === 'goal' || !make) return { project, elementId: '' };
  const name = node.label.replace(/^(pick up|take|find|get|obtain|learn|know|read)\s+(the\s+)?/i, '').trim() || node.label;
  const format = ENTRY_CODE[make.type];
  const element = makeObject(make.type, kind === 'flag' ? name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'state' : name.charAt(0).toUpperCase() + name.slice(1), new Date().toISOString(), {
    ...(format ? { code: nextCode(project, format) } : {}),
    // A clue isn't known until something reveals it (a clue in the level, an interaction).
    ...(kind === 'lore' ? { byEffect: true } : {}),
  });
  const withIt: Project = { ...project, objects: { ...project.objects, [element.id]: element } };
  const when: Condition =
    kind === 'item' ? { kind: 'item', ref: element.id, op: 'has' } : kind === 'lore' ? { kind: 'lore', ref: element.id, op: 'known' } : kind === 'flag' ? { kind: 'flag', ref: element.id, op: 'is', value: 'yes' } : { kind: 'visited', ref: element.id, op: 'visited' };
  return { project: updateNode(withIt, id, nodeId, { when }), elementId: element.id };
};
