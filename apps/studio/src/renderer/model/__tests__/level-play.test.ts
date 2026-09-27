import { describe, expect, it } from 'vitest';
import { collidersFrom, groundAt, step, type Body } from '../level/controller';
import { meshesFor } from '../level/geometry';
import { addLevel, placeAsset, resizeItem, setParam, updateItem } from '../level/level';
import {
  addNote,
  dismiss,
  interactWith,
  isOpen,
  offerFor,
  present,
  presetFrom,
  savePreset,
  startLevelPlay,
  startPoint,
  tick,
  worldFrom,
  type LevelPlayState,
} from '../level/play';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const sample = () => {
  const project = sunkenVault();
  const set = project.levels!;
  const levelId = set.levels[0]!.id;
  const byName = (name: string) => set.items.find((i) => i.name === name)!;
  const story = (name: string) => Object.values(project.objects).find((o) => o.name === name)!.id;
  return { project, levelId, byName, story };
};

const at = (x: number, y: number, z = 0) => ({ x, y, z });

describe('Play Mode rules', () => {
  it('starts at the player start with the story’s opening state', () => {
    const { project, levelId } = sample();
    const s = startLevelPlay(project, levelId);
    expect(startPoint(project, levelId)).toMatchObject({ x: -1, y: 3.5 });
    expect(s.world.items).toEqual({});
    expect(s.log[0]!.text).toContain('Sunken Vault starts');
  });

  it('keeps the bronze door locked without the key, and takes the key to open it', () => {
    const { project, levelId, byName, story } = sample();
    let s = startLevelPlay(project, levelId);
    const door = byName('Bronze Door');
    expect(offerFor(project, s, door)!.blocked).toBe('Locked. Needs Vault Key.');
    s = interactWith(project, s, door.id);
    expect(isOpen(project, s, door)).toBe(false);
    expect(s.message!.text).toContain('Needs Vault Key');

    // Pick the key up: it goes into the story's inventory, once.
    const key = byName('Vault Key');
    s = interactWith(project, s, key.id);
    expect(s.world.items[story('Vault Key')]).toBe(1);
    expect(present(project, s, key)).toBe(false);
    expect(s.log.some((l) => l.text.includes('Takes Vault Key'))).toBe(false);

    s = interactWith(project, s, door.id);
    expect(isOpen(project, s, door)).toBe(true);
    expect(s.log.map((l) => l.text)).toEqual(expect.arrayContaining(['Bronze Door unlocks with Vault Key', 'Bronze Door opens']));
  });

  it('pulls the lever through its rule, which drains the seam and solves the door puzzle', () => {
    const { project, levelId, byName, story } = sample();
    let s = startLevelPlay(project, levelId);
    const water = byName('Flooded seam');
    expect(present(project, s, water)).toBe(true);
    s = interactWith(project, s, byName('Rusted Lever').id);
    expect(s.world.objects[story('Rusted Lever')]).toBe('up');
    // The story's own trigger and puzzle settle after the change.
    const puzzle = Object.values(project.objects).find((o) => o.type === 'puzzle')!.id;
    expect(s.world.solved[puzzle]).toBe(true);
    expect(present(project, s, water)).toBe(false);
    // The bronze door is present only while the puzzle is unsolved.
    expect(present(project, s, byName('Bronze Door'))).toBe(false);
  });

  it('plays the cinematic on the way into the chamber, once, and waits while it plays', () => {
    const { project, levelId, byName } = sample();
    let s = startLevelPlay(project, levelId);
    const trigger = byName('Door in the dark trigger');
    s = tick(project, s, 0.1, at(10, -13.2));
    expect(s.inside).toContain(trigger.id);
    expect(s.cinematic?.name).toBe('Door in the dark');
    expect(s.log.some((l) => l.kind === 'action' && l.text === 'Plays Door in the dark')).toBe(true);
    const frozen = tick(project, s, 0.5, at(0, 0));
    expect(frozen.inside).toEqual(s.inside);
    s = dismiss(s);
    s = tick(project, s, 0.1, at(0, 0));
    s = tick(project, s, 0.1, at(10, -13.2));
    expect(s.cinematic).toBeUndefined();
  });

  it('hurts the player in a hazard until they die', () => {
    let p: Project = addLevel(createProject('Test'), 'Pit').project;
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const pit = placeAsset(p, levelId, floorId, 'logic.damage', { x: 0, y: 0 });
    p = setParam(pit.project, pit.ids[0]!, 'damage', 50);
    let s: LevelPlayState = startLevelPlay(p, levelId);
    s = tick(p, s, 1, at(0, 0));
    expect(s.health).toBe(50);
    s = tick(p, s, 1.2, at(0, 0));
    expect(s.over?.text).toMatch(/didn’t make it/);
  });

  it('runs a trigger’s rules on enter: conditions checked, the story changed, an item enabled', () => {
    let p: Project = sunkenVault();
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const flag = Object.values(p.objects).find((o) => o.type === 'state')!.id;
    const crate = placeAsset(p, levelId, floorId, 'prop.crate', { x: -4, y: 0 });
    p = crate.project;
    p = updateItem(p, crate.ids[0]!, { activeWhen: { match: 'all', items: [{ kind: 'flag', ref: flag, op: 'is', value: 'yes' }] } });
    const t = placeAsset(p, levelId, floorId, 'logic.trigger', { x: 4, y: 0 });
    p = updateItem(t.project, t.ids[0]!, { rules: [{ id: 'r1', on: 'enter', effects: [{ kind: 'setFlag', ref: flag, value: 'yes' }], actions: [{ kind: 'objective', target: crate.ids[0]! }] }] });
    let s = startLevelPlay(p, levelId);
    const item = p.levels!.items.find((i) => i.id === crate.ids[0])!;
    expect(present(p, s, item)).toBe(false);
    s = tick(p, s, 0.1, at(4, 0));
    expect(s.world.flags[flag]).toBe('yes');
    expect(present(p, s, item)).toBe(true);
    expect(s.objective).toBe('Crate');
  });

  it('starts from a preset, and records notes against items', () => {
    const { project, levelId, byName, story } = sample();
    const played = interactWith(project, startLevelPlay(project, levelId), byName('Vault Key').id);
    const preset = presetFrom(played.world, 'Has the key');
    const p = savePreset(project, preset);
    expect(p.levels!.presets).toHaveLength(1);
    expect(worldFrom(p, preset).items[story('Vault Key')]).toBe(1);
    const noted = addNote(p, { levelId, itemId: byName('Bronze Door').id, text: 'Too dark to find', x: 10, y: -19 });
    expect(levelIssues(noted.project).map((i) => i.message)).toContain('Play note on Bronze Door: Too dark to find');
  });
});

describe('the character controller', () => {
  const idle = { forward: 0, strafe: 0, jump: false, run: false };
  const body = (x: number, y: number, z = 0): Body => ({ x, y, z, vz: 0, yaw: 0, pitch: 0, grounded: true });

  it('stands on a floor, walks, and stops at a wall', () => {
    const { project, levelId } = sample();
    const colliders = collidersFrom(meshesFor(project.levels!, levelId));
    // In the silt camp (8 × 6 at 10, −9): walk east into its east wall at x = 14.
    let b = body(12, -9);
    b = { ...b, yaw: Math.PI / 2 };
    for (let i = 0; i < 90; i++) b = step(b, { ...idle, forward: 1 }, 1 / 60, colliders);
    expect(b.x).toBeLessThan(14 - 0.1 - 0.3 + 0.02);
    expect(b.x).toBeGreaterThan(13.4);
    expect(b.z).toBe(0);
    expect(b.grounded).toBe(true);
  });

  it('walks through an open doorway', () => {
    const { project, levelId } = sample();
    const colliders = collidersFrom(meshesFor(project.levels!, levelId));
    // From the camp north through the chamber stair archway (x = 10, y = −12).
    let b = body(10, -10);
    for (let i = 0; i < 90; i++) b = step(b, { ...idle, forward: 1 }, 1 / 60, colliders);
    expect(b.y).toBeLessThan(-13);
  });

  it('jumps and lands, climbs stairs, and falls off an edge', () => {
    let p: Project = addLevel(createProject('Test'), 'Stairs').project;
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const ground = placeAsset(p, levelId, floorId, 'arch.floor', { x: 0, y: 0 });
    p = resizeItem(ground.project, ground.ids[0]!, { w: 20, d: 20, h: 0.2 });
    p = updateItem(p, ground.ids[0]!, { z: -0.2 });
    const stairs = placeAsset(p, levelId, floorId, 'arch.stairs', { x: 0, y: -4 });
    p = stairs.project;
    const colliders = collidersFrom(meshesFor(p.levels!, levelId));
    expect(groundAt(colliders, 5, 5, 0)).toBeCloseTo(0);

    let b = body(5, 5);
    b = step(b, { ...idle, jump: true }, 1 / 60, colliders);
    expect(b.grounded).toBe(false);
    for (let i = 0; i < 120; i++) b = step(b, idle, 1 / 60, colliders);
    expect(b.grounded).toBe(true);
    expect(b.z).toBeCloseTo(0);

    // The flight rises to 3 m going north from y = −2 to y = −6.
    b = body(0, -1);
    for (let i = 0; i < 78; i++) b = step(b, { ...idle, forward: 1 }, 1 / 60, colliders);
    expect(b.y).toBeGreaterThan(-6);
    expect(b.z).toBeGreaterThan(2.5);

    // Off the far edge of the floor: down it goes.
    b = body(9.5, 0);
    b = { ...b, yaw: Math.PI / 2 };
    for (let i = 0; i < 60; i++) b = step(b, { ...idle, forward: 1 }, 1 / 60, colliders);
    expect(b.z).toBeLessThan(-1);
  });
});
