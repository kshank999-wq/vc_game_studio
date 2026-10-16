import { describe, expect, it } from 'vitest';
import { aiStep, defaultAI, startMemory, type AIMemory, type AIWorld } from '../character/ai';
import { findPath, navGraph, nextOnWay, type Way } from '../level/nav';
import { startLevelPlay, tick, waysOf } from '../level/play';
import { levelIssues } from '../level/validate';
import { addLevel, levelsOf, placeAsset, placeAt, resizeItem, setParam } from '../level/level';
import { buildIR } from '../handoff/ir';
import { planHandoff, setTarget } from '../handoff';
import { createProject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const start = () => {
  const made = addLevel(createProject('Yard'), 'Yard');
  return { project: made.project, levelId: made.id, floorId: made.project.levels!.levels[0]!.floors[0]!.id };
};
const place = (p: Project, levelId: string, floorId: string, asset: string, at = { x: 0, y: 0 }) => {
  const r = placeAsset(p, levelId, floorId, asset, at);
  return { project: r.project, id: r.ids[0]! };
};
/** A 16 × 16 m floor at the origin. */
const yard = () => {
  const { project, levelId, floorId } = start();
  const ground = place(project, levelId, floorId, 'arch.floor');
  return { project: resizeItem(ground.project, ground.id, { w: 16, d: 16, h: 0.2 }), levelId, floorId };
};
/** A wall running north–south at x = 0, from y = from to y = to. */
const wall = (p: Project, levelId: string, floorId: string, from: number, to: number) => {
  const w = place(p, levelId, floorId, 'arch.wall', { x: 0, y: (from + to) / 2 });
  return placeAt(resizeItem(w.project, w.id, { w: to - from, d: 0.3, h: 3 }), w.id, { rotation: 90 });
};
const length = (from: { x: number; y: number }, path: { x: number; y: number }[]) =>
  path.reduce((sum, q, i) => sum + Math.hypot(q.x - (i ? path[i - 1]! : from).x, q.y - (i ? path[i - 1]! : from).y), 0);

describe('pathfinding', () => {
  const from = { x: -5, y: 0, z: 0.2 };
  const to = { x: 5, y: 0, z: 0.2 };

  it('on open ground, goes straight there', () => {
    const { project, levelId } = yard();
    const g = navGraph(levelsOf(project), levelId)!;
    const path = findPath(g, from, to)!;
    expect(path).toHaveLength(1);
    expect(path[0]).toMatchObject({ x: 5, y: 0 });
  });

  it('goes round a wall through the gap at its end', () => {
    const { project, levelId, floorId } = yard();
    // A wall from the south edge to y = 4: the way round is the gap to the north.
    const p = wall(project, levelId, floorId, -8, 4);
    const g = navGraph(levelsOf(p), levelId)!;
    const path = findPath(g, from, to)!;
    expect(path.length).toBeGreaterThan(1);
    expect(Math.max(...path.map((q) => q.y))).toBeGreaterThan(4);
    expect(length(from, path)).toBeGreaterThan(10.5);
    expect(path[path.length - 1]).toMatchObject({ x: 5, y: 0 });
  });

  it('finds no way to a place walled off', () => {
    const { project, levelId, floorId } = yard();
    const p = wall(project, levelId, floorId, -8, 8);
    const g = navGraph(levelsOf(p), levelId)!;
    expect(findPath(g, from, to)).toBeNull();
  });

  it('has no graph where there is no floor', () => {
    const { project, levelId } = start();
    expect(navGraph(levelsOf(project), levelId)).toBeNull();
  });
});

describe('walking round walls in Play Mode', () => {
  /** The yard with a wall from the south edge to y = 4, a guard west of it and a patrol stop east of it. */
  const walled = () => {
    const { project, levelId, floorId } = yard();
    let p = wall(project, levelId, floorId, -8, 4);
    const guard = place(p, levelId, floorId, 'actor.enemy', { x: -5, y: 0 });
    p = guard.project;
    const stop = place(p, levelId, floorId, 'actor.patrol', { x: 5, y: 0 });
    p = setParam(setParam(stop.project, stop.id, 'path', 'Gate'), stop.id, 'wait', 30);
    p = setParam(setParam(p, guard.id, 'patrol', 'Gate'), guard.id, 'speed', 4);
    return { p, levelId, guard: guard.id };
  };

  it('a patrol goes round the wall to its stop, never through it', () => {
    const { p, levelId, guard } = walled();
    let s = startLevelPlay(p, levelId);
    const player = { x: -7, y: 7, z: 0.2 };
    let through = false;
    for (let i = 0; i < 80; i++) {
      s = tick(p, s, 0.1, player);
      const a = s.actors[guard]!;
      if (Math.abs(a.x) < 0.3 && a.y < 4) through = true;
    }
    expect(through).toBe(false);
    expect(s.actors[guard]).toMatchObject({ x: 5, y: 0 });
    // Arrived, it keeps no way; on the way, the debug overlay draws it from where it stands.
    expect(s.actors[guard]!.route).toBeUndefined();
    const going = tick(p, startLevelPlay(p, levelId), 0.1, player);
    expect(waysOf(going)[0]![0]).toMatchObject({ x: going.actors[guard]!.x, y: going.actors[guard]!.y });
    expect(waysOf(going)[0]!.length).toBeGreaterThan(2);
    expect(levelIssues(p).some((i) => i.message.includes('can’t walk to'))).toBe(false);
  });

  it('with no way to its stop, a patrol stands', () => {
    const { project, levelId, floorId } = yard();
    let p = wall(project, levelId, floorId, -8, 8);
    const guard = place(p, levelId, floorId, 'actor.enemy', { x: -5, y: 0 });
    const stop = place(guard.project, levelId, floorId, 'actor.patrol', { x: 5, y: 0 });
    p = setParam(setParam(stop.project, stop.id, 'path', 'Gate'), guard.id, 'patrol', 'Gate');
    let s = startLevelPlay(p, levelId);
    for (let i = 0; i < 20; i++) s = tick(p, s, 0.1, { x: -7, y: 7, z: 0.2 });
    expect(s.actors[guard.id]).toMatchObject({ x: -5, y: 0, moving: false });
    // The preflight says so.
    expect(levelIssues(p).find((i) => i.id === guard.id && i.message.includes('can’t walk to'))).toMatchObject({ severity: 'warning' });
  });

  it('the enemy AI heads for the next corner of the way, not straight at its goal', () => {
    const { project, levelId, floorId } = yard();
    const p = wall(project, levelId, floorId, -8, 4);
    const g = navGraph(levelsOf(p), levelId)!;
    let way: Way | undefined;
    const steer: AIWorld['steer'] = (a, b) => {
      const goal = { x: b.x, y: b.y, z: 0.2 };
      const r = nextOnWay(g, way, { x: a.x, y: a.y, z: 0.2 }, goal);
      way = r.way;
      return r.next === goal ? b : r.next;
    };
    const world: AIWorld = { patrol: [{ x: -5, y: 0 }, { x: 5, y: 0 }], walls: [], target: { x: 0, y: 0, noisy: false, alive: false }, steer };
    const ai = defaultAI();
    let m: AIMemory = { ...startMemory(world, ai, 100), state: 'patrol', patrolIndex: 1 };
    let maxY = 0;
    for (let i = 0; i < 200 && Math.hypot(m.pos.x - 5, m.pos.y) > 0.05; i++) {
      m = aiStep(ai, 4, m, world, 0.1).memory;
      maxY = Math.max(maxY, m.pos.y);
      expect(Math.abs(m.pos.x) < 0.3 && m.pos.y < 4).toBe(false);
    }
    expect(maxY).toBeGreaterThan(4);
    expect(Math.hypot(m.pos.x - 5, m.pos.y)).toBeLessThan(0.6);
  });
});

describe('the navigation graph in the engine handoff', () => {
  it('a level with people who walk carries its graph; one with none doesn’t', () => {
    const p = sunkenVault();
    const ir = buildIR(p);
    const vault = ir.levels.find((l) => l.name === 'Sunken Vault')!;
    const g = navGraph(levelsOf(p), vault.guid)!;
    expect(vault.nav).toMatchObject({ cell: g.cell, cols: g.cols, rows: g.rows, step_up: 0.42 });
    expect(vault.nav!.nodes).toHaveLength(g.nodes.length * 3);
    expect(vault.nav!.links).toHaveLength(g.nodes.length);
    // x, y up, z: the level's own space, as the patrol stops are.
    expect(vault.nav!.nodes.slice(0, 3)).toEqual([g.nodes[0]!.x, g.nodes[0]!.z, g.nodes[0]!.y].map((n) => Math.round(n * 1000) / 1000));
    expect(ir.levels.find((l) => l.name === 'Old Quarter')!.nav).toBeUndefined();
  });

  it('Godot gets VCGSNav and each level script its graph', () => {
    const files = planHandoff(setTarget(sunkenVault(), { engine: 'godot' })).output!.files;
    expect(files.find((f) => f.path.endsWith('/nav.gd'))!.content).toContain('func find_path(from: Vector3, to: Vector3) -> Array:');
    const level = files.find((f) => f.path.endsWith('levels/sunken_vault.gd'))!.content as string;
    expect(level).toContain('const NAV := {"cell":');
    expect(level).toContain('func nav_data() -> Dictionary:');
    const story = JSON.parse(planHandoff(setTarget(sunkenVault(), { engine: 'custom' })).output!.files.find((f) => f.path.endsWith('story.json'))!.content as string);
    expect(story.levels[0].nav.nodes.length % 3).toBe(0);
  });
});
