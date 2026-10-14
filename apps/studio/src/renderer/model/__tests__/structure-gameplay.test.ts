import { describe, expect, it } from 'vitest';
import { createCharacter } from '../character/profile';
import { addLevel, levelsOf, placeAsset, setParam, updateItem } from '../level/level';
import { placeInRoom } from '../level/place-in-room';
import { interactWith, isOpen, leaveLevel, offerFor, startLevelPlay, tick, type LevelPlayState } from '../level/play';
import { createStructure, floorCodes, structureGraph, updateStructure } from '../level/structure';
import { levelIssues } from '../level/validate';
import { walkStructure } from '../level/walkthrough';
import { createProject, makeObject } from '../project';
import type { Project } from '../types';

const NOW = '2026-10-14T00:00:00.000Z';

const put = (p: Project, levelId: string, floorId: string, asset: string, x: number, y: number, name?: string) => {
  const made = placeAsset(p, levelId, floorId, asset, { x, y }, { name });
  return { p: made.project, id: made.ids[0]! };
};

const withItem = (p: Project, name: string) => {
  const o = makeObject('inventory', name, NOW);
  return { p: { ...p, objects: { ...p.objects, [o.id]: o } }, id: o.id };
};

/**
 * A one-floor tomb: the Entrance Hall (with the way in), the Burial Chamber
 * east of it through the Inner door, and the Treasury north of it through the
 * Vault door. A Bronze Key and a Crowbar exist in the catalog.
 */
const tomb = () => {
  const made = addLevel(createProject('Test'), 'Valley');
  const set = levelsOf(made.project);
  const s = createStructure(made.project, { parentId: made.id, floorId: set.levels[0]!.floors[0]!.id, at: { x: 0, y: 0 }, type: 'custom', name: 'Tomb', w: 40, d: 30, above: 1, below: 0, floorHeight: 3, roof: false });
  const id = s.id;
  const level = levelsOf(s.project).levels.find((l) => l.id === id)!;
  const g = level.floors.find((f) => floorCodes(level).get(f.id) === 'G')!.id;
  let p = s.project;
  let r = put(p, id, g, 'space.room', -11, 0, 'Entrance Hall');
  p = r.p;
  const hall = r.id;
  r = put(p, id, g, 'space.room', -3, 0, 'Burial Chamber');
  p = r.p;
  const chamber = r.id;
  r = put(p, id, g, 'space.room', -11, 6, 'Treasury');
  p = r.p;
  const treasury = r.id;
  r = put(p, id, g, 'arch.door', -15, 0, 'Front door');
  p = r.p;
  const front = r.id;
  r = put(p, id, g, 'arch.door', -7, 1, 'Inner door');
  p = r.p;
  const inner = r.id;
  r = put(p, id, g, 'arch.door', -11, 3, 'Vault door');
  p = r.p;
  const vault = r.id;
  let k = withItem(p, 'Bronze Key');
  p = k.p;
  const key = k.id;
  k = withItem(p, 'Crowbar');
  p = k.p;
  const crowbar = k.id;
  return { p, id, g, hall, chamber, treasury, front, inner, vault, key, crowbar };
};

const pickup = (p: Project, t: ReturnType<typeof tomb>, room: { x: number; y: number }, gives: string, name: string) => {
  const r = put(p, t.id, t.g, 'play.pickup', room.x, room.y, name);
  return { p: setParam(r.p, r.id, 'item', gives), id: r.id };
};

const lock = (p: Project, door: string, key?: string) => {
  let q = setParam(p, door, 'locked', true);
  if (key) q = setParam(q, door, 'keyItem', key);
  return q;
};

const at = (x: number, y: number) => ({ x, y, z: 0 });

describe('door rules in Play Mode (structure spec §7)', () => {
  it('a locked door needs its key; a breakable one gives way, to bare hands or to what breaks it', () => {
    const t = tomb();
    let p = lock(t.p, t.inner, t.key);
    let s = startLevelPlay(p, t.id);
    const door = () => levelsOf(p).items.find((i) => i.id === t.inner)!;
    expect(offerFor(p, s, door())!.blocked).toBe('Locked. Needs Bronze Key.');
    // Breakable with a crowbar: still shut without one, and it says what would do.
    p = setParam(setParam(p, t.inner, 'destructible', true), t.inner, 'breakWith', t.crowbar);
    s = startLevelPlay(p, t.id);
    expect(offerFor(p, s, door())!.blocked).toBe('Locked. Needs Bronze Key, or Crowbar to break it.');
    s = { ...s, world: { ...s.world, items: { [t.crowbar]: 1 } } };
    expect(offerFor(p, s, door())!.verb).toBe('Break');
    s = interactWith(p, s, t.inner);
    expect(s.broken?.[t.inner]).toBe(true);
    expect(isOpen(p, s, door())).toBe(true);
    // Broken is open for good: nothing to close.
    expect(offerFor(p, s, door())).toBeNull();
  });

  it('a one-way door opens only from its side', () => {
    const t = tomb();
    const p = setParam(t.p, t.inner, 'oneWay', 'inside its room');
    const door = levelsOf(p).items.find((i) => i.id === t.inner)!;
    const host = door.host!.id;
    const inside = host === t.hall ? at(-11, 0) : at(-3, 0);
    const outside = host === t.hall ? at(-3, 0) : at(-11, 0);
    const s = startLevelPlay(p, t.id);
    expect(offerFor(p, s, door, undefined, outside)!.blocked).toBe('It won’t open from this side.');
    expect(offerFor(p, s, door, undefined, inside)!.verb).toBe('Open');
    expect(isOpen(p, interactWith(p, s, t.inner, undefined, inside), door)).toBe(true);
  });

  it('a timed door shuts again, but not on the player in the doorway', () => {
    const t = tomb();
    const p = setParam(setParam(t.p, t.inner, 'openFor', 3), t.inner, 'autoOpen', false);
    const door = levelsOf(p).items.find((i) => i.id === t.inner)!;
    let s: LevelPlayState = interactWith(p, startLevelPlay(p, t.id), t.inner);
    expect(isOpen(p, s, door)).toBe(true);
    expect(s.closesAt?.[t.inner]).toBe(3);
    // Standing in it: it waits.
    s = tick(p, s, 4, at(-7, 1));
    expect(isOpen(p, s, door)).toBe(true);
    // Walked away: it shuts.
    s = tick(p, s, 0.1, at(-12, -1));
    expect(isOpen(p, s, door)).toBe(false);
    expect(s.log.some((l) => l.text === 'Inner door shuts again')).toBe(true);
  });

  it('a secret door is the wall until searched, and doesn’t open as the player walks up', () => {
    const t = tomb();
    const p = setParam(t.p, t.vault, 'secret', true);
    const door = levelsOf(p).items.find((i) => i.id === t.vault)!;
    let s = startLevelPlay(p, t.id);
    expect(offerFor(p, s, door)).toMatchObject({ verb: 'Search', label: 'the wall' });
    s = tick(p, s, 0.1, at(-11, 2.8));
    expect(isOpen(p, s, door)).toBe(false);
    s = interactWith(p, s, t.vault);
    expect(s.found?.[t.vault]).toBe(true);
    expect(s.message?.text).toBe('A hidden door: Vault door.');
    expect(offerFor(p, s, door)!.verb).toBe('Open');
  });
});

describe('the structure graph with door rules', () => {
  it('draws a one-way door from the side it opens from, and walks it that way only', () => {
    const t = tomb();
    const p = setParam(t.p, t.inner, 'oneWay', 'outside its room');
    const door = levelsOf(p).items.find((i) => i.id === t.inner)!;
    const host = door.host!.id;
    const other = host === t.hall ? t.chamber : t.hall;
    const graph = structureGraph(levelsOf(p), t.id);
    expect(graph.edges.find((e) => e.via === t.inner)).toMatchObject({ from: other, to: host, oneWay: true });
  });
});

describe('solvability (structure spec §11, §15)', () => {
  it('walks through: takes the key, unlocks its door, reaches what is behind it', () => {
    const t = tomb();
    let p = lock(t.p, t.inner, t.key);
    p = pickup(p, t, { x: -12, y: -1 }, t.key, 'Key on the altar').p;
    const w = walkStructure(p, t.id);
    expect(w.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(w.steps.map((s) => s.text)).toEqual([
      'Come in from outside.',
      'Reach Entrance Hall.',
      'Reach Treasury.',
      'Take Bronze Key (Key on the altar) in Entrance Hall.',
      'Unlock Inner door with Bronze Key.',
      'Reach Burial Chamber.',
    ]);
    expect(w.reached).toContain(t.chamber);
  });

  it('finds a key behind the door it opens, and a key that isn’t in the structure', () => {
    const t = tomb();
    let p = lock(t.p, t.inner, t.key);
    p = pickup(p, t, { x: -3, y: -1 }, t.key, 'Key in the coffin').p;
    let w = walkStructure(p, t.id);
    expect(w.issues.find((i) => i.id === t.inner)).toMatchObject({ severity: 'error', message: 'Bronze Key is behind Inner door, the door it opens: the player can never get it.' });
    // It also shows in preflight.
    expect(levelIssues(p).some((i) => i.levelId === t.id && i.message.startsWith('Bronze Key is behind Inner door'))).toBe(true);
    w = walkStructure(lock(t.p, t.inner, t.key), t.id);
    expect(w.issues.find((i) => i.id === t.inner)!.message).toBe('Inner door needs Bronze Key, which isn’t anywhere in Tomb: the player has to bring it in.');
  });

  it('finds locked doors waiting on each other', () => {
    const t = tomb();
    let p = lock(lock(t.p, t.inner, t.key), t.vault, t.crowbar);
    // The key to the Inner door is in the Treasury; the Treasury's crowbar is in the Burial Chamber.
    p = pickup(p, t, { x: -12, y: 6 }, t.key, 'Key').p;
    p = pickup(p, t, { x: -3, y: -1 }, t.crowbar, 'Crowbar').p;
    const w = walkStructure(p, t.id);
    const cycle = w.issues.find((i) => i.message.startsWith('Locked doors wait on each other'))!;
    expect(cycle.severity).toBe('error');
    expect(cycle.message).toContain('Inner door needs Bronze Key, behind Vault door');
    expect(cycle.message).toContain('Vault door needs Crowbar, behind Inner door');
  });

  it('warns of a one-way door with no way back and no way out', () => {
    const t = tomb();
    const door = levelsOf(t.p).items.find((i) => i.id === t.inner)!;
    const into = door.host!.id === t.chamber ? 'outside its room' : 'inside its room';
    const p = setParam(t.p, t.inner, 'oneWay', into);
    const w = walkStructure(p, t.id);
    expect(w.issues.find((i) => i.id === t.inner)!.message).toBe('Through Inner door (one way) there’s no way back and no way out: the player is stuck in Burial Chamber.');
    // A portal out of the chamber is a way out.
    const portal = put(p, t.id, t.g, 'nav.portal', -3, 1, 'Exit');
    const ok = walkStructure(setParam(portal.p, portal.id, 'to', 'Valley'), t.id);
    expect(ok.issues.some((i) => i.id === t.inner)).toBe(false);
  });

  it('reports transitions that lead nowhere, objectives out of reach, and pickups and triggers that do nothing', () => {
    const t = tomb();
    let p = lock(t.p, t.vault);
    let r = put(p, t.id, t.g, 'nav.portal', -12, -1, 'Way down');
    p = r.p;
    const portal = r.id;
    r = put(p, t.id, t.g, 'logic.trigger', -10, -1, 'Trap');
    p = r.p;
    const trigger = r.id;
    r = put(p, t.id, t.g, 'play.pickup', -13, 1, 'Sack');
    p = r.p;
    const sack = r.id;
    p = updateStructure(p, t.id, { objectives: [{ id: 'o1', text: 'Find the treasure', at: t.treasury }] });
    const w = walkStructure(p, t.id);
    const of = (id: string) => w.issues.find((i) => i.id === id);
    expect(of(portal)).toMatchObject({ severity: 'error', message: 'Way down leads nowhere: set where it Leads to.' });
    expect(of(trigger)!.message).toBe('Trap does nothing: give it rules.');
    expect(of(sack)!.message).toBe('Sack gives nothing: set what it Gives.');
    expect(of(t.vault)!.message).toBe('Vault door is locked and nothing opens it: set what it Needs, or make it breakable.');
    expect(of(t.treasury)).toMatchObject({ severity: 'error', message: 'Objective “Find the treasure” can’t be reached: Treasury is shut off.' });
  });
});

describe('the structure as a scene (structure spec §10)', () => {
  it('does its objectives in order, completes, and changes the story outside', () => {
    const t = tomb();
    const flag = makeObject('state', 'Tomb robbed', NOW, { states: ['no', 'yes'], initial: 'no' });
    let p: Project = { ...t.p, objects: { ...t.p.objects, [flag.id]: flag } };
    p = updateStructure(p, t.id, {
      objectives: [
        { id: 'o1', text: 'Reach the burial chamber', at: t.chamber },
        { id: 'o2', text: 'Look in the treasury', at: t.treasury, optional: true },
      ],
      onComplete: [{ kind: 'setFlag', ref: flag.id, value: 'yes' }],
    });
    let s = startLevelPlay(p, t.id);
    expect(s.objective).toBe('Reach the burial chamber');
    s = tick(p, s, 0.1, at(-11, 0));
    expect(s.structure!.complete).toBe(false);
    s = tick(p, s, 0.1, at(-3, 0));
    expect(s.structure).toMatchObject({ objectives: { o1: true }, complete: true });
    expect(s.objective).toBe('Look in the treasury');
    expect(s.world.flags[flag.id]).toBe('yes');
    expect(s.log.some((l) => l.text === 'Tomb is complete')).toBe(true);
  });

  it('remembers doors and pickups between visits, or resets them, as its rules say', () => {
    const t = tomb();
    let p = setParam(t.p, t.inner, 'autoOpen', false);
    const coin = pickup(p, t, { x: -12, y: -1 }, t.key, 'Coin');
    p = coin.p;
    let s = startLevelPlay(p, t.id);
    s = interactWith(p, s, t.inner);
    s = interactWith(p, s, coin.id);
    const world = leaveLevel(p, s);
    expect(world.places?.[t.id]).toMatchObject({ open: { [t.inner]: true }, gone: { [coin.id]: true }, visits: 1 });
    // Back in: as they were left.
    const door = levelsOf(p).items.find((i) => i.id === t.inner)!;
    let back = startLevelPlay(p, t.id, { world });
    expect(isOpen(p, back, door)).toBe(true);
    expect(back.gone[coin.id]).toBe(true);
    expect(back.log.at(-1)!.text).toBe('Back in Tomb: doors, items, enemies, puzzles as you left them.');
    // Doors reset each visit; items still kept.
    p = updateStructure(p, t.id, { persist: { doors: 'reset', items: 'keep', enemies: 'keep', puzzles: 'keep' } });
    back = startLevelPlay(p, t.id, { world });
    expect(isOpen(p, back, door)).toBe(false);
    expect(back.gone[coin.id]).toBe(true);
  });

  it('resets its own (local) states with its puzzles, and keeps the world’s', () => {
    const t = tomb();
    const local = makeObject('state', 'Lever', NOW, { states: ['up', 'down'], initial: 'up' });
    const world = makeObject('state', 'Alarm', NOW, { states: ['off', 'on'], initial: 'off' });
    let p: Project = { ...t.p, objects: { ...t.p.objects, [local.id]: local, [world.id]: world } };
    p = updateStructure(p, t.id, { localStates: [local.id], persist: { doors: 'keep', items: 'keep', enemies: 'keep', puzzles: 'reset' } });
    const s = startLevelPlay(p, t.id);
    const left = leaveLevel(p, { ...s, world: { ...s.world, flags: { ...s.world.flags, [local.id]: 'down', [world.id]: 'on' } } });
    const back = startLevelPlay(p, t.id, { world: left });
    expect(back.world.flags[local.id]).toBe('up');
    expect(back.world.flags[world.id]).toBe('on');
  });
});

describe('putting things in a room (structure spec §9)', () => {
  it('places a catalog item as a pickup, a new item into the catalog and the room, and a character by their role', () => {
    const t = tomb();
    let done = placeInRoom(t.p, t.chamber, { kind: 'item', ref: t.key }, undefined, NOW)!;
    let set = levelsOf(done.project);
    let placed = set.items.find((i) => i.id === done.id)!;
    expect(placed).toMatchObject({ assetId: 'play.pickup', name: 'Bronze Key', levelId: t.id, floorId: t.g, params: { item: t.key } });
    // A second thing goes beside the first, not on top of it.
    const next = placeInRoom(done.project, t.chamber, { kind: 'newItem', name: 'Canopic Jar' }, undefined, NOW)!;
    expect(next.project.objects[next.objectId]).toMatchObject({ type: 'inventory', name: 'Canopic Jar' });
    const jar = levelsOf(next.project).items.find((i) => i.id === next.id)!;
    expect(jar.params?.item).toBe(next.objectId);
    expect(Math.hypot(jar.x - placed.x, jar.y - placed.y)).toBeGreaterThan(0.5);
    // Characters: an enemy as an Enemy marker.
    const mummy = createCharacter(next.project, { name: 'Mummy', roles: ['enemy'] }, NOW);
    done = placeInRoom(mummy.project, t.chamber, { kind: 'character', ref: mummy.id }, undefined, NOW)!;
    set = levelsOf(done.project);
    placed = set.items.find((i) => i.id === done.id)!;
    expect(placed).toMatchObject({ assetId: 'actor.enemy', name: 'Mummy', params: { character: mummy.id } });
    // The definition stays in the catalog: renaming the placement leaves the character alone.
    const renamed = updateItem(done.project, done.id, { name: 'Mummy (east)' });
    expect(renamed.objects[mummy.id]!.name).toBe('Mummy');
  });
});
