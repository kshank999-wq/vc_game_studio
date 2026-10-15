import { describe, expect, it } from 'vitest';
import { acceptLayout, defaultGenerator, groundFloorOf, proposeLayout } from '../level/generate';
import { areaOf, assetOf, contains, corners, frameOf, type Frame } from '../level/geometry';
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

/** A space's sides in plan, as segments. */
const sides = (F: Frame) => {
  const pts = F.outline ? F.outline.map((q) => ({ x: F.x + q.x, y: F.y + q.y })) : corners(F);
  return pts.map((p, i) => [p, pts[(i + 1) % pts.length]!] as const);
};
/** The longest stretch two spaces' sides run together (one wall a door could go in). */
const together = (A: Frame, B: Frame) => {
  let n = 0;
  for (const [a0, a1] of sides(A))
    for (const [b0, b1] of sides(B)) {
      if (Math.abs(a0.x - a1.x) < 1e-6 && Math.abs(b0.x - b1.x) < 1e-6 && Math.abs(a0.x - b0.x) < 1e-6)
        n = Math.max(n, Math.min(Math.max(a0.y, a1.y), Math.max(b0.y, b1.y)) - Math.max(Math.min(a0.y, a1.y), Math.min(b0.y, b1.y)));
      if (Math.abs(a0.y - a1.y) < 1e-6 && Math.abs(b0.y - b1.y) < 1e-6 && Math.abs(a0.y - b0.y) < 1e-6)
        n = Math.max(n, Math.min(Math.max(a0.x, a1.x), Math.max(b0.x, b1.x)) - Math.max(Math.min(a0.x, a1.x), Math.min(b0.x, b1.x)));
    }
  return n;
};

describe('doors open onto the hallway first', () => {
  it('gives every room beside a hallway its door onto the hallway, and the rooms further in a door toward it', () => {
    const { p, id, ground } = office(true);
    for (let seed = 1; seed <= 12; seed++) {
      const pr = proposeLayout(p, { levelId: id, floorIds: [ground], seed, settings: { ...defaultGenerator('office'), rules: 'hallways', theme: 'none' }, noCore: true });
      const s = levelsOf(acceptLayout(pr));
      const halls = s.items.filter((i) => i.levelId === id && i.floorId === ground && /^Hallway/.test(i.name)).map((i) => frameOf(s, i));
      const rooms = s.items.filter((i) => pr.made.includes(i.id) && i.assetId === 'space.room');
      const doors = s.items.filter((i) => pr.made.includes(i.id) && i.assetId === 'arch.door').map((i) => frameOf(s, i));
      const onHall = (d: Frame) => halls.some((h) => contains(h, d));
      let beside = 0;
      for (const r of rooms) {
        const R = frameOf(s, r);
        if (!halls.some((h) => together(R, h) >= 1.4 - 1e-6)) continue;
        beside++;
        expect(doors.some((d) => contains(R, d) && onHall(d)), `seed ${seed}: ${r.name} has no door onto the hallway`).toBe(true);
      }
      expect(beside, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      // Further in: as few doors to a hallway as there are rooms in the way, no detours.
      const spaces = [...halls, ...rooms.map((r) => frameOf(s, r))];
      const hops = (next: (i: number) => number[]) => {
        const d = spaces.map((_, i) => (i < halls.length ? 0 : Infinity));
        for (let changed = true; changed; ) {
          changed = false;
          spaces.forEach((_, i) => {
            for (const j of next(i)) if (d[j]! + 1 < d[i]!) (d[i] = d[j]! + 1), (changed = true);
          });
        }
        return d;
      };
      const byWall = hops((i) => spaces.map((_, j) => j).filter((j) => j !== i && together(spaces[i]!, spaces[j]!) >= 1.4 - 1e-6));
      const byDoor = hops((i) => spaces.map((_, j) => j).filter((j) => j !== i && doors.some((d) => contains(spaces[i]!, d) && contains(spaces[j]!, d))));
      rooms.forEach((r, k) => {
        const i = halls.length + k;
        if (Number.isFinite(byWall[i]!)) expect(byDoor[i], `seed ${seed}: ${r.name}`).toBe(byWall[i]);
      });
    }
  });
});

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
