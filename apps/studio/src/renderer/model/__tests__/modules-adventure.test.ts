import { describe, expect, it } from 'vitest';
import { ADVENTURE_SETUP, createAdventureFromSetup, endingsKnown, endingsOf } from '../adventure';
import { captureOn } from '../capture';
import { levelBands } from '../level-lane';
import { missionBoard, missionGaps, setMission } from '../missions';
import { moduleOf, pathOf, storyBased } from '../modules';
import { blankSetup } from '../setup';
import { makeObject } from '../project';
import { addLevel, placeAsset } from '../level/level';
import type { Project } from '../types';
import { advance, startPlay, type Play } from '../play';
import { buildIR } from '../handoff/ir';

const NOW = '2026-10-19T00:00:00.000Z';
const fresh = () => createAdventureFromSetup('The Warden’s Key', { ...blankSetup(), ...ADVENTURE_SETUP, premise: 'A thief, caught and caught again, works out who framed her.' }, NOW);
const add = (p: Project, type: Parameters<typeof makeObject>[0], name: string) => {
  const o = makeObject(type, name, NOW, {});
  return { project: { ...p, objects: { ...p.objects, [o.id]: o } }, id: o.id };
};

describe('adventure story', () => {
  it('starts with its missions, a level each with a card, endings waiting, capture set up and a first power', () => {
    const p = fresh();
    expect(moduleOf(p)).toMatchObject({ id: 'adventure', name: 'Adventure story' });
    expect(storyBased('adventure')).toBe(true);
    expect(levelBands(p).map((b) => b.name)).toEqual(['Level 1', 'Level 2', 'Level 3', 'Level 4']);
    expect(endingsOf(p).length).toBeGreaterThanOrEqual(3);
    expect(captureOn(p)).toBe(true);
    const types = Object.values(p.objects).map((o) => `${o.type}:${o.name}`);
    expect(types).toEqual(expect.arrayContaining(['skill:First power', 'inventory:Keys', 'inventory:Quest items', 'state:Health', 'state:Times captured', 'scene:Holding cell', 'object:Evidence locker']));
    // Health and powers are their own kinds, not inventory.
    expect(types).not.toContain('inventory:Powers');
    expect(types).not.toContain('inventory:Health');
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ setup: true, story: false, levels: false, characters: false, systems: true, first: false, paths: false, every: false, refine: false, handoff: false });
  });

  it('knows every ending once each has what earns it', () => {
    let p = fresh();
    expect(endingsKnown(p)).toBe(false);
    const [a, b] = endingsOf(p);
    const pp = Object.values(p.objects).find((o) => o.type === 'plotPoint')!;
    const caught = Object.values(p.objects).find((o) => o.name === 'Times captured')!;
    p = {
      ...p,
      connections: [
        ...p.connections,
        { id: 'c1', kind: 'branch', sourceId: pp.id, targetId: a!.id, conditions: { match: 'all', items: [{ kind: 'number', ref: caught.id, op: 'atLeast', value: 2 }] } },
        { id: 'c2', kind: 'branch', sourceId: pp.id, targetId: b!.id },
      ],
    };
    // A third ending still has no way in.
    expect(endingsKnown(p)).toBe(endingsOf(p).length === 2);
    p = { ...p, objects: Object.fromEntries(Object.entries(p.objects).filter(([id, o]) => o.type !== 'end' || id === a!.id || id === b!.id)) };
    expect(endingsKnown(p)).toBe(true);
  });

  it('a mission card says what the level still needs, and is done when it is built', () => {
    let p = fresh();
    const level1 = levelBands(p)[0]!;
    expect(missionGaps(p, level1)).toEqual(['mission', 'puzzle', 'clue', 'gains', 'capture', 'map']);
    const quest = add(p, 'quest', 'Steal the ledger');
    const puzzle = add(quest.project, 'puzzle', 'The warden’s safe');
    const fence = add(puzzle.project, 'character', 'Old Fence');
    p = setMission(fence.project, level1.id, { questId: quest.id, puzzleId: puzzle.id, clueFromId: fence.id, clue: 'The safe opens on the warden’s birthday.', gains: [Object.values(fence.project.objects).find((o) => o.name === 'First power')!.id], capture: 'The night guard on the stairs' });
    expect(missionGaps(p, levelBands(p)[0]!)).toEqual(['map']);
    expect(missionBoard(p)[0]!.warnings).toEqual(['Nothing completes “Steal the ledger” yet: give it a rule that completes it, or a Complete quest effect in the level. Until then the player can never leave this level.']);
    const map = levelBands(p)[0]!.mapId!;
    const floor = p.levels!.levels.find((l) => l.id === map)!.floors[0]!.id;
    p = placeAsset(p, map, floor, 'space.room', { x: 0, y: 0 }).project;
    expect(missionGaps(p, levelBands(p)[0]!)).toEqual([]);
    expect(Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done])).first).toBe(true);
    // Cleared slots go away.
    p = setMission(p, level1.id, { clue: '' });
    expect(levelBands(p)[0]!.mission!.clue).toBeUndefined();
    expect(missionGaps(p, levelBands(p)[0]!)).toEqual(['clue']);
  });

  it('a story game is still a story game', () => {
    expect(storyBased('story')).toBe(true);
    expect(storyBased('platformer')).toBe(false);
    // A map that isn't a level of the Level lane has no card.
    const p = addLevel({ ...fresh(), lanes: fresh().lanes.map((l) => (l.kind === 'level' ? { ...l, levels: [] } : l)) }, 'Loose map').project;
    expect(missionBoard(p)).toEqual([]);
  });
});

describe('missions hold the hero in their level', () => {
  const held = () => {
    const p0 = fresh();
    const quest = add(p0, 'quest', 'Steal the ledger');
    const p = setMission(quest.project, levelBands(quest.project)[0]!.id, { questId: quest.id });
    return { p, quest: quest.id };
  };
  /** Play on, continuing, until the story needs a choice or ends, or this many steps. */
  const playOn = (p: Project, play: Play, steps = 40) => {
    for (let i = 0; i < steps && play.cursor.at === 'wait'; i++) play = advance(p, play);
    return play;
  };

  it('in the play-through, the hero is held in the level until the mission is done', () => {
    const { p, quest } = held();
    const level2 = levelBands(p)[1]!;
    // Level 1 has nothing in it yet that gets the mission done: the hero is sent back, and stuck.
    const play = playOn(p, startPlay(p));
    expect(play.log.some((e) => e.kind === 'action' && e.text === 'Mission not done: Steal the ledger')).toBe(true);
    expect(play.log.some((e) => e.kind === 'level' && e.id === level2.id)).toBe(false);
    expect(play.cursor).toMatchObject({ at: 'end', outcome: 'deadEnd', text: 'Stuck in Level 1: nothing on the way gets “Steal the ledger” done, and the mission holds the player there.' });
    // A mission that gets done on the way opens the next level.
    const health = Object.values(p.objects).find((o) => o.name === 'Health')!.id;
    const doable = { ...p, objects: { ...p.objects, [quest]: { ...p.objects[quest]!, data: { rule: { match: 'all', items: [{ kind: 'number', ref: health, op: 'atLeast', value: 1 }] } } } } } as Project;
    const done = playOn(doable, startPlay(doable));
    expect(done.log.some((e) => e.kind === 'action' && e.text.startsWith('Mission not done'))).toBe(false);
    expect(done.log.some((e) => e.kind === 'level' && e.id === level2.id)).toBe(true);
    // A card marked open lets the hero go on without it.
    const open = setMission(p, levelBands(p)[0]!.id, { open: true });
    const free = playOn(open, startPlay(open));
    expect(free.log.some((e) => e.kind === 'action' && e.text.startsWith('Mission not done'))).toBe(false);
    expect(free.log.some((e) => e.kind === 'level' && e.id === level2.id)).toBe(true);
  });

  it('in the engines, the route into the next level waits on the quest, and a route back to the start is taken until it is done', () => {
    const { p } = held();
    const ir = buildIR(p);
    const band = levelBands(p)[0]!;
    const start = ir.graph.find((n) => n.name === p.objects[band.startRef]!.name)!.key;
    const leaving = ir.graph.filter((n) => n.routes.some((r) => r.label === 'Mission not done'));
    expect(leaving.length).toBeGreaterThanOrEqual(1);
    for (const n of leaving) {
      const back = n.routes.find((r) => r.label === 'Mission not done')!;
      expect(back).toMatchObject({ to: start, when: { match: 'all', items: [{ kind: 'quest', ref: 'steal_the_ledger', op: 'notDone' }] } });
    }
  });
});
