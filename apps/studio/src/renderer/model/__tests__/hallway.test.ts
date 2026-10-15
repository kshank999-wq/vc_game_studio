import { describe, expect, it } from 'vitest';
import { acceptLayout, defaultGenerator, groundFloorOf, proposeLayout } from '../level/generate';
import { assetOf, frameOf } from '../level/geometry';
import { addHallway, hallwayRuns, squaredLine } from '../level/hallway';
import { addLevel, levelsOf } from '../level/level';
import { createStructure } from '../level/structure';
import { createProject } from '../project';

describe('hallways drawn as a line', () => {
  it('squares the line up along the axes and runs straight runs together', () => {
    expect(squaredLine([{ x: 0, y: 0 }, { x: 5, y: 0.4 }, { x: 9, y: 0 }, { x: 9.3, y: 6 }])).toEqual([
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 6 },
    ]);
  });

  it('makes a run per straight piece, meeting edge to edge at the corner, with a joint there', () => {
    const { runs, joints } = hallwayRuns([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }], 2);
    expect(runs).toHaveLength(2);
    // The first takes the corner: x 0..11; the second starts past it: y 1..8.
    expect(runs[0]).toEqual({ x: 5.5, y: 0, w: 11, d: 2 });
    expect(runs[1]).toEqual({ x: 10, y: 4.5, w: 2, d: 7 });
    expect(joints).toEqual([{ x: 10, y: 1 }]);
  });

  it('lays out corridors and an opening, then rooms round them that open onto the hallway', () => {
    const base = addLevel(createProject('Test'), 'City');
    const lv = levelsOf(base.project).levels[0]!;
    const made = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type: 'office', seed: 5 });
    const id = made.id;
    const level = levelsOf(made.project).levels.find((l) => l.id === id)!;
    const ground = groundFloorOf(level)!;
    const fp = levelsOf(made.project).items.find((i) => i.levelId === id && i.floorId === ground.id && assetOf(levelsOf(made.project), i).role === 'footprint')!;
    const f = frameOf(levelsOf(made.project), fp);
    // An L across the floor, 8 ft wide.
    const hall = addHallway(made.project, id, ground.id, [{ x: f.x - f.w / 2 + 4, y: f.y }, { x: f.x + f.w / 4, y: f.y }, { x: f.x + f.w / 4, y: f.y + f.d / 2 }], 2.4384);
    const set = levelsOf(hall.project);
    const halls = set.items.filter((i) => hall.ids.includes(i.id) && i.assetId === 'space.corridor');
    expect(halls).toHaveLength(2);
    expect(frameOf(set, halls[0]!).d).toBeCloseTo(2.4384, 5);
    const opening = set.items.find((i) => hall.ids.includes(i.id) && i.assetId === 'arch.door')!;
    expect(opening.host).toBeTruthy();
    expect(opening.params?.swing).toBe('open archway');

    const pr = proposeLayout(hall.project, { levelId: id, floorIds: [ground.id], seed: 3, settings: { ...defaultGenerator('office'), rules: 'hallways', theme: 'none' }, noCore: true });
    const p = acceptLayout(pr);
    const after = levelsOf(p);
    const made2 = after.items.filter((i) => pr.made.includes(i.id));
    // No corridors of its own: the hallways drawn are the corridors.
    expect(made2.filter((i) => i.assetId === 'space.corridor')).toHaveLength(0);
    expect(made2.filter((i) => i.assetId === 'space.room').length).toBeGreaterThan(2);
    // A door on a hallway's edge (hosted in either wall it shares with the room).
    const onEdge = (d: { x: number; y: number }) =>
      halls.some((h) => {
        const F = frameOf(after, h);
        const inX = Math.abs(d.x - F.x) <= F.w / 2 + 0.6;
        const inY = Math.abs(d.y - F.y) <= F.d / 2 + 0.6;
        return inX && inY;
      });
    const doors = made2.filter((i) => i.assetId === 'arch.door');
    expect(doors.filter(onEdge).length).toBeGreaterThanOrEqual(5);
    // Flush: a room beside a hallway shares its wall exactly, no sliver of gap or overlap (the hallway is 8 ft, off the grid).
    const box = (i: (typeof halls)[number]) => {
      const F = frameOf(after, i);
      return { minX: F.x - F.w / 2, maxX: F.x + F.w / 2, minY: F.y - F.d / 2, maxY: F.y + F.d / 2 };
    };
    let beside = 0;
    for (const room of made2.filter((i) => i.assetId === 'space.room')) {
      const r = box(room);
      for (const h of halls.map(box)) {
        const acrossY = Math.min(r.maxY, h.maxY) - Math.max(r.minY, h.minY) > 0.1;
        const acrossX = Math.min(r.maxX, h.maxX) - Math.max(r.minX, h.minX) > 0.1;
        for (const gap of [acrossY ? r.minX - h.maxX : NaN, acrossY ? h.minX - r.maxX : NaN, acrossX ? r.minY - h.maxY : NaN, acrossX ? h.minY - r.maxY : NaN]) {
          // On the same wall line (anything under half a cell apart); further is an empty pocket, not a sliver.
          if (Number.isNaN(gap) || Math.abs(gap) > 0.5) continue;
          beside++;
          expect(Math.abs(gap)).toBeLessThan(1e-6);
        }
      }
    }
    expect(beside).toBeGreaterThanOrEqual(5);
    // And every door made is in a wall.
    expect(made2.filter((i) => i.assetId === 'arch.door' && i.invalid).map((i) => i.invalid)).toEqual([]);
    // Nothing made left unjoined.
    expect(pr.problems.join(' ')).not.toMatch(/couldn’t be joined/);
  });
});
