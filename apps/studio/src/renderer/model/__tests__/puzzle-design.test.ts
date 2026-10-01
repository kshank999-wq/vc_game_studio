import { describe, expect, it } from 'vitest';
import { setValue } from '../details';
import { startPlay } from '../play';
import {
  addNode,
  compileTree,
  createPuzzle,
  definitionOf,
  flatten,
  makeElementFor,
  moveNode,
  nestNode,
  nodeDone,
  nodesOf,
  outdentNode,
  puzzleIssues,
  removeNode,
  reorderNode,
  setTreeDrives,
  stepsFromWriting,
  treeDrives,
  updateDefinition,
  updateNode,
} from '../puzzle/design';
import { evaluate, type Rule } from '../rules';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const fresh = () => {
  const made = createPuzzle(sunkenVault(), 'The Safe', 'object');
  return { project: made.project, id: made.id };
};
const tree = (p: Project, id: string) => flatten(nodesOf(p.objects[id])).map(({ node, depth }) => `${'  '.repeat(depth)}${node.kind}:${node.label}${node.gate === 'any' ? ' (any)' : ''}${node.optional ? ' (optional)' : ''}`);
const id = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;

describe('the Puzzle Creator (puzzle spec)', () => {
  it('starts a puzzle in words, with its definition kept as fields (§2, §4)', () => {
    let { project, id: safe } = fresh();
    expect(project.objects[safe]).toMatchObject({ type: 'puzzle', name: 'The Safe', data: { code: 'PZ-02', scale: 'object' } });
    project = updateDefinition(project, safe, { objective: 'Open the safe', concept: 'A four-digit safe in the study.', difficulty: 3, minutes: 6, reset: 'onFail', retries: 3 });
    expect(definitionOf(project.objects[safe])).toMatchObject({ scale: 'object', objective: 'Open the safe', concept: 'A four-digit safe in the study.', difficulty: 3, minutes: 6, reset: 'onFail', retries: 3 });
    // Strings, so the Bible and the engines read them as fields.
    expect(project.objects[safe]!.data.difficulty).toBe('3');
    expect(puzzleIssues(project, safe).map((i) => i.message)).toEqual(['Nothing solves it yet: build its steps, or give it a rule.']);
  });

  it('turns the written discoveries into steps, a colon starting a sub-goal', () => {
    let { project, id: safe } = fresh();
    project = updateDefinition(project, safe, { discoveries: 'Find the code:\n- Read the torn note\n- Inspect the painting\n\nEnter the code\nCarry the safe key' });
    const made = stepsFromWriting(project, safe);
    expect(made.added).toBe(5);
    expect(tree(made.project, safe)).toEqual(['goal:Find the code', '  interaction:Read the torn note', '  interaction:Inspect the painting', 'interaction:Enter the code', 'requirement:Carry the safe key']);
    // Again: nothing new.
    expect(stepsFromWriting(made.project, safe).added).toBe(0);
  });

  it('builds a hierarchy: nest, outdent, reorder, move, delete with what is under it (§5)', () => {
    let { project, id: safe } = fresh();
    const goal = addNode(project, safe, { kind: 'goal', label: 'Find the code' });
    project = goal.project;
    const a = addNode(project, safe, { kind: 'interaction', label: 'Read the note', parentId: goal.nodeId });
    project = a.project;
    const b = addNode(project, safe, { kind: 'requirement', label: 'Carry the key' });
    project = b.project;
    expect(tree(project, safe)).toEqual(['goal:Find the code', '  interaction:Read the note', 'requirement:Carry the key']);
    project = nestNode(project, safe, b.nodeId);
    expect(tree(project, safe)).toEqual(['goal:Find the code', '  interaction:Read the note', '  requirement:Carry the key']);
    project = reorderNode(project, safe, b.nodeId, -1);
    expect(tree(project, safe)[1]).toBe('  requirement:Carry the key');
    project = outdentNode(project, safe, b.nodeId);
    expect(tree(project, safe)).toEqual(['goal:Find the code', '  interaction:Read the note', 'requirement:Carry the key']);
    // A sub-goal can't go under its own step.
    expect(moveNode(project, safe, goal.nodeId, a.nodeId)).toBe(project);
    project = removeNode(project, safe, goal.nodeId);
    expect(tree(project, safe)).toEqual(['requirement:Carry the key']);
  });

  it('compiles the tree into the puzzle’s rule: all, any, optional steps left out (§5, §6)', () => {
    let { project, id: safe } = fresh();
    const key = id(project, 'Vault Key');
    const lore = id(project, 'The Last Expedition');
    const goal = addNode(project, safe, { kind: 'goal', label: 'Know the code', gate: 'any' });
    project = goal.project;
    project = addNode(project, safe, { kind: 'requirement', label: 'Read the journal', parentId: goal.nodeId, when: { kind: 'lore', ref: lore, op: 'known' } }).project;
    project = addNode(project, safe, { kind: 'requirement', label: 'Ask Mara', parentId: goal.nodeId, when: { kind: 'visited', ref: id(project, 'The Vault Door'), op: 'visited' } }).project;
    project = addNode(project, safe, { kind: 'requirement', label: 'Carry the key', when: { kind: 'item', ref: key, op: 'has' } }).project;
    project = addNode(project, safe, { kind: 'requirement', label: 'A bonus', optional: true }).project;
    expect(treeDrives(project.objects[safe])).toBe(true);
    const rule = project.objects[safe]!.data.rule as Rule;
    expect(rule).toEqual({
      match: 'all',
      items: [
        { match: 'any', items: [{ kind: 'lore', ref: lore, op: 'known' }, { kind: 'visited', ref: expect.any(String), op: 'visited' }] },
        { kind: 'item', ref: key, op: 'has' },
      ],
    });
    // The play-through solves it by that rule, as it always has.
    const w = startPlay(project).world;
    expect(evaluate(rule, w)).toBe(false);
    const holding = { ...w, items: { ...w.items, [key]: 1 }, lore: { ...w.lore, [lore]: true } };
    expect(evaluate(rule, holding)).toBe(true);
    const nodes = nodesOf(project.objects[safe]);
    expect(nodeDone(nodes, goal.nodeId, safe, (r) => evaluate(r, holding))).toBe(true);
    expect(nodeDone(nodes, goal.nodeId, safe, (r) => evaluate(r, w))).toBe(false);
    // The designer keeps a rule of their own: the tree stops writing it.
    project = setTreeDrives(project, safe, false);
    project = setValue(project, safe, 'rule', { match: 'all', items: [{ kind: 'item', ref: key, op: 'has' }] });
    project = addNode(project, safe, { kind: 'requirement', label: 'Another' }).project;
    expect((project.objects[safe]!.data.rule as Rule).items).toHaveLength(1);
  });

  it('never solves a step with nothing to mark it done, and says why', () => {
    let { project, id: safe } = fresh();
    const goal = addNode(project, safe, { kind: 'goal', label: 'Empty goal' });
    project = goal.project;
    const step = addNode(project, safe, { kind: 'interaction', label: 'Enter the code' });
    project = step.project;
    const rule = project.objects[safe]!.data.rule as Rule;
    // Never true until the puzzle is solved (an empty rule would always hold).
    expect(evaluate(rule, startPlay(project).world)).toBe(false);
    expect(compileTree([], safe)).toEqual({ match: 'all', items: [{ kind: 'puzzle', ref: safe, op: 'solved' }] });
    expect(puzzleIssues(project, safe).filter((i) => i.severity === 'error').map((i) => i.message)).toEqual(['“Empty goal” has no required steps under it.', '“Enter the code” has nothing that marks it done, so the puzzle can\'t be solved.']);
    // Gone: the rule it wrote goes too.
    project = removeNode(removeNode(project, safe, goal.nodeId), safe, step.nodeId);
    expect(project.objects[safe]!.data.rule).toBeUndefined();
  });

  it('makes the element a step is about, from its words (§2)', () => {
    let { project, id: safe } = fresh();
    const note = addNode(project, safe, { kind: 'interaction', label: 'Pick up the torn note' });
    project = makeElementFor(note.project, safe, note.nodeId, 'item').project;
    const made = Object.values(project.objects).find((o) => o.name === 'Torn note')!;
    expect(made).toMatchObject({ type: 'inventory' });
    expect(nodesOf(project.objects[safe])[0]!.when).toEqual({ kind: 'item', ref: made.id, op: 'has' });
    const clue = addNode(project, safe, { kind: 'requirement', label: 'Learn the order of the digits' });
    project = makeElementFor(clue.project, safe, clue.nodeId, 'lore').project;
    const lore = Object.values(project.objects).find((o) => o.name === 'Order of the digits')!;
    // A clue isn't known until something reveals it.
    expect(lore).toMatchObject({ type: 'lore', data: { byEffect: true } });
    const flag = addNode(project, safe, { kind: 'requirement', label: 'Power restored' });
    project = makeElementFor(flag.project, safe, flag.nodeId, 'flag').project;
    expect(Object.values(project.objects).find((o) => o.name === 'power_restored')).toMatchObject({ type: 'state' });
    project = updateNode(project, safe, flag.nodeId, { kind: 'goal' });
    expect(nodesOf(project.objects[safe]).find((n) => n.id === flag.nodeId)).toMatchObject({ kind: 'goal', gate: 'all' });
    expect(nodesOf(project.objects[safe]).find((n) => n.id === flag.nodeId)!.when).toBeUndefined();
  });

  it('the sample’s Vault Door: written, its steps solving it as before', () => {
    const p = sunkenVault();
    const door = Object.values(p.objects).find((o) => o.type === 'puzzle')!;
    expect(definitionOf(door).objective).toBe('Open the vault door');
    expect(tree(p, door.id)).toEqual(['goal:Drain the seam', '  interaction:Pull the Rusted Lever', '  requirement:The seam drains', 'requirement:Hear Mara at the door (optional)']);
    expect(puzzleIssues(p, door.id)).toEqual([]);
  });
});
