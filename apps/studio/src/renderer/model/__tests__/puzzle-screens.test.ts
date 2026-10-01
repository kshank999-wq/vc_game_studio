import { describe, expect, it } from 'vitest';
import { interactionsOf } from '../details';
import { levelsOf, placeAsset, updateItem } from '../level/level';
import { answerScreen, interactWith, startLevelPlay } from '../level/play';
import { settleWorld, startWorld, useStoryObject } from '../play';
import { elementIssues } from '../puzzle/clues';
import { elementsOf } from '../puzzle/elements';
import { act, circuitJoined, defaultScreen, isRight, makeScreen, removeScreen, SCREEN_KINDS, screenInteraction, screenIssues, screenOf, startScreen, updateScreen, type ScreenAction, type ScreenPuzzle, type ScreenState } from '../puzzle/screens';
import { BUILT_IN_TEMPLATES, puzzleFromTemplate } from '../puzzle/templates';
import { sunkenVault } from '../sample';

const run = (s: ScreenPuzzle, actions: ScreenAction[], start = startScreen(s, 'test')) => {
  let st: ScreenState = start;
  let outcome: string | undefined;
  for (const a of actions) {
    const r = act(undefined, s, st, a);
    st = r.state;
    outcome = r.outcome ?? outcome;
  }
  return { st, outcome };
};

describe('screen-level puzzles (puzzle spec §8)', () => {
  it('has every kind the spec names', () => {
    expect(SCREEN_KINDS.map((k) => k.label)).toEqual(['Keypad', 'Combination dial', 'Sliding tiles', 'Symbol sequence', 'Rotating rings', 'Circuit routing', 'Object assembly', 'Matching', 'Ordering', 'Lever / switch logic', 'Custom']);
    // Each starts unsolved, and its default can be solved.
    for (const k of SCREEN_KINDS) {
      const s = defaultScreen(k.id);
      expect(isRight(undefined, s, startScreen(s, 'x')), k.id).toBe(false);
    }
  });

  it('keypad: a wrong code buzzes and counts, the right one opens; out of tries, it locks', () => {
    const s = { ...defaultScreen('keypad'), code: '42', attempts: 2 };
    const wrong = run(s, [{ type: 'press', key: '1' }, { type: 'press', key: '2' }, { type: 'submit' }]);
    expect([wrong.outcome, wrong.st.tries, wrong.st.entry, wrong.st.message]).toEqual(['wrong', 1, [], 'A buzz. Wrong code.']);
    // Never more keys than the code is long.
    expect(run(s, [{ type: 'press', key: '4' }, { type: 'press', key: '2' }, { type: 'press', key: '9' }]).st.entry).toEqual(['4', '2']);
    const right = run(s, [{ type: 'press', key: '4' }, { type: 'press', key: '2' }, { type: 'submit' }], wrong.st);
    expect([right.outcome, right.st.solved, right.st.message]).toEqual(['right', true, 'A click: it opens.']);
    const locked = run(s, [{ type: 'submit' }, { type: 'press', key: '4' }, { type: 'press', key: '2' }, { type: 'submit' }], wrong.st);
    expect([locked.st.locked, locked.st.solved]).toEqual([true, false]);
  });

  it('dial, symbols, assembly, matching, ordering, custom: solved when the answer is given', () => {
    const dial = defaultScreen('dial');
    expect(run(dial, [{ type: 'turn', by: 12 }, { type: 'set' }, { type: 'turn', by: 18 }, { type: 'set' }, { type: 'turn', by: -23 }, { type: 'set' }, { type: 'submit' }]).st.solved).toBe(true);
    // Round the back: 0 − 1 is 39.
    expect(run(dial, [{ type: 'turn', by: -1 }]).st.dial).toBe(39);
    const sym = defaultScreen('symbols');
    expect(run(sym, [...sym.answer!.map((key) => ({ type: 'press', key }) as const), { type: 'submit' }]).st.solved).toBe(true);
    const asm = defaultScreen('assembly');
    expect(run(asm, [...asm.slots!.map((sl) => ({ type: 'place', slot: sl.id, part: sl.accepts }) as const), { type: 'submit' }]).st.solved).toBe(true);
    // A part goes in one slot at a time.
    expect(run(asm, [{ type: 'place', slot: 's1', part: 'p1' }, { type: 'place', slot: 's2', part: 'p1' }]).st.placed).toEqual({ s2: 'p1' });
    const match = defaultScreen('matching');
    expect(run(match, [...match.pairs!.map((_, i) => ({ type: 'match', left: i, right: i }) as const), { type: 'submit' }]).st.solved).toBe(true);
    const ord = defaultScreen('ordering');
    let st = startScreen(ord, 't');
    expect(st.order).not.toEqual([0, 1, 2, 3]);
    for (let pass = 0; pass < 4; pass++) for (let i = 0; i < 3; i++) if (st.order[i]! > st.order[i + 1]!) st = act(undefined, ord, st, { type: 'move', at: i, by: 1 }).state;
    expect(act(undefined, ord, st, { type: 'submit' }).state.solved).toBe(true);
    const custom = defaultScreen('custom');
    expect(run(custom, [{ type: 'type', text: '  ANSWER ' }, { type: 'submit' }]).st.solved).toBe(true);
  });

  it('tiles, rings, circuit, levers: solved the moment they are right', () => {
    const tiles = { ...defaultScreen('tiles'), shuffle: 1 };
    const st = startScreen(tiles, 'one');
    expect(st.tiles.indexOf(0)).not.toBe(8);
    const slid = act(undefined, tiles, st, { type: 'slide', at: 8 });
    expect([slid.outcome, slid.state.solved]).toEqual(['right', true]);
    // Only a tile next to the gap moves.
    expect(act(undefined, { ...defaultScreen('tiles') }, startScreen(defaultScreen('tiles'), 'x'), { type: 'slide', at: -1 }).state.tiles).toEqual(startScreen(defaultScreen('tiles'), 'x').tiles);

    const rings = defaultScreen('rings');
    const back = rings.start!.flatMap((n, ring) => Array.from({ length: n }, () => ({ type: 'rotate', ring, by: -1 }) as const));
    expect(run(rings, back).outcome).toBe('right');

    const circuit = defaultScreen('circuit');
    expect(circuitJoined(circuit, circuit.cells!.map((c) => c.rot))).toBe(true);
    const c0 = startScreen(circuit, 'c');
    expect(circuitJoined(circuit, c0.rot)).toBe(false);
    const spins = circuit.cells!.flatMap((c, i) => Array.from({ length: (((c.rot - c0.rot[i]!) % 4) + 4) % 4 }, () => ({ type: 'spin', cell: i }) as const));
    expect(run(circuit, spins, c0).st.solved).toBe(true);

    const levers = defaultScreen('levers');
    const solvedBy = Array.from({ length: 16 }, (_, mask) => [0, 1, 2, 3].filter((i) => mask & (1 << i))).find((flips) => run(levers, flips.map((i) => ({ type: 'flip', switch: i }) as const)).st.solved);
    expect(solvedBy).toEqual([0, 3]);
  });

  it('says when a screen can’t be done', () => {
    let p = sunkenVault();
    const lever = Object.values(p.objects).find((o) => o.name === 'Rusted Lever')!;
    p = makeScreen(p, lever.id, 'circuit');
    expect(screenIssues(p, p.objects[lever.id]!)).toEqual([]);
    // The made screen opens on the lever's own Pull.
    expect(screenInteraction(p.objects[lever.id])?.verb).toBe('Pull');
    p = updateScreen(p, lever.id, { cells: defaultScreen('circuit').cells!.map((c, i) => (i === 4 ? { piece: 'empty', rot: 0 } : c)) });
    expect(screenIssues(p, p.objects[lever.id]!)).toEqual(['Rusted Lever’s circuit doesn’t join the source to the sink, even solved.']);
    p = updateScreen(p, lever.id, { ...defaultScreen('levers'), switches: ['A', 'B'], links: [[1], [0]], startOn: [false, false], target: [true, false] });
    expect(screenIssues(p, p.objects[lever.id]!)).toEqual(['Rusted Lever’s switches can never all be set right.']);
    p = updateScreen(p, lever.id, { ...defaultScreen('keypad'), code: '12A' });
    expect(screenIssues(p, p.objects[lever.id]!)).toEqual(['Rusted Lever’s code uses keys the keypad hasn’t got.']);
    p = removeScreen(p, lever.id);
    expect([screenOf(p.objects[lever.id]), interactionsOf(p.objects[lever.id]).some((i) => i.screen)]).toEqual([undefined, false]);
  });
});

describe('a screen puzzle in play', () => {
  const safeProject = () => {
    const made = puzzleFromTemplate(sunkenVault(), BUILT_IN_TEMPLATES.find((t) => t.id === 'builtin.safe')!);
    const safe = elementsOf(made.project, made.id)[0]!;
    const level = levelsOf(made.project).levels[0]!;
    const placed = placeAsset(made.project, level.id, level.floors[0]!.id, 'logic.interaction', { x: 1, y: 1 });
    const project = updateItem(placed.project, placed.ids[0]!, { links: [safe.id] });
    return { project, id: made.id, safe, level, itemId: placed.ids[0]! };
  };

  it('in Play Mode: using the safe brings up its keypad; a wrong code counts (and gives a hint), the right one opens it', () => {
    const { project, id, safe, level, itemId } = safeProject();
    expect(elementIssues(project, id).filter((i) => i.severity === 'error')).toEqual([]);
    // Using it brings up the keypad (before its plain Inspect).
    let s = interactWith(project, startLevelPlay(project, level.id), itemId);
    expect(s.screen).toMatchObject({ objectId: safe.id, itemId });
    // While it is up, the level waits; leaving it does nothing.
    expect(answerScreen(project, s, 'leave').screen).toBeUndefined();
    s = answerScreen(project, s, 'wrong');
    expect([s.world.screenFails?.[safe.id], s.screen?.objectId]).toEqual([1, safe.id]);
    expect(s.log.some((l) => l.text === 'Hint (The Safe code): The painting hangs a little crooked.' || /crooked/.test(l.text))).toBe(true);
    s = answerScreen(project, s, 'right');
    expect([s.screen, s.world.objects[safe.id], s.message?.text]).toEqual([undefined, 'Open', 'A heavy click. The door gives.']);
  });

  it('in the play-through: an object used without its screen does what else it can', () => {
    const { project, safe } = safeProject();
    const w = settleWorld(project, startWorld(project)).world;
    const used = useStoryObject(project, w, safe.id);
    expect([used.verb, used.world.objects[safe.id]]).toEqual(['Inspect', 'Locked']);
  });
});
