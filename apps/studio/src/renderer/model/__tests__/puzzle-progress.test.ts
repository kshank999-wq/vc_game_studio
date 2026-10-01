import { describe, expect, it } from 'vitest';
import { levelsOf } from '../level/level';
import { startLevelPlay, startPoint, tick } from '../level/play';
import { applyStoryEffects, startWorld } from '../play';
import { addRequire, compileTree, createPuzzle, dependsOn, makeElementFor, nodesOf, puzzleIssues, removeNode, removeRequire, setTree, type PuzzleNode } from '../puzzle/design';
import { advance, stepStatus, type StepProgress } from '../puzzle/progress';
import type { Condition, Rule } from '../rules';
import { sunkenVault } from '../sample';

const flag = (ref: string): Condition => ({ kind: 'flag', ref, op: 'is', value: 'yes' });
const leaf = (id: string, parentId: string | null, extra: Partial<PuzzleNode> = {}): PuzzleNode => ({ id, parentId, kind: 'interaction', label: id, when: flag(id), ...extra });
const goal = (id: string, parentId: string | null, extra: Partial<PuzzleNode> = {}): PuzzleNode => ({ id, parentId, kind: 'goal', label: id, ...extra });

/** A puzzle of these steps, and a game where the named facts hold. */
const with_ = (nodes: PuzzleNode[], reset?: 'onFail' | 'never') => {
  const made = createPuzzle(sunkenVault(), 'The Safe', 'object');
  let project = setTree(made.project, made.id, nodes);
  if (reset) project = { ...project, objects: { ...project.objects, [made.id]: { ...project.objects[made.id]!, data: { ...project.objects[made.id]!.data, reset } } } };
  return { project, id: made.id, puzzle: project.objects[made.id]! };
};
const facts = (...on: string[]) => (rule: Rule) => rule.items.every((c) => 'ref' in c && on.includes(c.ref));
const done = (p: StepProgress) => Object.entries(p.done).sort((a, b) => a[1] - b[1]).map(([id]) => id);

describe('puzzle progress (puzzle spec §6)', () => {
  it('keeps a sequence in order: a later step waits for the one before it', () => {
    const { puzzle } = with_([goal('dial', null, { gate: 'sequence' }), leaf('first', 'dial'), leaf('second', 'dial'), leaf('third', 'dial')]);
    let r = advance(puzzle, undefined, facts('second', 'third'));
    expect(done(r.progress)).toEqual([]);
    expect(stepStatus(nodesOf(puzzle), r.progress, nodesOf(puzzle)[2]!)).toBe('locked');
    r = advance(puzzle, r.progress, facts('first'));
    expect(done(r.progress)).toEqual(['first']);
    expect(r.solved).toBe(false);
    // Done stays done: the first step's fact can go.
    r = advance(puzzle, r.progress, facts('second', 'third'));
    expect(done(r.progress)).toEqual(['first', 'second', 'third', 'dial']);
    expect(r.solved).toBe(true);
    expect(r.events.map((e) => `${e.label} ${e.what}`)).toEqual(['second done', 'third done', 'dial done']);
  });

  it('waits on what a step needs first, and refuses links that go round', () => {
    const { project, id } = with_([leaf('key', null), leaf('door', null)]);
    let p = addRequire(project, id, 'door', 'key');
    expect(nodesOf(p.objects[id]).find((n) => n.id === 'door')!.requires).toEqual(['key']);
    expect(dependsOn(nodesOf(p.objects[id]), 'door', 'key')).toBe(true);
    expect(addRequire(p, id, 'key', 'door')).toBe(p);
    let r = advance(p.objects[id]!, undefined, facts('door'));
    expect(done(r.progress)).toEqual([]);
    r = advance(p.objects[id]!, r.progress, facts('door', 'key'));
    expect(done(r.progress)).toEqual(['key', 'door']);
    // The engines get it as part of the rule: door holds only with key.
    expect(compileTree(nodesOf(p.objects[id]), id).items[1]).toEqual({ match: 'all', items: [flag('door'), flag('key')] });
    p = removeRequire(p, id, 'door', 'key');
    expect(nodesOf(p.objects[id]).find((n) => n.id === 'door')!.requires).toBeUndefined();
    // Removing a step takes the links to it.
    p = removeNode(addRequire(p, id, 'door', 'key'), id, 'key');
    expect(nodesOf(p.objects[id])[0]!.requires).toBeUndefined();
  });

  it('runs a timed sub-goal on the clock: run out and what was done under it is undone', () => {
    const { puzzle } = with_([goal('rush', null, { within: 10 }), leaf('a', 'rush'), leaf('b', 'rush')]);
    let r = advance(puzzle, undefined, facts('a'), 0);
    expect(r.progress.begun.rush).toBe(0);
    r = advance(puzzle, r.progress, facts(), 11);
    expect(done(r.progress)).toEqual([]);
    expect(r.events.map((e) => e.what)).toEqual(['expired']);
    expect(r.progress.stale).toEqual({});
    // In time this time.
    r = advance(puzzle, r.progress, facts('a'), 20);
    r = advance(puzzle, r.progress, facts('b'), 25);
    expect(r.solved).toBe(true);
    // Without a clock (the story play-through) the time limit doesn't apply.
    expect(advance(puzzle, advance(puzzle, undefined, facts('a')).progress, facts('b')).solved).toBe(true);
  });

  it('notices a wrong move once, resets on it if the puzzle says so, and fail-forward counts it done', () => {
    const wrong = { when: flag('alarm'), effects: [{ kind: 'setFlag' as const, ref: 'guards', value: 'yes' }] };
    let { puzzle } = with_([leaf('pick', null, { fail: wrong }), leaf('open', null)], 'onFail');
    let r = advance(puzzle, undefined, facts('open'));
    expect(done(r.progress)).toEqual(['open']);
    r = advance(puzzle, r.progress, facts('open', 'alarm'));
    // Reset: progress goes; a step still holding must be done anew.
    expect(r.events.map((e) => `${e.label} ${e.what}`)).toEqual(['pick failed', 'pick reset']);
    expect(done(advance(puzzle, r.progress, facts('open', 'alarm')).progress)).toEqual([]);
    expect(r.effects).toEqual(wrong.effects);
    expect(r.progress.fails).toBe(1);
    // It lasting isn't another wrong move.
    const again = advance(puzzle, r.progress, facts('alarm'));
    expect(again.progress.fails).toBe(1);

    ({ puzzle } = with_([leaf('pick', null, { fail: { ...wrong, forward: true } }), leaf('open', null)]));
    r = advance(puzzle, undefined, facts('alarm', 'open'));
    expect(done(r.progress)).toEqual(['pick', 'open']);
    expect(r.solved).toBe(true);
    expect(compileTree(nodesOf(puzzle), puzzle.id).items[0]).toEqual({ match: 'any', items: [flag('pick'), flag('alarm')] });
  });

  it('fires a step’s effects when it is first done, and leaves optional steps out of solving', () => {
    const reward = [{ kind: 'setFlag' as const, ref: 'bonus', value: 'yes' }];
    const { puzzle } = with_([leaf('main', null), leaf('extra', null, { optional: true, branch: 'reward', effects: reward })]);
    let r = advance(puzzle, undefined, facts('main'));
    expect(r.solved).toBe(true);
    r = advance(puzzle, undefined, facts('extra'));
    expect(r.effects).toEqual(reward);
    expect(advance(puzzle, r.progress, facts('extra')).effects).toEqual([]);
  });

  it('says what can’t work: links round in a circle, no time, a sequence with optional steps, a wrong move that stops it for good', () => {
    const { project, id } = with_(
      [goal('g', null, { gate: 'sequence', within: -1 }), leaf('a', 'g', { requires: ['b'] }), leaf('b', 'g', { requires: ['a'] }), leaf('c', 'g', { optional: true }), leaf('d', null, { fail: { when: flag('x') } })],
      'never',
    );
    const messages = puzzleIssues(project, id).map((i) => i.message).join('\n');
    expect(messages).toMatch(/each need/i);
    expect(messages).toMatch(/time limit/i);
    expect(messages).toMatch(/optional/i);
    expect(messages).toMatch(/for good/i);
    expect(messages).toMatch(/engines get the conditions/);
  });

  it('plays through in the story: steps done in order solve the puzzle and fire their effects', () => {
    let { project, id } = with_([goal('dial', null, { gate: 'sequence' }), { ...leaf('first', 'dial'), when: undefined }, { ...leaf('second', 'dial'), when: undefined }]);
    project = makeElementFor(project, id, 'first', 'flag').project;
    project = makeElementFor(project, id, 'second', 'flag').project;
    const ref = (n: string) => (nodesOf(project.objects[id]).find((x) => x.id === n)!.when as { ref: string }).ref;
    let world = startWorld(project);
    world = applyStoryEffects(project, world, [{ kind: 'setFlag', ref: ref('second'), value: 'yes' }]).world;
    expect(world.solved[id]).toBeFalsy();
    expect(world.steps?.[id]?.done.second).toBeUndefined();
    const after = applyStoryEffects(project, world, [{ kind: 'setFlag', ref: ref('first'), value: 'yes' }]);
    expect(after.world.solved[id]).toBe(true);
    expect(after.log.map((l) => ('text' in l ? l.text : '')).filter((t) => t.startsWith('The Safe:'))).toEqual(['The Safe: first done', 'The Safe: second done', 'The Safe: dial done']);
  });
});


describe('timed puzzle steps in Play Mode', () => {
  it('runs the play clock: a timed sub-goal begun and left too long is undone', () => {
    let { project, id } = with_([goal('rush', null, { within: 5 }), { ...leaf('a', 'rush'), when: undefined }, { ...leaf('b', 'rush'), when: undefined }]);
    project = makeElementFor(project, id, 'a', 'flag').project;
    project = makeElementFor(project, id, 'b', 'flag').project;
    const ref = (n: string) => (nodesOf(project.objects[id]).find((x) => x.id === n)!.when as { ref: string }).ref;
    const level = levelsOf(project).levels[0]!;
    const at = startPoint(project, level.id);
    let s = startLevelPlay(project, level.id);
    s = tick(project, s, 1, at);
    expect(s.world.clock).toBe(1);
    s = { ...s, world: applyStoryEffects(project, s.world, [{ kind: 'setFlag', ref: ref('a'), value: 'yes' }]).world };
    expect(s.world.steps?.[id]?.begun.rush).toBe(1);
    for (let n = 0; n < 6; n++) s = tick(project, s, 1, at);
    expect(s.world.steps?.[id]?.done.a).toBeUndefined();
    expect(s.log.some((l) => /out of time/.test(l.text))).toBe(true);
    // Still set, it doesn't count again until it is done anew.
    s = tick(project, s, 1, at);
    expect(s.world.steps?.[id]?.done.a).toBeUndefined();
    expect(s.world.steps?.[id]?.stale).toEqual({ a: true });
  });
});
