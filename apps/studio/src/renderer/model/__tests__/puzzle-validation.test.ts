import { describe, expect, it } from 'vitest';
import { setValue } from '../details';
import { levelsOf, updateItem } from '../level/level';
import { partsOfItem } from '../level/puzzles';
import { elementIssues } from '../puzzle/clues';
import { nodesOf, puzzleIssues, setTreeDrives, updateNode } from '../puzzle/design';
import { addElement, elementsOf } from '../puzzle/elements';
import { itemsForStep, placeOf, puzzleFromItem } from '../puzzle/level-link';
import { actionsNow, canSolve, solveIssues, stepNow, testWorld } from '../puzzle/solve';
import { BUILT_IN_TEMPLATES, puzzleFromTemplate } from '../puzzle/templates';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const vaultOf = (p: Project) => Object.values(p.objects).find((o) => o.type === 'puzzle' && o.name === 'The Vault Door')!;
const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!;

describe('can the player solve this? (puzzle spec §13)', () => {
  it('finds the way through the sample’s puzzle and the built-in templates', () => {
    const p = sunkenVault();
    expect(canSolve(p, vaultOf(p).id)).toMatchObject({ solvable: true, path: ['Rusted Lever: Pull'], neverDone: [], neverKnown: [], doneAtStart: [], bypassed: [] });
    const safe = puzzleFromTemplate(p, BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin.safe')!);
    const s = canSolve(safe.project, safe.id);
    expect(s.solvable).toBe(true);
    expect([...s.path].sort()).toEqual(['Desk drawer: Open', 'Painting: Inspect', 'Safe: Enter code (solve its screen)']);
  });

  it('says what can never be done, and which needed clue can never be found', () => {
    let p = sunkenVault();
    const vault = vaultOf(p);
    // The lever loses its Pull, and its level item its rule: nothing can drain the seam.
    const lever = byName(p, 'Rusted Lever');
    p = setValue(p, lever.id, 'interactions', []);
    p = updateItem(p, levelsOf(p).items.find((i) => i.name === 'Rusted Lever')!.id, { rules: [] });
    const s = canSolve(p, vault.id);
    expect([s.solvable, s.truncated, s.neverDone]).toEqual([false, false, ['Drain the seam', 'Pull the Rusted Lever', 'The seam drains']]);
    expect(solveIssues(p, vault.id, s).map((i) => i.message)).toEqual([
      'The player can’t solve it: nothing they can do gets there.',
      '“Drain the seam” can never be done.',
      '“Pull the Rusted Lever” can never be done.',
      '“The seam drains” can never be done.',
    ]);
    // A needed clue nothing reveals.
    const clue = addElement(p, vault.id, 'clue', 'Water marks');
    expect(canSolve(clue.project, vault.id).neverKnown).toEqual(['Water marks']);
  });

  it('notices a step done before the player does anything, and a step the puzzle can be solved without', () => {
    let p = sunkenVault();
    const vault = vaultOf(p);
    const lever = byName(p, 'Rusted Lever');
    p = setValue(p, lever.id, 'initialState', 'up');
    const s = canSolve(p, vault.id);
    expect(s.doneAtStart).toEqual(['Pull the Rusted Lever', 'The seam drains']);
    expect(solveIssues(p, vault.id, s).map((i) => i.message)).toContain('“Pull the Rusted Lever” is done before the player does anything: it can be skipped.');
    // Its own rule (not its steps) asks only for the lever: the drained seam can be bypassed.
    let q = setTreeDrives(setValue(p, lever.id, 'initialState', 'down'), vault.id, false);
    const door = byName(q, 'door_solved');
    q = setValue(q, door.id, 'initialState', 'no');
    q = setValue(q, vault.id, 'rule', { match: 'all', items: [{ kind: 'object', ref: lever.id, op: 'is', value: 'up' }] });
    // Drains nothing: the trigger no longer sets door_solved.
    q = setValue(q, byName(q, 'Seam drains').id, 'effects', []);
    expect(canSolve(q, vault.id)).toMatchObject({ solvable: true, bypassed: ['The seam drains'] });
  });
});

describe('test mode (puzzle spec §13)', () => {
  it('marks clues found and shows what opens up', () => {
    const made = puzzleFromTemplate(sunkenVault(), BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin.safe')!);
    const p = made.project;
    const [, , digits, order] = elementsOf(p, made.id);
    const step = (label: string) => nodesOf(p.objects[made.id]).find((n) => n.label === label)!.id;
    let w = testWorld(p);
    // What the player can do now that can matter to it (the sample's lever can't).
    const now = actionsNow(p, made.id, w).map((a) => a.label);
    expect(now).toEqual(['Safe: Inspect', 'Safe: Enter code (solve its screen)', 'Painting: Inspect', 'Desk drawer: Open']);
    expect(now).not.toContain('Safe: Take');
    expect(stepNow(p, made.id, w, step('Learn the first two digits'))).toBe('open');
    expect(stepNow(p, made.id, w, step('Enter the code'))).toBe('locked');
    // Both clues known by hand: the work is done, entering the code opens.
    w = { ...w, lore: { ...w.lore, [digits!.id]: true, [order!.id]: true } };
    const r = actionsNow(p, made.id, w).find((a) => a.label.startsWith('Safe: Enter code'))!.run(w);
    expect(stepNow(p, made.id, r, step('Work out the code'))).toBe('done');
    expect(r.solved[made.id]).toBe(true);
  });
});

describe('more checks (puzzle spec §13)', () => {
  it('flags an element nothing connects, and lets circular links be intended', () => {
    let p = sunkenVault();
    const vault = vaultOf(p);
    const stray = addElement(p, vault.id, 'custom', 'Old crate');
    p = stray.project;
    expect(elementIssues(p, vault.id).map((i) => i.message)).toContain('“Old crate” is part of it, but nothing connects it: no step needs it, and it changes nothing a step does.');
    // Two steps needing each other: an error, unless intended.
    const [a, b] = nodesOf(p.objects[vault.id]).filter((n) => n.kind !== 'goal');
    p = updateNode(p, vault.id, b!.id, { requires: [a!.id] });
    p = updateNode(p, vault.id, a!.id, { requires: [b!.id] });
    expect(puzzleIssues(p, vault.id).find((i) => /each need the other/.test(i.message))!.severity).toBe('error');
    p = setValue(p, vault.id, 'cycles', 'allowed');
    expect(puzzleIssues(p, vault.id).find((i) => /each need the other/.test(i.message))!.severity).toBe('warning');
  });
});

describe('the Level Designer and the Puzzle Creator (puzzle spec §12)', () => {
  it('makes a puzzle from a door: its element, its first step, the door standing for it', () => {
    const p0 = sunkenVault();
    const door = levelsOf(p0).items.find((i) => i.name === 'Bronze Door')!;
    const { project: p, puzzleId } = puzzleFromItem(p0, door.id);
    const pz = p.objects[puzzleId]!;
    expect([pz.name, pz.data.scale, pz.data.objective]).toEqual(['Bronze Door puzzle', 'object', 'Work the Bronze Door']);
    const els = elementsOf(p, puzzleId);
    expect(els.map((e) => [e.name, e.data.elementKind])).toEqual([['Bronze Door', 'door']]);
    expect(nodesOf(pz).map((n) => n.label)).toEqual(['Bronze Door: Open']);
    expect(levelsOf(p).items.find((i) => i.id === door.id)!.links).toContain(els[0]!.id);
    expect(itemsForStep(p, puzzleId, nodesOf(pz)[0]!.id).map((i) => i.name)).toEqual(['Bronze Door']);
    // Its breadcrumbs: the maps down to it, the room it is in.
    const place = placeOf(p, puzzleId)!;
    expect([place.maps.map((m) => m.name), place.room?.name, place.item.name]).toEqual([['The Drowned Coast', 'Sunken Vault'], 'Vault Chamber', 'Bronze Door']);
  });

  it('makes a puzzle from a room: it is where the puzzle is played', () => {
    const p0 = sunkenVault();
    const room = levelsOf(p0).items.find((i) => i.name === 'Vault Chamber')!;
    const { project: p, puzzleId } = puzzleFromItem(p0, room.id);
    expect(p.objects[puzzleId]!.data.scale).toBe('area');
    expect(partsOfItem(p, puzzleId, levelsOf(p).items.find((i) => i.id === room.id)!).map((x) => x.role)).toEqual(['entry']);
    expect(placeOf(p, puzzleId)?.room?.name).toBe('Vault Chamber');
  });
});
