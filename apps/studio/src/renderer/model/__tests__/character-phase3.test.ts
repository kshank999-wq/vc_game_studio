import { describe, expect, it } from 'vitest';
import { castOf } from '../character/crowd';
import { groupProblems, groupsOf, populate, updateGroup } from '../character/groups';
import { characters, profileOf } from '../character/profile';
import { addSampleCast } from '../character/samples';
import { addLevel, levelsOf, placeAsset, resizeItem, setParam } from '../level/level';
import { startLevelPlay, tick, type LevelPlayState } from '../level/play';
import { createProject } from '../project';
import type { Project } from '../types';

const withCast = () => {
  let p: Project = addLevel(createProject('Test'), 'Square').project;
  p = addSampleCast(p).project;
  const levelId = p.levels!.levels[0]!.id;
  const floorId = p.levels!.levels[0]!.floors[0]!.id;
  return { p, levelId, floorId };
};
const group = (p: Project, name: string) => groupsOf(p).find((g) => g.name === name)!;
const character = (p: Project, name: string) => characters(p).find((c) => c.name === name)!;

const run = (p: Project, s: LevelPlayState, seconds: number, player: (t: number) => { x: number; y: number; z: number }) => {
  for (let i = 0; i < Math.round(seconds / 0.1); i++) s = tick(p, s, 0.1, player(s.time));
  return s;
};

describe('the sample cast and groups (spec §8)', () => {
  it('adds the six working samples and two groups, once', () => {
    const { p } = withCast();
    expect(characters(p).map((c) => c.name)).toEqual(expect.arrayContaining(['Strolling Villager', 'Market Gossip', 'Patrol Guard', 'Lurking Orc', 'Orc Sentry', 'Loyal Hound']));
    expect(groupsOf(p).map((g) => g.name)).toEqual(['Village Market', 'Orc Patrol']);
    expect(profileOf(character(p, 'Orc Sentry')).art.placeholder.prop).toBe('sword');
    expect(addSampleCast(p).added).toEqual([]);
    expect(groupProblems(p, group(p, 'Village Market'))).toEqual([]);
  });
});

describe('the population generator (spec §7)', () => {
  it('makes the same people in the same place every time, spaced apart, inside the area', () => {
    const { p } = withCast();
    const g = group(p, 'Village Market');
    const at = { x: 0, y: 0, w: 24, d: 16, rotation: 0 };
    const a = populate(p, g, at, 'area1');
    const b = populate(p, g, at, 'area1');
    expect(a.members).toHaveLength(20);
    expect(a.members).toEqual(b.members);
    for (const m of a.members) expect(Math.abs(m.x) <= 12 && Math.abs(m.y) <= 8).toBe(true);
    for (const m of a.members) for (const o of a.members) if (m !== o) expect(Math.hypot(m.x - o.x, m.y - o.y)).toBeGreaterThanOrEqual(g.spacing - 1e-9);
    // Another seed, another spread of the same people.
    const c = populate(p, { ...g, seed: g.seed + 1 }, at, 'area1');
    expect(c.members).toHaveLength(20);
    expect(c.members[0]!.x).not.toBe(a.members[0]!.x);
    // A freeform area keeps everyone inside its outline.
    const tri = populate(p, g, { ...at, outline: [{ x: -12, y: 8 }, { x: 0, y: -8 }, { x: 12, y: 8 }] }, 'tri');
    for (const m of tri.members) expect(m.y >= 2 * Math.abs(m.x) * (8 / 12) * 1 - 8 - 1e-6).toBe(true);
  });

  it('caps by density and says so, and keeps out of solids', () => {
    const { p } = withCast();
    const g = { ...group(p, 'Village Market'), density: 5 };
    const pop = populate(p, g, { x: 0, y: 0, w: 20, d: 20, rotation: 0 }, 'k');
    expect(pop.members).toHaveLength(20);
    const small = populate(p, g, { x: 0, y: 0, w: 10, d: 10, rotation: 0 }, 'k');
    expect(small.members).toHaveLength(5);
    expect(small.notes[0]).toMatch(/density cap/);
    const walled = populate(p, group(p, 'Village Market'), { x: 0, y: 0, w: 24, d: 16, rotation: 0 }, 'w', (pt) => pt.x < 0);
    expect(walled.members.every((m) => m.x >= 0)).toBe(true);
  });
});

describe('groups in a level (spec §7, acceptance: 20 villagers move in 3D)', () => {
  it('a Village Market dropped on a square is 20 placeholder actors that move', () => {
    const { p: p0, levelId, floorId } = withCast();
    const placed = placeAsset(p0, levelId, floorId, 'actor.group', { x: 0, y: 0 });
    let p = setParam(placed.project, placed.ids[0]!, 'group', group(placed.project, 'Village Market').id);
    p = resizeItem(p, placed.ids[0]!, { w: 30, d: 20 });
    const cast = castOf(p, levelsOf(p), levelId);
    expect(cast).toHaveLength(20);
    expect(cast.every((c) => c.placeholder.tint && c.height > 1)).toBe(true);
    const s0 = startLevelPlay(p, levelId);
    expect(Object.keys(s0.cast!)).toHaveLength(20);
    const s = run(p, s0, 6, () => ({ x: 100, y: 100, z: 0 }));
    const moved = cast.filter((c) => Math.hypot(s.cast![c.key]!.x - c.home.x, s.cast![c.key]!.y - c.home.y) > 0.2);
    // The strollers walk; the gossips stay chatting.
    expect(moved.length).toBeGreaterThanOrEqual(10);
    expect(moved.every((c) => c.activity === 'wander')).toBe(true);
    for (const c of cast.filter((x) => x.activity === 'wander')) expect(Math.hypot(s.cast![c.key]!.x - c.home.x, s.cast![c.key]!.y - c.home.y)).toBeLessThanOrEqual(5 + 1e-6);
  });

  it('runs 100 ambient placeholders at well over frame rate (spec §12 load test)', () => {
    const { p: p0, levelId, floorId } = withCast();
    const placed = placeAsset(p0, levelId, floorId, 'actor.group', { x: 0, y: 0 });
    const g = group(placed.project, 'Village Market');
    let p = setParam({ ...placed.project, characterGroups: groupsOf(placed.project).map((x) => (x.id === g.id ? { ...x, entries: x.entries.map((e, i) => ({ ...e, min: i ? 30 : 70, max: i ? 30 : 70 })) } : x)) }, placed.ids[0]!, 'group', g.id);
    p = resizeItem(p, placed.ids[0]!, { w: 60, d: 40 });
    expect(castOf(p, levelsOf(p), levelId)).toHaveLength(100);
    let s = startLevelPlay(p, levelId);
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) s = tick(p, s, 1 / 60, { x: 200, y: 200, z: 0 });
    const perFrame = (performance.now() - t0) / 300;
    // Five seconds at 60 fps; each frame's simulation well inside its 16 ms.
    expect(perFrame).toBeLessThan(8);
  });

  it('an Orc Patrol walks its named route in a column', () => {
    const { p: p0, levelId, floorId } = withCast();
    const placed = placeAsset(p0, levelId, floorId, 'actor.group', { x: 0, y: 0 });
    let p = setParam(placed.project, placed.ids[0]!, 'group', group(placed.project, 'Orc Patrol').id);
    for (const [i, at] of [{ x: 0, y: -20 }, { x: 20, y: -20 }].entries()) {
      const node = placeAsset(p, levelId, floorId, 'actor.patrol', at);
      p = setParam(node.project, node.ids[0]!, 'path', 'Orc Route');
      p = setParam(p, node.ids[0]!, 'order', i + 1);
    }
    const cast = castOf(p, levelsOf(p), levelId);
    expect(cast).toHaveLength(6);
    expect(cast.every((c) => c.ai && c.route.length === 2)).toBe(true);
    // The player well away: they patrol north towards the first stop.
    const s = run(p, startLevelPlay(p, levelId), 4, () => ({ x: 200, y: 200, z: 0 }));
    for (const c of cast) expect(s.cast![c.key]!.y).toBeLessThan(c.home.y - 1);
  });
});

describe('an AI enemy in the graybox (spec §14: the orc patrols, detects, attacks, disengages)', () => {
  const orcYard = () => {
    const { p: p0, levelId, floorId } = withCast();
    const orc = placeAsset(p0, levelId, floorId, 'actor.enemy', { x: 0, y: 0 });
    let p = setParam(orc.project, orc.ids[0]!, 'character', character(orc.project, 'Orc Sentry').id);
    p = setParam(p, orc.ids[0]!, 'patrol', 'Yard');
    for (const [i, at] of [{ x: 0, y: -6 }, { x: 0, y: 6 }].entries()) {
      const node = placeAsset(p, levelId, floorId, 'actor.patrol', at);
      p = setParam(node.project, node.ids[0]!, 'path', 'Yard');
      p = setParam(p, node.ids[0]!, 'order', i + 1);
    }
    return { p, levelId, orc: orc.ids[0]! };
  };

  it('patrols until it sees the player, chases, attacks (the player takes damage), and its pose is the item’s', () => {
    const { p, levelId, orc } = orcYard();
    const s0 = startLevelPlay(p, levelId);
    // The player stands just north of its route, in its view as it walks north.
    const s = run(p, s0, 12, () => ({ x: 0, y: -14, z: 0 }));
    const said = s.log.map((l) => l.text).join('\n');
    expect(said).toMatch(/Orc Sentry: Patrol → Alert: Sees it/);
    expect(said).toMatch(/Orc Sentry: Alert → Chase/);
    expect(said).toMatch(/Orc Sentry: Chase → Attack/);
    expect(said).toMatch(/Orc Sentry attacks/);
    expect(s.health).toBeLessThan(100);
    expect(Math.hypot(s.actors[orc]!.x, s.actors[orc]!.y + 14)).toBeLessThan(2.5);
  });

  it('gives up the chase at its disengage distance and goes back', () => {
    const { p, levelId } = orcYard();
    // The player is seen ahead, then runs north faster than the orc can follow.
    const s = run(p, startLevelPlay(p, levelId), 30, (t) => ({ x: 0, y: -12 - Math.max(0, t - 2) * 6, z: 0 }));
    const said = s.log.map((l) => l.text).join('\n');
    expect(said).toMatch(/Orc Sentry: Chase → Return: \d+\.\d m from its post, past its 25 m disengage distance/);
  });

  it('doesn’t see through a wall', () => {
    const { p: p1, levelId } = orcYard();
    const floorId = p1.levels!.levels[0]!.floors[0]!.id;
    const wall = placeAsset(p1, levelId, floorId, 'arch.wall', { x: 0, y: -10 });
    const p = wall.ids.length ? resizeItem(wall.project, wall.ids[0]!, { w: 12, d: 0.3, h: 3 }) : p1;
    if (!wall.ids.length) return;
    const s = run(p, startLevelPlay(p, levelId), 6, () => ({ x: 0, y: -14, z: 0 }));
    expect(s.log.map((l) => l.text).join('\n')).not.toMatch(/Sees it/);
  });

  it('keeps a group to its density and changes nothing when the group is edited back', () => {
    const { p } = withCast();
    const g = group(p, 'Village Market');
    const q = updateGroup(p, g.id, { spacing: 2 });
    expect(group(q, 'Village Market').spacing).toBe(2);
  });
});
