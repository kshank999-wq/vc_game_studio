import { describe, expect, it } from 'vitest';
import { collidersFrom, step, type Body } from '../level/controller';
import { areaOf, contains, corners, frameOf, meshesFor, overlaps, polygonArea, selfIntersects, signedArea, triangulate, wallsOf } from '../level/geometry';
import { addLevel, duplicateItems, insertCorner, itemById, levelsOf, makeRectangular, mirrorItems, moveCorner, placeAsset, removeCorner, resizeItem, rotateItems, setOutline } from '../level/level';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import type { Project } from '../types';

const start = (): { project: Project; levelId: string; floorId: string } => {
  const made = addLevel(createProject('Keep'), 'Keep');
  return { project: made.project, levelId: made.id, floorId: made.project.levels!.levels[0]!.floors[0]!.id };
};

const room = (p: Project, levelId: string, floorId: string, asset = 'space.room', at = { x: 0, y: 0 }) => {
  const placed = placeAsset(p, levelId, floorId, asset, at);
  return { project: placed.project, id: placed.ids[0]! };
};

/** An L: 10 × 8, the north-east quarter cut away. Clockwise seen from above (y south). */
const L = [
  { x: -5, y: -4 },
  { x: 1, y: -4 },
  { x: 1, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 4 },
  { x: -5, y: 4 },
];

const round = (points: { x: number; y: number }[]) => points.map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));

describe('polygons', () => {
  it('measure, contain, triangulate and notice crossings', () => {
    expect(signedArea(L)).toBeGreaterThan(0);
    expect(polygonArea(L)).toBe(64);
    const tris = triangulate(L);
    expect(tris).toHaveLength((L.length - 2) * 3);
    let covered = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const t = [L[tris[i]!]!, L[tris[i + 1]!]!, L[tris[i + 2]!]!];
      // Every triangle runs the same way as the outline.
      expect(signedArea(t)).toBeGreaterThan(0);
      covered += polygonArea(t);
    }
    expect(covered).toBeCloseTo(64);
    expect(selfIntersects(L)).toBe(false);
    expect(selfIntersects([{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toBe(true);
  });
});

describe('freeform spaces', () => {
  it('take an outline: bounds become the size, walls follow the edges, the floor is a slab', () => {
    let { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    project = setOutline(r.project, r.id, L.map((p) => ({ x: p.x + 20, y: p.y + 10 })));
    const set = levelsOf(project);
    const item = itemById(project, r.id)!;
    expect(item).toMatchObject({ x: 20, y: 10, size: { w: 10, d: 8 } });
    const f = frameOf(set, item);
    expect(round(corners(f))).toEqual(L.map((p) => ({ x: p.x + 20, y: p.y + 10 })));
    expect(areaOf(f)).toBeCloseTo(64);
    expect(contains(f, { x: 24, y: 7 })).toBe(false); // the cut-away corner
    expect(contains(f, { x: 18, y: 12 })).toBe(true);
    expect(wallsOf(f).map((w) => Math.round(w.length * 100) / 100)).toEqual([6, 4, 4, 4, 10, 8]);
    const meshes = meshesFor(set, levelId);
    const floor = meshes.find((m) => m.part === 'floor')!;
    expect(floor.shape).toBe('slab');
    expect(floor.outline).toHaveLength(6);
    expect(floor.triangles).toHaveLength(12);
    expect(meshes.filter((m) => m.part === 'wall')).toHaveLength(6);
    // Walls reach half a thickness past each corner, so corners are closed.
    const north = meshes.find((m) => m.key === `${r.id}:wall0:0`)!;
    expect(north.sx).toBeCloseTo(6.2);
  });

  it('refuses outlines that cross themselves or have too few corners', () => {
    const { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    expect(setOutline(r.project, r.id, [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }])).toBe(r.project);
    expect(setOutline(r.project, r.id, [{ x: 0, y: 0 }, { x: 4, y: 0 }])).toBe(r.project);
  });

  it('keeps doors in the nearest wall when corners move, are added or are taken out', () => {
    let { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    project = setOutline(r.project, r.id, L);
    // A door in the south wall (corner 4 to 5, running west).
    const door = placeAsset(project, levelId, floorId, 'arch.door', { x: -2, y: 4 });
    project = door.project;
    const d = door.ids[0]!;
    expect(itemById(project, d)!.host).toMatchObject({ id: r.id, wall: 4 });
    expect(frameOf(levelsOf(project), itemById(project, d)!)).toMatchObject({ x: -2, y: 4 });
    // Its wall is cut.
    expect(meshesFor(levelsOf(project), levelId).filter((m) => m.key.startsWith(`${r.id}:wall4:`)).length).toBeGreaterThan(1);

    // A corner added in the north wall renumbers the walls after it; the door stays put.
    project = insertCorner(project, r.id, 0, { x: -2, y: -5 });
    expect(outlineLength(project, r.id)).toBe(7);
    expect(itemById(project, d)!.host!.wall).toBe(5);
    expect(frameOf(levelsOf(project), itemById(project, d)!).x).toBeCloseTo(-2);
    expect(frameOf(levelsOf(project), itemById(project, d)!).y).toBeCloseTo(4);

    // Dragging the notch's corner out makes the room bigger; the door still stands where it was.
    project = moveCorner(project, r.id, 3, { x: 3, y: -2 });
    expect(frameOf(levelsOf(project), itemById(project, d)!).x).toBeCloseTo(-2);
    project = removeCorner(project, r.id, 1);
    expect(outlineLength(project, r.id)).toBe(6);
    expect(itemById(project, d)!.invalid).toBeUndefined();

    // Back to a rectangle of the same bounds: the door goes to its south wall.
    project = makeRectangular(project, r.id);
    expect(itemById(project, r.id)!.outline).toBeUndefined();
    expect(itemById(project, d)!.host).toMatchObject({ wall: 2 });
  });

  it('turns an opening to its wall, whatever the wall’s angle', () => {
    let { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    // A room with its north-east corner cut on the diagonal.
    project = setOutline(r.project, r.id, [{ x: -4, y: -4 }, { x: 2, y: -4 }, { x: 4, y: -2 }, { x: 4, y: 4 }, { x: -4, y: 4 }]);
    const door = placeAsset(project, levelId, floorId, 'arch.door', { x: 3, y: -3 });
    const f = frameOf(levelsOf(door.project), itemById(door.project, door.ids[0]!)!);
    expect(itemById(door.project, door.ids[0]!)!.host!.wall).toBe(1);
    expect(f.rotation).toBeCloseTo(45);
    const leaf = meshesFor(levelsOf(door.project), levelId).find((m) => m.part === 'door')!;
    expect((-leaf.rotY * 180) / Math.PI).toBeCloseTo(45);
  });

  it('scales with its size, turns, mirrors and duplicates with its outline', () => {
    let { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    project = setOutline(r.project, r.id, L);
    project = resizeItem(project, r.id, { w: 20 });
    expect(areaOf(frameOf(levelsOf(project), itemById(project, r.id)!))).toBeCloseTo(128);
    const turned = rotateItems(project, [r.id], 90);
    const tf = frameOf(levelsOf(turned), itemById(turned, r.id)!);
    // The notch was north-east; turned a quarter clockwise it is south-east.
    expect(contains(tf, { x: 3, y: 5 })).toBe(false);
    expect(contains(tf, { x: -3, y: 5 })).toBe(true);
    const mirrored = mirrorItems(project, [r.id], 'x');
    const mf = frameOf(levelsOf(mirrored), itemById(mirrored, r.id)!);
    expect(signedArea(mf.outline!)).toBeGreaterThan(0);
    expect(contains(mf, { x: -8, y: -2 })).toBe(false);
    expect(contains(mf, { x: 8, y: -2 })).toBe(true);
    const copy = duplicateItems(project, [r.id]);
    expect(itemById(copy.project, copy.ids[0]!)!.outline).toEqual(itemById(project, r.id)!.outline);
  });

  it('comes from the library as an irregular room', () => {
    const { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId, 'space.irregular');
    const f = frameOf(levelsOf(r.project), itemById(r.project, r.id)!);
    expect(corners(f)).toHaveLength(6);
    expect(areaOf(f)).toBeCloseTo(10 * 8 - 4 * 4);
    const rect = makeRectangular(r.project, r.id);
    expect(areaOf(frameOf(levelsOf(rect), itemById(rect, r.id)!))).toBeCloseTo(80);
  });

  it('overlaps by outline, not by bounds', () => {
    let { project, levelId, floorId } = start();
    const a = room(project, levelId, floorId);
    project = setOutline(a.project, a.id, L);
    // A room in the L's notch: inside its bounds, outside its outline.
    const b = room(project, levelId, floorId, 'space.room', { x: 3, y: -2 });
    project = resizeItem(b.project, b.id, { w: 4, d: 4 });
    const set = levelsOf(project);
    expect(overlaps(frameOf(set, itemById(project, a.id)!), frameOf(set, itemById(project, b.id)!), 0.25)).toBe(false);
    expect(levelIssues(project).some((i) => i.message.includes('overlaps'))).toBe(false);
    const c = room(project, levelId, floorId, 'space.room', { x: -2, y: 2 });
    expect(levelIssues(c.project).some((i) => i.message.includes('overlaps'))).toBe(true);
  });

  it('flags an outline that crosses itself (from a file)', () => {
    const { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    const set = levelsOf(r.project);
    const bad: Project = { ...r.project, levels: { ...set, items: set.items.map((i) => (i.id === r.id ? { ...i, outline: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: -0.5 }, { x: -0.5, y: 0.5 }] } : i)) } };
    expect(levelIssues(bad).find((i) => i.id === r.id)?.message).toContain('crosses itself');
  });

  it('can be walked on and bumped into by its outline', () => {
    let { project, levelId, floorId } = start();
    const r = room(project, levelId, floorId);
    project = setOutline(r.project, r.id, L);
    const colliders = collidersFrom(meshesFor(levelsOf(project), levelId));
    const standing = (x: number, y: number): Body => ({ x, y, z: 0, vz: 0, yaw: 0, pitch: 0, grounded: true });
    // On the floor in the L's foot, it stays up; out in the cut-away corner there is nothing under it.
    expect(step(standing(-2, 2), { forward: 0, strafe: 0, jump: false, run: false }, 1 / 60, colliders).z).toBeCloseTo(0);
    expect(step(standing(3.5, -2.5), { forward: 0, strafe: 0, jump: false, run: false }, 0.2, colliders).z).toBeLessThan(0);
    // Walking north into the notch's west wall (x = 1) stops at it.
    let b = standing(0, -2);
    for (let i = 0; i < 90; i++) b = step({ ...b, yaw: Math.PI / 2 }, { forward: 1, strafe: 0, jump: false, run: false }, 1 / 60, colliders);
    expect(b.x).toBeLessThan(1 - 0.1);
  });
});

const outlineLength = (p: Project, id: string) => itemById(p, id)!.outline!.length;
