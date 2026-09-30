import { describe, expect, it } from 'vitest';
import { areaOf, corners, frameOf, sizeOf } from '../level/geometry';
import { addLevel, extrude, itemById, levelsOf, placeAsset, placeAt, pivotPoint, resizeItem, rotateItems, setOutline, setPivot } from '../level/level';
import { navigate } from '../level/nav';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const start = () => {
  const made = addLevel(createProject('Keep'), 'Keep');
  return { project: made.project, levelId: made.id, floorId: made.project.levels!.levels[0]!.floors[0]!.id };
};
const place = (p: Project, levelId: string, floorId: string, asset: string, at = { x: 0, y: 0 }) => {
  const r = placeAsset(p, levelId, floorId, asset, at);
  return { project: r.project, id: r.ids[0]! };
};
const frame = (p: Project, id: string) => frameOf(levelsOf(p), itemById(p, id)!);

describe('extrude', () => {
  it('pushes a side out with the opposite side staying put, and raises the top', () => {
    const { project, levelId, floorId } = start();
    const room = place(project, levelId, floorId, 'space.room');
    // An 8 × 6 room at the origin: its west side is at x = -4.
    let p = extrude(room.project, room.id, 'e', 2);
    expect(frame(p, room.id)).toMatchObject({ x: 1, w: 10 });
    p = extrude(p, room.id, 'n', 1);
    expect(frame(p, room.id)).toMatchObject({ y: -0.5, d: 7 });
    p = extrude(p, room.id, 'top', 1.5);
    expect(sizeOf(levelsOf(p), itemById(p, room.id)!).h).toBe(4.5);
    // Pulling in past nothing leaves one grid step.
    expect(frame(extrude(p, room.id, 'w', -20), room.id).w).toBe(0.5);
  });

  it('pushes one wall of an outline out along its normal', () => {
    const { project, levelId, floorId } = start();
    const room = place(project, levelId, floorId, 'space.room');
    let p = setOutline(room.project, room.id, [{ x: -4, y: -3 }, { x: 4, y: -3 }, { x: 4, y: 3 }, { x: -4, y: 3 }]);
    p = extrude(p, room.id, { wall: 1 }, 2);
    expect(corners(frame(p, room.id)).map((c) => [Math.round(c.x), Math.round(c.y)])).toEqual([[-4, -3], [6, -3], [6, 3], [-4, 3]]);
    expect(areaOf(frame(p, room.id))).toBeCloseTo(60);
  });
});

describe('pivots', () => {
  it('turn and grow an item about its pivot', () => {
    const { project, levelId, floorId } = start();
    const wall = place(project, levelId, floorId, 'arch.wall', { x: 10, y: 0 });
    // A 4 m wall: pivot at its west end.
    let p = setPivot(wall.project, wall.id, { x: -0.5, y: 0 });
    const hinge = pivotPoint(levelsOf(p), itemById(p, wall.id)!);
    expect(hinge).toMatchObject({ x: 8, y: 0 });
    p = rotateItems(p, [wall.id], 90);
    expect(pivotPoint(levelsOf(p), itemById(p, wall.id)!)).toMatchObject({ x: 8, y: 0 });
    expect(frame(p, wall.id)).toMatchObject({ x: 8, y: 2, rotation: 90 });
    p = placeAt(p, wall.id, { rotation: 180 });
    expect(frame(p, wall.id)).toMatchObject({ x: 6, y: 0 });
    p = resizeItem(p, wall.id, { w: 6 });
    expect(pivotPoint(levelsOf(p), itemById(p, wall.id)!)).toMatchObject({ x: 8, y: 0 });
    expect(frame(p, wall.id).x).toBeCloseTo(5);
    // Back to the centre.
    expect(itemById(setPivot(p, wall.id, { x: 0, y: 0 }), wall.id)!.pivot).toBeUndefined();
  });
});

describe('navigation preview', () => {
  it('walks the whole sample from the player start', () => {
    const p = sunkenVault();
    const set = levelsOf(p);
    const nav = navigate(set, set.levels[0]!.id);
    expect(nav.start).toBe(true);
    expect(nav.unreachable).toEqual([]);
    const chamber = frame(p, set.items.find((i) => i.name === 'Vault Chamber')!.id);
    expect(nav.cells.some((c) => c.reached && Math.hypot(c.x - chamber.x, c.y - chamber.y) < 2)).toBe(true);
    expect(levelIssues(p).filter((i) => i.message.includes('can’t be reached') || i.message.includes('lower than the player'))).toEqual([]);
  });

  it('says what can’t be reached when a doorway is too low or a room is walled off', () => {
    let p = sunkenVault();
    const byName = (name: string) => levelsOf(p).items.find((i) => i.name === name)!;
    // 1.4 m: a crouching player gets through.
    const crouching = levelIssues(resizeItem(p, byName('Crawlway').id, { h: 1.4 }));
    expect(crouching.filter((i) => i.message.includes('Crawlway') || i.message.includes('can’t be reached'))).toEqual([]);
    p = resizeItem(p, byName('Crawlway').id, { h: 1 });
    const issues = levelIssues(p);
    expect(issues.find((i) => i.id === byName('Crawlway').id)?.message).toBe('Crawlway is lower than a crouching player (1.1 m).');
    const cut = issues.filter((i) => i.message.includes('can’t be reached')).map((i) => i.message);
    expect(cut).toEqual(expect.arrayContaining(['Vault Key can’t be reached from the player start.', 'Rusted Lever can’t be reached from the player start.']));
    // The cave mouth is still reachable, so Mara is too.
    expect(cut).not.toContain('Mara can’t be reached from the player start.');
    expect(cut).toContain('Mara at the door can’t be reached from the player start.');
  });

  it('climbs a ladder between floors', () => {
    const { project, levelId, floorId } = start();
    let p = place(project, levelId, floorId, 'actor.player', { x: 0, y: 0 }).project;
    const ground = place(p, levelId, floorId, 'arch.floor', { x: 1, y: 0 });
    p = resizeItem(ground.project, ground.id, { w: 8, d: 8, h: 0.2 });
    // A platform 3 m up, too high to step onto, with a crate on it to reach.
    const deck = place(p, levelId, floorId, 'space.platform', { x: 8, y: 0 });
    p = placeAt(resizeItem(deck.project, deck.id, { w: 4, d: 4, h: 3 }), deck.id, { z: 0 });
    const goal = place(p, levelId, floorId, 'play.pickup', { x: 8, y: 0 });
    p = placeAt(goal.project, goal.id, { z: 3 });
    expect(navigate(levelsOf(p), levelId).unreachable).toContain(goal.id);
    const ladder = place(p, levelId, floorId, 'arch.ladder', { x: 5.5, y: 0 });
    p = ladder.project;
    expect(navigate(levelsOf(p), levelId).unreachable).not.toContain(goal.id);
  });
});
