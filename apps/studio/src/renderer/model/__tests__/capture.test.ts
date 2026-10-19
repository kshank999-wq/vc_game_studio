import { describe, expect, it } from 'vitest';
import { addEscapePuzzle, captureIssues, captureOn, describeCapture, escapePuzzleOf, LOCKER_VERB, relockedBy, setCapture, setUpCapture, takenFrom } from '../capture';
import { choose, endFreePlay, interact, playToDecision, promptOf, settleWorld, startPlay, type Play } from '../play';
import { sunkenVault } from '../sample';
import { setData } from '../details';
import type { Project } from '../types';
import { addLevel, levelsOf, linkItem, placeAsset } from '../level/level';
import { interactWith, offerFor, startLevelPlay, tick } from '../level/play';
import { holdingSpot, holdingSpots } from '../level/holding';
import { buildIR } from '../handoff/ir';
import { captureWorld } from '../capture';
import { unlinkItem, updateItem } from '../level/level';
import { createProject, makeObject } from '../project';

const named = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;

/** The sample, with capture set up and the eels capturing the player who loses to them. */
const captured = (): Project => {
  let p = setUpCapture(sunkenVault());
  p = setData(p, named(p, 'Eel swarm'), { onLose: 'Captured' });
  return p;
};

/** Play from The Key, carrying the knife, to the eels. */
const toEels = (p: Project): Play => {
  let play = startPlay(p, named(p, 'The Key'));
  play = { ...play, world: { ...play.world, items: { ...play.world.items, [named(p, 'Diving Knife')]: 1 } } };
  play = playToDecision(p, play);
  expect(promptOf(p, play)).toMatchObject({ kind: 'choice', symbol: 'encounter' });
  return play;
};

describe('capture', () => {
  it('sets itself up with a cell off the spine, a locker, a count and health', () => {
    const p = setUpCapture(sunkenVault());
    expect(captureOn(p)).toBe(true);
    const r = p.capture!;
    expect(p.objects[r.cellId!]).toMatchObject({ type: 'scene', name: 'Holding cell' });
    expect(p.placements[r.cellId!]!.laneId).toBeNull();
    expect(p.objects[r.lockerId!]).toMatchObject({ type: 'object', name: 'Evidence locker' });
    expect(p.objects[r.countId!]).toMatchObject({ type: 'state', name: 'Times captured', data: { varType: 'number' } });
    expect(p.objects[r.healthId!]).toMatchObject({ name: 'Health', data: { varType: 'number', initialValue: 100 } });
    expect(captureIssues(p)).toEqual([]);
    expect(describeCapture(p)).toContain('taken to Holding cell');
    // Again: nothing doubled.
    expect(Object.keys(setUpCapture(p).objects)).toHaveLength(Object.keys(p.objects).length);
  });

  it('takes everything but what is kept, or only what is listed', () => {
    const items = { knife: 1, key: 1, flare: 3, gone: 0 };
    expect(takenFrom({ take: 'all', keep: ['key'] }, items)).toEqual({ taken: { knife: 1, flare: 3 }, left: { key: 1 } });
    expect(takenFrom({ take: 'listed', items: ['flare'] }, items)).toEqual({ taken: { flare: 3 }, left: { knife: 1, key: 1 } });
    expect(takenFrom({ take: 'none' }, items).taken).toEqual({});
  });

  it('a lost fight takes the player to the cell, takes their things, and they escape back to where they were', () => {
    const p = captured();
    const r = p.capture!;
    const knife = named(p, 'Diving Knife');
    let play = choose(p, toEels(p), 1);
    expect(play.log.some((e) => e.kind === 'captured' && e.text === 'Captured: taken to Holding cell')).toBe(true);
    expect(play.world.flags[r.countId!]).toBe('1');
    expect(play.world.flags[r.healthId!]).toBe('50');
    expect(play.world.items[knife]).toBeUndefined();
    expect(play.world.taken).toEqual({ [knife]: 1 });
    // In the cell: its free play, with the locker offering the knife back.
    const prompt = promptOf(p, play);
    expect(prompt).toMatchObject({ kind: 'freePlay', title: 'Find a way out' });
    const locker = prompt.kind === 'freePlay' ? prompt.objects.find((o) => o.id === r.lockerId) : undefined;
    expect(locker?.verbs.map((v) => v.verb)).toEqual([LOCKER_VERB.verb]);
    play = interact(p, play, r.lockerId!, LOCKER_VERB.id);
    expect(play.world.items[knife]).toBe(1);
    expect(play.world.taken).toBeUndefined();
    // Out: back in The Key, past the fight: the key in the silt.
    play = playToDecision(p, endFreePlay(p, play));
    expect(play.log.some((e) => e.kind === 'captured' && e.text === 'Escaped Holding cell')).toBe(true);
    expect(play.world.held).toBeUndefined();
    expect(play.log.some((e) => e.kind === 'action' && e.text === 'Find the key in the silt')).toBe(true);
    expect(play.world.items[named(p, 'Vault Key')]).toBe(1);
  });

  it('the cell has an escape puzzle: pull the brick, take the nail, pick the lock, open the door, and the way out ends', () => {
    const p = captured();
    const puzzle = escapePuzzleOf(p)!;
    expect(puzzle.name).toBe('Escape the cell');
    let play = choose(p, toEels(p), 1);
    const prompt = promptOf(p, play);
    expect(prompt).toMatchObject({ kind: 'freePlay', title: 'Find a way out', endsByRule: true });
    const objects = prompt.kind === 'freePlay' ? prompt.objects : [];
    expect(objects.map((o) => o.name)).toEqual(expect.arrayContaining(['Cell door', 'Loose brick', 'Scratches on the wall']));
    const verb = (name: string, v: string) => {
      const o = objects.find((x) => x.name === name)!;
      return [o.id, o.verbs.find((x) => x.verb === v)!.id] as const;
    };
    const door = objects.find((o) => o.name === 'Cell door')!;
    // Without the nail the lock won't give.
    expect(door.verbs.find((v) => v.verb === 'Pick the lock')).toMatchObject({ available: false });
    play = interact(p, play, ...verb('Scratches on the wall', 'Read'));
    play = interact(p, play, ...verb('Loose brick', 'Pull out'));
    expect(play.world.items[named(p, 'Bent nail')]).toBe(1);
    play = interact(p, play, ...verb('Cell door', 'Pick the lock'));
    expect(play.cursor.at).toBe('freePlay');
    play = interact(p, play, ...verb('Cell door', 'Open'));
    expect(play.world.solved[puzzle.id]).toBe(true);
    play = playToDecision(p, play);
    expect(play.log.some((e) => e.kind === 'captured' && e.text === 'Escaped Holding cell')).toBe(true);
    // Caught again, the cell is locked again: the puzzle unsolved, the door locked, the brick back.
    expect(relockedBy(p)).toEqual(expect.arrayContaining([puzzle.id, door.id]));
    const again = settleWorld(p, captureWorld(p, play.world).world).world;
    expect(again.solved[puzzle.id]).toBeUndefined();
    expect(again.objects[door.id]).toBe('Locked');
    expect(again.objects[named(p, 'Loose brick')]).toBe('In the wall');
    // Added once only; and a project from before gets one with the button.
    expect(addEscapePuzzle(p)).toBe(p);
    expect(buildIR(p).capture!.relock).toEqual(expect.arrayContaining(['escape_the_cell']));
  });

  it('without a locker, things come back on the way out; and the story can go on elsewhere', () => {
    let p = setCapture(captured(), { lockerId: undefined, backTo: named(captured(), 'The Vault Door') });
    p = { ...p, capture: { ...p.capture!, lockerId: undefined } };
    const knife = named(p, 'Diving Knife');
    let play = choose(p, toEels(p), 1);
    expect(play.world.items[knife]).toBeUndefined();
    play = playToDecision(p, endFreePlay(p, play));
    expect(play.world.items[knife]).toBe(1);
    expect(play.log.some((e) => e.kind === 'heading' && e.id === named(p, 'The Vault Door'))).toBe(true);
  });

  it('a loss that runs health out captures, even when the fight would be tried again', () => {
    let p = setUpCapture(sunkenVault());
    const eels = named(p, 'Eel swarm');
    p = setData(p, eels, { loseEffects: [{ kind: 'addNumber', ref: p.capture!.healthId!, amount: -100 }] });
    const play = choose(p, toEels(p), 1);
    expect(play.world.held).toBeDefined();
    expect(play.world.flags[p.capture!.countId!]).toBe('1');
  });

  it('captured once too often, the story ends where the rule says', () => {
    let p = captured();
    const end = Object.values(p.objects).find((o) => o.type === 'end')!;
    p = setCapture(p, { limit: 1, limitId: end.id });
    const play = choose(p, toEels(p), 1);
    expect(promptOf(p, play)).toMatchObject({ kind: 'end', outcome: 'ending' });
    expect(play.world.flags[p.capture!.countId!]).toBe('1');
  });

  it('says what is wrong with the rule', () => {
    const p = setCapture(sunkenVault(), { take: 'listed' });
    expect(captureIssues(p)).toEqual(['Choose the holding cell: the scene the player is taken to.', 'Nothing is listed to take: list the items, or take everything.']);
    expect(captureOn(p)).toBe(false);
  });
});

describe('capture in Play Mode', () => {
  const level = () => {
    let p = setUpCapture(addLevel(createProject('Cells'), 'Keep').project);
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const cell = placeAsset(p, levelId, floorId, 'space.room', { x: 30, y: 30 });
    p = linkItem(cell.project, cell.ids[0]!, p.capture!.cellId!);
    const locker = placeAsset(p, levelId, floorId, 'logic.interaction', { x: 32, y: 30 });
    p = linkItem(locker.project, locker.ids[0]!, p.capture!.lockerId!);
    const knife = makeObject('inventory', 'Knife', '2026-01-01T00:00:00.000Z', {});
    p = { ...p, objects: { ...p.objects, [knife.id]: knife } };
    return { p, levelId, cellId: cell.ids[0]!, lockerItem: locker.ids[0]!, knife: knife.id };
  };

  it('health running out takes the player to the cell, searched; the locker gives it back', () => {
    const { p, levelId, lockerItem, knife } = level();
    let s = startLevelPlay(p, levelId);
    s = { ...s, health: 0, world: { ...s.world, items: { [knife]: 1 } } };
    s = tick(p, s, 0.1, { x: 0, y: 0, z: 0 });
    expect(s.over).toBeUndefined();
    expect(s.placePlayer).toMatchObject({ x: 30, y: 30 });
    expect(s.health).toBe(50);
    expect(s.world.items[knife]).toBeUndefined();
    expect(s.world.flags[p.capture!.countId!]).toBe('1');
    expect(s.log.some((e) => e.text.startsWith('Captured: takes Knife'))).toBe(true);
    const item = levelsOf(p).items.find((i) => i.id === lockerItem)!;
    expect(offerFor(p, s, item)).toMatchObject({ verb: LOCKER_VERB.verb });
    s = interactWith(p, s, lockerItem);
    expect(s.world.items[knife]).toBe(1);
    expect(s.world.taken).toBeUndefined();
  });

  it('captured once too often, the play is over', () => {
    const { p: p0, levelId } = level();
    const end = Object.values(p0.objects).find((o) => o.type === 'end')!;
    const p = setCapture(p0, { limit: 1, limitId: end.id });
    let s = startLevelPlay(p, levelId);
    s = tick(p, { ...s, health: 0 }, 0.1, { x: 0, y: 0, z: 0 });
    expect(s.over?.text).toContain('Captured once too often');
  });

  it('with nothing linked to the cell, each level picks a room: one named like a cell, else the one farthest from the start', () => {
    const { p: linked, levelId, cellId } = level();
    let p = unlinkItem(linked, cellId, linked.capture!.cellId!);
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const start = placeAsset(p, levelId, floorId, 'actor.player', { x: 0, y: 0 });
    const near = placeAsset(start.project, levelId, floorId, 'space.room', { x: 5, y: 5 });
    p = near.project;
    expect(holdingSpot(p, levelId)).toMatchObject({ auto: true, item: { id: cellId } });
    const jail = placeAsset(p, levelId, floorId, 'space.room', { x: 8, y: 0 });
    p = updateItem(jail.project, jail.ids[0]!, { name: 'Old jail' });
    expect(holdingSpot(p, levelId)).toMatchObject({ auto: true, item: { name: 'Old jail' } });
    expect(holdingSpots(p)).toEqual([{ levelId, level: 'Keep', spot: expect.objectContaining({ auto: true }) }]);
    // Play Mode takes the hero there.
    let s = startLevelPlay(p, levelId);
    s = tick(p, { ...s, health: 0 }, 0.1, { x: 0, y: 0, z: 0 });
    expect(s.placePlayer).toMatchObject({ x: 8, y: 0 });
    expect(s.log.some((e) => e.text.includes('Old jail (picked as the holding cell'))).toBe(true);
    // The engines get it as a link to the cell.
    const ir = buildIR(p);
    const cellKey = ir.capture!.cell;
    const items = ir.levels!.flatMap((l) => l.items);
    expect(items.filter((i) => i.links.includes(cellKey)).map((i) => i.name)).toEqual(['Old jail']);
    // A room linked by hand wins, and nothing is picked.
    p = linkItem(p, near.ids[0]!, p.capture!.cellId!);
    expect(holdingSpot(p, levelId)).toMatchObject({ auto: false, item: { id: near.ids[0] } });
    expect(buildIR(p).levels!.flatMap((l) => l.items).filter((i) => i.links.includes(cellKey)).map((i) => i.guid)).toEqual([near.ids[0]]);
  });
});
