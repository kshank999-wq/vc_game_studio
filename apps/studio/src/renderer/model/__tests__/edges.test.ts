import { describe, expect, it } from 'vitest';
import { boxOf, edgeLines, snapBox, snapEdges } from '../level/edges';
import { addLevel, levelsOf, moveItems, placeAsset, resizeItem } from '../level/level';
import { createProject } from '../project';

const twoRooms = () => {
  const base = addLevel(createProject('Test'), 'Level');
  const lv = levelsOf(base.project).levels[0]!;
  const f = lv.floors[0]!.id;
  // A room 5.3 m wide: centred on the grid, its edges are off it.
  const a = placeAsset(base.project, lv.id, f, 'space.room', { x: 0, y: 0 });
  const p1 = resizeItem(a.project, a.ids[0]!, { w: 5.3, d: 4 });
  const b = placeAsset(p1, lv.id, f, 'space.corridor', { x: 4, y: 0 });
  const p2 = resizeItem(b.project, b.ids[0]!, { w: 2.44, d: 8 });
  return { p: p2, lv: lv.id, f, room: a.ids[0]!, hall: b.ids[0]! };
};

describe('edges that snap together', () => {
  it('moves a hallway flush against a room it is brought up to, though neither edge is on the grid', () => {
    const { p, lv, f, room, hall } = twoRooms();
    const s = levelsOf(p);
    const r = boxOf(s, s.items.find((i) => i.id === room)!);
    const h = boxOf(s, s.items.find((i) => i.id === hall)!);
    expect(r.maxX).toBeCloseTo(2.65, 5);
    // 0.13 m apart: within reach, so it closes the gap exactly.
    const sn = snapBox(h, edgeLines(s, lv, f, [hall]), 0.5);
    const moved = levelsOf(moveItems(p, [hall], sn.dx, sn.dy, undefined, true));
    expect(boxOf(moved, moved.items.find((i) => i.id === hall)!).minX).toBeCloseTo(r.maxX, 6);
    expect(sn.guides[0]).toMatchObject({ vertical: true, at: r.maxX });
    // Out of reach: left alone.
    expect(snapBox(h, edgeLines(s, lv, f, [hall]), 0.05).dx).toBe(0);
  });

  it('pulls an edge being resized onto a neighbour, and only that edge', () => {
    const { p, lv, f, hall } = twoRooms();
    const s = levelsOf(p);
    const h = boxOf(s, s.items.find((i) => i.id === hall)!);
    const out = snapEdges({ ...h, minX: h.minX - 0.2 }, { minX: true }, edgeLines(s, lv, f, [hall]), 0.5);
    expect(out.box.minX).toBeCloseTo(2.65, 6);
    expect(out.box.maxX).toBe(h.maxX);
  });

  it('ignores an edge far along the map, not beside the box', () => {
    const lines = { xs: [{ at: 10, from: 100, to: 110 }], ys: [] };
    expect(snapBox({ minX: 0, maxX: 9.9, minY: 0, maxY: 5 }, lines, 0.5).dx).toBe(0);
    expect(snapBox({ minX: 0, maxX: 9.9, minY: 96, maxY: 101 }, lines, 0.5).dx).toBeCloseTo(0.1, 6);
  });
});
