import { describe, expect, it } from 'vitest';
import { canSee } from '../level/actors';
import { addLevel, placeAsset, setParam, updateItem } from '../level/level';
import { startLevelPlay, tick, type LevelPlayState } from '../level/play';
import { createProject } from '../project';
import type { Project } from '../types';

const pose = { x: 0, y: 0, z: 0, yaw: 0, stop: 0, until: 0, moving: false };
const sight = { range: 10, fov: 90 };

describe('line of sight', () => {
  it('sees what is near, in front, and not behind a wall', () => {
    // Yaw 0 faces north, −y.
    expect(canSee(pose, { x: 0, y: -5, z: 0 }, sight, [])).toBe(true);
    expect(canSee(pose, { x: 0, y: 5, z: 0 }, sight, [])).toBe(false); // behind
    expect(canSee(pose, { x: 0, y: -12, z: 0 }, sight, [])).toBe(false); // too far
    expect(canSee(pose, { x: 4, y: -4, z: 0 }, sight, [])).toBe(true); // at the edge of 90°
    expect(canSee(pose, { x: 5, y: -2, z: 0 }, sight, [])).toBe(false); // outside it
    expect(canSee(pose, { x: 0, y: 5, z: 0 }, { range: 10, fov: 360 }, [])).toBe(true);
    expect(canSee(pose, { x: 0, y: -5, z: 0 }, { range: 0, fov: 90 }, [])).toBe(false); // blind
    const wall = { itemId: 'w', x: 0, y: -2.5, hw: 3, hd: 0.1, rot: 0, bottom: 0, top: 3 };
    expect(canSee(pose, { x: 0, y: -5, z: 0 }, sight, [wall])).toBe(false);
    expect(canSee(pose, { x: 0, y: -5, z: 0 }, sight, [{ ...wall, top: 1 }])).toBe(true); // low: seen over
    // Turned east, and a wall turned to run north–south.
    expect(canSee({ ...pose, yaw: Math.PI / 2 }, { x: 5, y: 0, z: 0 }, sight, [])).toBe(true);
    expect(canSee({ ...pose, yaw: Math.PI / 2 }, { x: 5, y: 0, z: 0 }, sight, [{ ...wall, x: 2.5, y: 0, rot: Math.PI / 2 }])).toBe(false);
  });

  it('runs a guard’s rules as the player comes into view, and as they leave it', () => {
    let p: Project = addLevel(createProject('Test'), 'Yard').project;
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const guard = placeAsset(p, levelId, floorId, 'actor.enemy', { x: 0, y: 0 });
    const id = guard.ids[0]!;
    p = setParam(guard.project, id, 'sight', 10);
    p = updateItem(p, id, {
      rules: [
        { id: 'r1', on: 'spotted', actions: [{ kind: 'objective', target: 'Run!' }] },
        { id: 'r2', on: 'lost', actions: [{ kind: 'objective', target: 'Hide' }] },
      ],
    });
    let s: LevelPlayState = startLevelPlay(p, levelId);
    s = tick(p, s, 0.1, { x: 0, y: 8, z: 0 }); // behind the guard
    expect(s.seen?.[id]).toBeUndefined();
    s = tick(p, s, 0.1, { x: 0, y: -5, z: 0 });
    expect(s.seen?.[id]).toBe(true);
    expect(s.log.some((l) => l.text === `${p.levels!.items.find((i) => i.id === id)!.name} sees the player`)).toBe(true);
    const objective = s.objective;
    s = tick(p, s, 0.1, { x: 0, y: -5, z: 0 });
    expect(s.objective).toBe(objective); // once, not every frame
    s = tick(p, s, 0.1, { x: 0, y: 8, z: 0 });
    expect(s.seen?.[id]).toBeUndefined();
    expect(s.log.some((l) => l.text.endsWith('loses sight of the player'))).toBe(true);
  });
});

describe('what an actor does when it sees the player', () => {
  const guardWith = (onSight: string, fov = 90) => {
    let p: Project = addLevel(createProject('Test'), 'Yard').project;
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const guard = placeAsset(p, levelId, floorId, 'actor.enemy', { x: 0, y: 0 });
    const id = guard.ids[0]!;
    p = setParam(setParam(setParam(setParam(guard.project, id, 'sight', 20), id, 'onSight', onSight), id, 'chaseSpeed', 2), id, 'fov', fov);
    return { p, levelId, id };
  };

  it('chases: closes in at its chase speed, to arm’s reach', () => {
    const { p, levelId, id } = guardWith('chase');
    let s = startLevelPlay(p, levelId);
    const player = { x: 0, y: -6, z: 0 };
    s = tick(p, s, 0.1, player); // sees them
    for (let i = 0; i < 10; i++) s = tick(p, s, 0.1, player);
    // A second at 2 m/s: two metres closer.
    expect(s.actors[id]!.y).toBeCloseTo(-2, 1);
    for (let i = 0; i < 40; i++) s = tick(p, s, 0.1, player);
    expect(s.actors[id]!.y).toBeCloseTo(-5, 5);
  });

  it('watches: stays put and turns to face the player', () => {
    const { p, levelId, id } = guardWith('watch', 360);
    let s = startLevelPlay(p, levelId);
    s = tick(p, s, 0.1, { x: 5, y: 0, z: 0 });
    s = tick(p, s, 0.1, { x: 5, y: 0, z: 0 });
    expect(s.actors[id]).toMatchObject({ x: 0, y: 0 });
    expect(s.actors[id]!.yaw).toBeCloseTo(Math.PI / 2, 5);
  });

  it('carries on by default', () => {
    const { p, levelId, id } = guardWith('carry on');
    let s = startLevelPlay(p, levelId);
    for (let i = 0; i < 5; i++) s = tick(p, s, 0.1, { x: 0, y: -6, z: 0 });
    expect(s.seen?.[id]).toBe(true);
    expect(s.actors[id]).toMatchObject({ x: 0, y: 0 });
  });
});
