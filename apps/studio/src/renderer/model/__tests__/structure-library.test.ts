import { describe, expect, it } from 'vitest';
import { STARTER } from '../level/library';
import { duplicateItems, levelsOf, placeAsset, setParam } from '../level/level';
import { interactWith, isOpen, offerFor, present, startLevelPlay, tick } from '../level/play';
import { withTomb } from '../level/sample-structure';
import { levelIssues } from '../level/validate';
import { walkStructure } from '../level/walkthrough';
import { makeObject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const tomb = () => withTomb(sunkenVault());
const at = (x: number, y: number) => ({ x, y, z: 0 });
const item = (p: Project, id: string) => levelsOf(p).items.find((i) => i.id === id)!;
const put = (p: Project, t: ReturnType<typeof tomb>, asset: string, x: number, y: number, name: string) => {
  const r = placeAsset(p, t.id, t.floorId, asset, { x, y }, { name });
  return { p: r.project, id: r.ids[0]! };
};

describe('the structure library (structure spec §9)', () => {
  it('has a piece for each part the spec lists', () => {
    const names = new Set(STARTER.map((a) => a.name));
    for (const n of ['Courtyard', 'Crawlspace', 'Tunnel', 'Elevator lobby', 'Shaft', 'Archway', 'Hole in the wall', 'Gate / portcullis', 'Column', 'Breakable wall', 'Barricade', 'Rubble', 'Trapdoor', 'Hatch and ladder', 'Rope / climb point', 'Movable block', 'Chest', 'Safe', 'Quest item', 'Trap', 'Lever', 'Switch', 'Mechanism', 'Pressure plate', 'Keypad', 'Clue marker']) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('a lever toggles what it works: the portcullis lifts and drops again', () => {
    const t = tomb();
    const p = t.project;
    let s = startLevelPlay(p, t.id);
    expect(offerFor(p, s, item(p, t.doors.portcullis))!.blocked).toBe('Locked.');
    s = interactWith(p, s, t.parts.lever);
    expect(isOpen(p, s, item(p, t.doors.portcullis))).toBe(true);
    expect(s.log.some((l) => l.text === 'Rusted lever opens Portcullis')).toBe(true);
    s = interactWith(p, s, t.parts.lever);
    expect(isOpen(p, s, item(p, t.doors.portcullis))).toBe(false);
  });

  it('a pressure plate held: open while the player stands on it, shut as they step off', () => {
    const t = tomb();
    const p = setParam(setParam(t.project, t.parts.plate, 'works', t.doors.portcullis), t.parts.plate, 'action', 'while held');
    let s = startLevelPlay(p, t.id);
    s = tick(p, s, 0.1, { ...at(13, -1.5), z: 0 });
    expect(s.inside).toContain(t.parts.plate);
    expect(isOpen(p, s, item(p, t.doors.portcullis))).toBe(true);
    s = tick(p, s, 0.1, { ...at(15, 2.5), z: 0 });
    expect(isOpen(p, s, item(p, t.doors.portcullis))).toBe(false);
  });

  it('something that starts switched off isn’t there until it is switched on', () => {
    const t = tomb();
    const p = t.project;
    let s = startLevelPlay(p, t.id);
    expect(present(p, s, item(p, t.parts.fallingRubble))).toBe(false);
    s = tick(p, s, 0.1, { ...at(13, -1.5), z: 0 });
    expect(present(p, s, item(p, t.parts.fallingRubble))).toBe(true);
  });

  it('a breakable thing breaks for good, and says what it takes when it takes something', () => {
    const t = tomb();
    const pick = makeObject('inventory', 'Pickaxe', '2026-10-14T00:00:00.000Z');
    let p: Project = { ...t.project, objects: { ...t.project.objects, [pick.id]: pick } };
    const wall = put(p, t, 'arch.breakableWall', -9, -2.5, 'Weak wall');
    p = setParam(wall.p, wall.id, 'breakWith', pick.id);
    let s = startLevelPlay(p, t.id);
    expect(offerFor(p, s, item(p, wall.id))).toMatchObject({ verb: 'Break through', blocked: 'Needs Pickaxe to break it.' });
    s = { ...s, world: { ...s.world, items: { [pick.id]: 1 } } };
    s = interactWith(p, s, wall.id);
    expect(present(p, s, item(p, wall.id))).toBe(false);
    expect(s.message?.text).toBe('Weak wall gives way.');
  });

  it('a chest opens once with its key, gives what it holds, and stays; an empty one says so', () => {
    const t = tomb();
    const p = t.project;
    let s = startLevelPlay(p, t.id);
    expect(offerFor(p, s, item(p, t.parts.chest))!.blocked).toBe('Locked. Needs Tomb Key.');
    s = interactWith(p, s, t.keyPickup);
    s = interactWith(p, s, t.parts.chest);
    expect(s.world.items[t.idol]).toBe(1);
    expect(present(p, s, item(p, t.parts.chest))).toBe(true);
    expect(offerFor(p, s, item(p, t.parts.chest))).toBeNull();
    const box = put(p, t, 'play.chest', -9, 7, 'Empty box');
    const s2 = interactWith(box.p, startLevelPlay(box.p, t.id), box.id);
    expect(s2.message?.text).toBe('It’s empty.');
  });

  it('a trap in a cycle hurts only while it fires', () => {
    const t = tomb();
    const p = t.project;
    let s = startLevelPlay(p, t.id);
    // Two seconds in the trap, a quarter at a time: it fires at 0.25, 0.5 and 0.75 s, and again at 2 s (the next cycle).
    for (let i = 0; i < 8; i++) s = tick(p, s, 0.25, { ...at(11, 1.5), z: 0 });
    expect(s.health).toBeCloseTo(100 - 20 * 0.25 * 4, 5);
  });

  it('a copied lever works the copied gate, and a lever whose target is gone is reported', () => {
    const t = tomb();
    const copy = duplicateItems(t.project, [t.parts.lever, t.doors.portcullis], { x: 0, y: 0 });
    const [lever, gate] = copy.ids;
    expect(item(copy.project, lever!).params?.works).toBe(gate);
    const missing = setParam(t.project, t.parts.lever, 'works', 'nothing-here');
    expect(levelIssues(missing).some((i) => i.id === t.parts.lever && i.message === 'Rusted lever works something no longer on this map.')).toBe(true);
  });

  it('the walkthrough opens doors with levers and chests with their keys', () => {
    const t = tomb();
    const steps = walkStructure(t.project, t.id).steps.map((s) => s.text);
    expect(steps).toContain('Open Portcullis with Rusted lever.');
    expect(steps).toContain('Reach Sanctum.');
    expect(steps).toContain('Open Chest with Tomb Key: take Gold Idol in Treasury.');
  });
});
