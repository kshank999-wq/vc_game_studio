import { describe, expect, it } from 'vitest';
import { acceptLayout, defaultGenerator, entranceAt, groundFloorOf, guidedOrder, laidOut, proposeLayout, stairsAt } from '../level/generate';
import { assetOf, contains, frameOf } from '../level/geometry';
import { addLevel, levelsOf } from '../level/level';
import { createStructure, structureGraph, updateStructure } from '../level/structure';
import { createProject } from '../project';
import type { Project } from '../types';

const office = () => {
  const base = addLevel(createProject('Test'), 'City');
  const lv = levelsOf(base.project).levels[0]!;
  const made = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type: 'office', seed: 5 });
  return { p: made.project, id: made.id };
};
const level = (p: Project, id: string) => levelsOf(p).levels.find((l) => l.id === id)!;
const onFloor = (p: Project, id: string, floorId: string) => levelsOf(p).items.filter((i) => i.levelId === id && i.floorId === floorId);
const gen = (p: Project, id: string, floorId: string, seed: number) => {
  const l = level(p, id);
  const pr = proposeLayout(p, { levelId: id, floorIds: [floorId], seed, settings: { ...defaultGenerator(l.structure?.type), theme: 'none' }, ...(l.structure?.stairs ? {} : { noCore: true }) });
  return { pr, p: acceptLayout(pr) };
};

describe('floor by floor (the guided generator)', () => {
  it('asks the order: the ground floor, up to the roof, then down the basements', () => {
    const { p, id } = office();
    const order = guidedOrder(level(p, id)).map((f) => f.name);
    expect(order[0]).toBe('Ground floor');
    expect(order[order.length - 1]).toMatch(/Basement|Car park/);
  });

  it('puts the way in where it was set, then the stairs where they were set, the same on every floor, joining them all', () => {
    const { p: p0, id } = office();
    const l0 = level(p0, id);
    const ground = groundFloorOf(l0)!;
    // The entrance: a click near the north-east of the south wall snaps onto it.
    const fp = levelsOf(p0).items.find((i) => i.levelId === id && i.floorId === ground.id && assetOf(levelsOf(p0), i).role === 'footprint')!;
    const f = frameOf(levelsOf(p0), fp);
    const entrance = entranceAt(p0, id, { x: f.x + f.w / 4, y: f.y + f.d / 2 + 1 })!;
    expect(entrance.y).toBeCloseTo(f.y + f.d / 2, 5);
    expect(entranceAt(p0, id, { x: f.x, y: f.y })).toBeNull();
    let p = updateStructure(p0, id, { entrance });
    // The ground floor, before the stairs: no stair core yet.
    let step = gen(p, id, ground.id, 101);
    p = step.p;
    expect(onFloor(p, id, ground.id).some((i) => i.assetId === 'space.stairwell')).toBe(false);
    const way = onFloor(p, id, ground.id).find((i) => i.name === 'Way in')!;
    expect(Math.hypot(way.x - entrance.x, way.y - entrance.y)).toBeLessThan(3);
    // The stairs: set inside a room on the ground floor.
    const room = onFloor(p, id, ground.id).find((i) => i.assetId === 'space.room' && frameOf(levelsOf(p), i).w >= 5 && frameOf(levelsOf(p), i).d >= 6)!;
    const stairs = stairsAt(p, id, { x: room.x, y: room.y })!;
    p = updateStructure(p, id, { stairs });
    // Every other floor, one at a time, each with its own seed.
    const order = guidedOrder(level(p, id)).slice(1);
    for (const [n, floor] of order.entries()) {
      step = gen(p, id, floor.id, 200 + n);
      p = step.p;
      expect(laidOut(levelsOf(p), id, floor.id), floor.name).toBe(true);
    }
    const set = levelsOf(p);
    // The stair core stands at the same place on every floor but the ground floor (which has stairs in its room).
    const wells = set.items.filter((i) => i.levelId === id && i.assetId === 'space.stairwell');
    expect(wells.length).toBeGreaterThanOrEqual(order.length - 1);
    for (const w of wells) expect(contains(frameOf(set, w), stairs), w.name).toBe(true);
    const groundStairs = onFloor(p, id, ground.id).filter((i) => i.assetId === 'arch.stairs');
    expect(groundStairs).toHaveLength(1);
    expect(Math.hypot(groundStairs[0]!.x - stairs.x, groundStairs[0]!.y - stairs.y)).toBeLessThan(1.5);
    // Every floor joins the next, and every room can be reached from outside.
    const graph = structureGraph(set, id);
    expect(graph.unreachable).toEqual([]);
    const sorted = [...level(p, id).floors].sort((a, b) => a.elevation - b.elevation);
    for (let k = 0; k + 1 < sorted.length; k++) {
      const between = graph.edges.filter((e) => ['stairs', 'ladder', 'elevator'].includes(e.kind) && [sorted[k]!.id, sorted[k + 1]!.id].every((fid) => [e.from, e.to].some((sid) => set.items.find((i) => i.id === sid)?.floorId === fid)));
      expect(between.length, `${sorted[k]!.name} to ${sorted[k + 1]!.name}`).toBeGreaterThan(0);
    }
    // Each floor its own plan: the office floors aren't copies of each other.
    const plan = (fid: string) => JSON.stringify(set.items.filter((i) => i.levelId === id && i.floorId === fid && i.assetId === 'space.room').map((i) => [i.x, i.y, i.size?.w, i.size?.d]).sort());
    const offices = sorted.filter((fl) => fl.elevation > 0 && !/roof/i.test(fl.name)).map((fl) => plan(fl.id));
    expect(new Set(offices).size).toBeGreaterThan(1);
  });
});
