import { describe, expect, it } from 'vitest';
import { acceptLayout, defaultGenerator, groundFloorOf, proposeLayout } from '../level/generate';
import { areaOf, assetOf, frameOf } from '../level/geometry';
import { addHallway } from '../level/hallway';
import { addLevel, levelsOf } from '../level/level';
import { createStructure } from '../level/structure';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import type { LayoutRules } from '../level/types';

const office = (hall: boolean) => {
  const base = addLevel(createProject('Test'), 'City');
  const lv = levelsOf(base.project).levels[0]!;
  const made = createStructure(base.project, { parentId: lv.id, floorId: lv.floors[0]!.id, at: { x: 0, y: 0 }, type: 'office', seed: 5 });
  const level = levelsOf(made.project).levels.find((l) => l.id === made.id)!;
  const ground = groundFloorOf(level)!;
  const s = levelsOf(made.project);
  const f = frameOf(s, s.items.find((i) => i.levelId === made.id && i.floorId === ground.id && assetOf(s, i).role === 'footprint')!);
  const p = hall ? addHallway(made.project, made.id, ground.id, [{ x: f.x - f.w / 2 + 4, y: f.y }, { x: f.x + f.w / 4, y: f.y }, { x: f.x + f.w / 4, y: f.y + f.d / 2 }], 2.4384).project : made.project;
  return { p, id: made.id, ground: ground.id, f };
};

describe('pockets go to the room beside them', () => {
  for (const [rules, hall] of [['hallways', true], ['branching', false], ['hub', false]] as [LayoutRules, boolean][])
    it(`leaves no gap between the walls, and every door in a wall (${rules})`, () => {
      const { p, id, ground, f } = office(hall);
      for (let seed = 1; seed <= 12; seed++) {
        const pr = proposeLayout(p, { levelId: id, floorIds: [ground], seed, settings: { ...defaultGenerator('office'), rules, theme: 'none' }, noCore: true });
        const after = acceptLayout(pr);
        const s = levelsOf(after);
        const spaces = s.items.filter((i) => i.levelId === id && i.floorId === ground && assetOf(s, i).kind === 'space' && assetOf(s, i).role !== 'footprint');
        const covered = spaces.reduce((n, i) => n + areaOf(frameOf(s, i)), 0);
        // Pockets bigger than a room are left alone; anything smaller is taken in.
        expect(f.w * f.d - covered, `seed ${seed}`).toBeLessThan(16 + 1e-6);
        // Rooms that took a pocket in are square to the map: every side runs along or across it.
        for (const r of spaces.filter((i) => pr.made.includes(i.id) && i.outline)) {
          const o = frameOf(s, r).outline!;
          expect(o.every((q, k) => { const n = o[(k + 1) % o.length]!; return Math.abs(q.x - n.x) < 1e-9 || Math.abs(q.y - n.y) < 1e-9; }), `seed ${seed} ${r.name}`).toBe(true);
        }
        const bad = s.items.filter((i) => pr.made.includes(i.id) && i.invalid).map((i) => `${i.name}: ${i.invalid}`);
        expect(bad, `seed ${seed}`).toEqual([]);
        const errors = levelIssues(after).filter((v) => v.levelId === id && v.severity === 'error').map((v) => v.message);
        expect(errors, `seed ${seed}`).toEqual([]);
      }
    });
});
