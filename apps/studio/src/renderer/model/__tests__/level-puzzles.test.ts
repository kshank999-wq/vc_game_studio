import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { addLevel, levelsOf, placeAsset } from '../level/level';
import { interactWith, present, startLevelPlay } from '../level/play';
import { bindableNodes, bindToPuzzle, puzzleOverlay, puzzleRolesOf, puzzlesOf, puzzlesOnMap, puzzleSteps, unbindFromPuzzle } from '../level/puzzles';
import { addTravel, updateTravel } from '../level/travel';
import { sunkenVault } from '../sample';
import { setValue } from '../details';
import type { Project } from '../types';

const setup = () => {
  const project = sunkenVault();
  const set = levelsOf(project);
  const level = set.levels[0]!;
  const puzzle = puzzlesOf(project).find((p) => p.name === 'The Vault Door')!;
  const item = (name: string) => levelsOf(project).items.find((i) => i.name === name)!;
  const obj = (name: string) => Object.values(project.objects).find((o) => o.name === name)!;
  return { project, level, puzzle, item, obj };
};

const named = (p: Project, id?: string) => levelsOf(p).items.find((i) => i.id === id)?.name ?? levelsOf(p).travel?.find((t) => t.id === id)?.name;

describe('puzzles in the level (Level Designer spec V2 §14)', () => {
  it('reads a puzzle’s steps back from its rule: the state it needs, what sets it, and what that needs', () => {
    const { project, puzzle } = setup();
    // The sample's steps (built in the Puzzle Creator) name the lever and the drained seam.
    expect(puzzleSteps(project, puzzle.id).map((s) => [s.name, s.type, s.depth])).toEqual([
      ['Rusted Lever', 'object', 1],
      ['door_solved', 'state', 1],
      ['Seam drains', 'trigger', 1],
    ]);
    // A step a step back: a rule of its own that only names door_solved still finds the lever through the trigger.
    const plain = setValue(project, puzzle.id, 'rule', { match: 'all', items: [{ kind: 'flag', ref: Object.values(project.objects).find((o) => o.name === 'door_solved')!.id, op: 'is', value: 'yes' }] });
    expect(puzzleSteps(plain, puzzle.id).map((s) => [s.name, s.depth])).toEqual([['door_solved', 1], ['Seam drains', 1], ['Rusted Lever', 2]]);
    // A required object binds to the steps there are things for; a clue to lore.
    expect(bindableNodes(project, puzzle.id, 'required').map((n) => n.label)).toEqual(['Rusted Lever (Rusted Lever is up)', 'Seam drains (sets door_solved)']);
    expect(bindableNodes(project, puzzle.id, 'clue').map((n) => n.label)).toContain('Reveals The Last Expedition');
  });

  it('shows the sample’s puzzle where it is: the chamber, Mara’s clue, the lever, the water and the door', () => {
    const { project, level, puzzle } = setup();
    const o = puzzleOverlay(project, puzzle.id, level.id)!;
    expect(o.parts.map((p) => [p.role, named(project, p.itemId), p.bound])).toEqual([
      ['entry', 'Vault Chamber', true],
      ['gate', 'Bronze Door', false],
      ['clue', 'Mara at the door', true],
      ['required', 'Rusted Lever', false],
      ['gate', 'Flooded seam', false],
    ]);
    expect(o.parts.find((p) => named(project, p.itemId) === 'Flooded seam')!.why).toBe('there while Rusted Lever is not up');
    expect(o.parts.find((p) => named(project, p.itemId) === 'Rusted Lever')!.why).toBe('is Rusted Lever — Rusted Lever is up');
    expect(puzzlesOnMap(project, level.id).map((x) => x.puzzle.name)).toEqual(['The Vault Door']);
  });

  it('binds a gate and an output through the item’s presence, so play and the engines need nothing new', () => {
    const { project, level, puzzle } = setup();
    const placed = placeAsset(project, level.id, level.floors[0]!.id, 'logic.gate', { x: 2, y: 2 });
    const id = placed.ids[0]!;
    let p = bindToPuzzle(placed.project, id, { puzzle: puzzle.id, role: 'gate' });
    const get = () => levelsOf(p).items.find((i) => i.id === id)!;
    expect(get().activeWhen).toEqual({ match: 'all', items: [{ kind: 'puzzle', ref: puzzle.id, op: 'unsolved' }] });
    let s = startLevelPlay(p, level.id);
    expect(present(p, s, get())).toBe(true);
    s = { ...s, world: { ...s.world, solved: { ...s.world.solved, [puzzle.id]: true } } };
    expect(present(p, s, get())).toBe(false);
    expect(buildIR(p).levels[0]!.items.find((i) => i.guid === id)!.active_when).toBeTruthy();

    // Bound as its output instead: the gate's condition goes, the output's comes.
    p = bindToPuzzle(p, id, { puzzle: puzzle.id, role: 'output' });
    expect(get().activeWhen).toEqual({ match: 'all', items: [{ kind: 'puzzle', ref: puzzle.id, op: 'solved' }] });
    expect(get().puzzles).toEqual([{ puzzle: puzzle.id, role: 'output' }]);
    expect(present(p, s, get())).toBe(true);
    expect(puzzleRolesOf(p, id).map((r) => [r.role, r.bound])).toEqual([['output', true]]);
    // Unbound, it is as it was.
    p = unbindFromPuzzle(p, id, { puzzle: puzzle.id, role: 'output' });
    expect(get().activeWhen).toBeUndefined();
    expect(get().puzzles).toBeUndefined();
  });

  it('ties a required object to its step, and a clue to the lore it reveals, then lets go of them', () => {
    const { project, level, puzzle, obj } = setup();
    const key = obj('Vault Key');
    const lore = obj('The Last Expedition');
    const fid = level.floors[0]!.id;
    const a = placeAsset(project, level.id, fid, 'play.item', { x: 3, y: 3 });
    let p = bindToPuzzle(a.project, a.ids[0]!, { puzzle: puzzle.id, role: 'required', node: key.id });
    const pickup = () => levelsOf(p).items.find((i) => i.id === a.ids[0])!;
    expect(pickup().links).toEqual([key.id]);
    expect(pickup().params?.item).toBe(key.id);
    p = unbindFromPuzzle(p, a.ids[0]!, { puzzle: puzzle.id, role: 'required' });
    expect(pickup().links).toEqual([]);

    const b = placeAsset(p, level.id, fid, 'logic.interaction', { x: -3, y: 3 });
    p = bindToPuzzle(b.project, b.ids[0]!, { puzzle: puzzle.id, role: 'clue', node: lore.id });
    const clue = levelsOf(p).items.find((i) => i.id === b.ids[0])!;
    expect(clue.rules).toEqual([{ id: `puzzle_clue_${puzzle.id}`, on: 'interact', effects: [{ kind: 'revealLore', ref: lore.id }] }]);
    let s = startLevelPlay(p, level.id);
    expect(s.world.lore[lore.id]).toBeFalsy();
    s = interactWith(p, s, clue.id);
    expect(s.world.lore[lore.id]).toBe(true);
    p = unbindFromPuzzle(p, clue.id, { puzzle: puzzle.id, role: 'clue' });
    expect(levelsOf(p).items.find((i) => i.id === clue.id)!.rules).toBeUndefined();
  });

  it('finds routes it opens and its parts on other maps, and leaves locked items alone', () => {
    const { project, level, puzzle, item } = setup();
    const drawn = addTravel(project, { levelId: level.id, kind: 'trail', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], name: 'Dry seam' });
    let p = updateTravel(drawn.project, drawn.id, { locked: true, unlockWhen: { match: 'all', items: [{ kind: 'puzzle', ref: puzzle.id, op: 'solved' }] } });
    const other = addLevel(p, 'Upper galleries');
    p = other.project;
    const lid = other.id;
    const fid = levelsOf(p).levels.find((l) => l.id === lid)!.floors[0]!.id;
    const far = placeAsset(p, lid, fid, 'logic.gate', { x: 0, y: 0 });
    p = bindToPuzzle(far.project, far.ids[0]!, { puzzle: puzzle.id, role: 'output' });
    const o = puzzleOverlay(p, puzzle.id, level.id)!;
    expect(o.parts.filter((x) => x.travelId).map((x) => [x.role, named(p, x.travelId), x.why])).toEqual([['gate', 'Dry seam', 'locked until it is solved']]);
    expect(o.elsewhere).toEqual([{ levelId: lid, count: 1 }]);

    const door = item('Bronze Door');
    const locked = { ...p, levels: { ...levelsOf(p), items: levelsOf(p).items.map((i) => (i.id === door.id ? { ...i, locked: true } : i)) } };
    expect(bindToPuzzle(locked, door.id, { puzzle: puzzle.id, role: 'output' })).toBe(locked);
  });
});
