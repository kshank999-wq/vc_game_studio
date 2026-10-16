import { describe, expect, it } from 'vitest';
import { aiStep, defaultAI, startMemory, type AIMemory, type AIWorld } from '../character/ai';
import { findPath, navGraph, nextOnWay, type NavGraph, type Way } from '../level/nav';
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

describe('nav areas (navmesh authoring)', () => {
  const area = (p: Project, levelId: string, floorId: string, at: { x: number; y: number }, size: { w: number; d: number }, kind: 'no walk' | 'cost', cost = 3) => {
    const a = place(p, levelId, floorId, 'logic.navArea', at);
    let q = resizeItem(a.project, a.id, { ...size, h: 2 });
    q = setParam(q, a.id, 'area', kind);
    return kind === 'cost' ? setParam(q, a.id, 'cost', cost) : q;
  };
  const from = { x: -5, y: 0, z: 0.2 };
  const to = { x: 5, y: 0, z: 0.2 };

  it('No walk takes the ground away from people, not from the player', () => {
    const { project, levelId, floorId } = yard();
    // The wall's only gap, at its north end, kept off.
    let p = wall(project, levelId, floorId, -8, 4);
    p = area(p, levelId, floorId, { x: 0, y: 6 }, { w: 3, d: 4 }, 'no walk');
    expect(findPath(navGraph(levelsOf(p), levelId)!, from, to)).toBeNull();
    // The player still gets through: the preflight's reach is the level's own.
    const start = place(p, levelId, floorId, 'actor.player', { x: -5, y: 0 });
    const goal = place(start.project, levelId, floorId, 'play.pickup', { x: 5, y: 0 });
    expect(levelIssues(goal.project).some((i) => i.id === goal.id && i.message.includes('can’t be reached'))).toBe(false);
  });

  it('Cost: round slow ground when that is shorter even so, straight across when it isn’t', () => {
    const mud = (cost: number) => {
      const { project, levelId, floorId } = yard();
      // A 6 m strip of mud across the way, open at its north end.
      const p = area(project, levelId, floorId, { x: 0, y: -1 }, { w: 6, d: 14 }, 'cost', cost);
      const g = navGraph(levelsOf(p), levelId)!;
      expect(g.costs).toBeDefined();
      return findPath(g, from, to)!;
    };
    // Across: 4 m of ground and 6 m of mud at 3 (22) against about 17 m round.
    expect(Math.max(...mud(3).map((q) => q.y))).toBeGreaterThan(6);
    // At 1.5 the mud counts 9: straight across (13) is shorter.
    const across = mud(1.5);
    expect(Math.max(...across.map((q) => Math.abs(q.y)))).toBeLessThan(1);
  });

  it('the preflight warns of a patrol stop on No walk ground', () => {
    const { project, levelId, floorId } = yard();
    const guard = place(project, levelId, floorId, 'actor.enemy', { x: -5, y: 0 });
    const stop = place(guard.project, levelId, floorId, 'actor.patrol', { x: 5, y: 0 });
    let p = setParam(setParam(stop.project, stop.id, 'path', 'Gate'), guard.id, 'patrol', 'Gate');
    expect(levelIssues(p).some((i) => i.message.includes('can’t walk to'))).toBe(false);
    p = area(p, levelId, floorId, { x: 5, y: 0 }, { w: 5, d: 5 }, 'no walk');
    expect(levelIssues(p).find((i) => i.id === guard.id && i.message.includes('can’t walk to'))).toBeDefined();
  });

  it('the handoff carries each node’s cost when any differs', () => {
    const { project, levelId, floorId } = yard();
    let p = place(project, levelId, floorId, 'actor.enemy', { x: -5, y: 0 }).project;
    expect(buildIR(p).levels[0]!.nav!.costs).toBeUndefined();
    p = area(p, levelId, floorId, { x: 0, y: 0 }, { w: 4, d: 4 }, 'cost', 4);
    const nav = buildIR(p).levels[0]!.nav!;
    expect(nav.costs).toHaveLength(nav.nodes.length / 3);
    expect(Math.max(...nav.costs!)).toBe(4);
  });
});

describe('the engines’ yard, in the studio', () => {
  /** The engine checks' 5 × 5 yard of 1 m cells: a wall down x = 2.5 with a gap at z 4–5, or with mud there instead. */
  const yardGraph = (mud = 0): NavGraph => {
    const nodes: NavGraph['nodes'] = [];
    const costs: number[] = [];
    const index = new Map<number, number>();
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 5; c++) {
        if (mud <= 0 && c === 2 && r < 4) continue;
        index.set(r * 5 + c, nodes.length);
        nodes.push({ x: c + 0.5, y: r + 0.5, z: 0 });
        costs.push(mud > 0 && c === 2 && r < 4 ? mud : 1);
      }
    const links = [...index.keys()].map((k) => {
      const r = Math.floor(k / 5);
      const c = k % 5;
      return [[0, 1], [1, 0], [0, -1], [-1, 0]].flatMap(([dr, dc]) => (r + dr! >= 0 && r + dr! < 5 && c + dc! >= 0 && c + dc! < 5 && index.has((r + dr!) * 5 + c + dc!) ? [index.get((r + dr!) * 5 + c + dc!)!] : []));
    });
    const at = new Map([...index].map(([k, i]) => [k, [i]]));
    return { cell: 1, minX: 0, minY: 0, cols: 5, rows: 5, nodes, links, at, ...(mud > 0 ? { costs } : {}) };
  };
  const ends = [{ x: 0.5, y: 0.5, z: 0 }, { x: 4.5, y: 0.5, z: 0 }] as const;
  const plain = (path: { x: number; y: number }[] | null) => path!.map((q) => [q.x, q.y]);

  it('takes the ways Godot, Unity and Unreal take', () => {
    expect(plain(findPath(yardGraph(), ...ends))).toEqual([[1.5, 4.5], [3.5, 4.5], [4.5, 0.5]]);
    expect(plain(findPath(yardGraph(10), ...ends))).toEqual([[1.5, 4.5], [3.5, 4.5], [4.5, 0.5]]);
    expect(plain(findPath(yardGraph(2), ...ends))).toEqual([[2.5, 0.5], [4.5, 0.5]]);
  });
});
