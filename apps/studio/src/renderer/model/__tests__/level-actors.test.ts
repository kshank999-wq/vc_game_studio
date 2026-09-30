import { describe, expect, it } from 'vitest';
import { CATCH_UP, motionOf, patrolStops, startPoses } from '../level/actors';
import { addLevel, levelsOf, placeAsset, setParam } from '../level/level';
import { startLevelPlay, tick, type LevelPlayState } from '../level/play';
import { levelIssues } from '../level/validate';
import { createProject } from '../project';
import { buildIR } from '../handoff/ir';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

/** A level with a guard at (0, 0) and, when given, patrol stops of "Gate" at the points. */
const level = (stops: { x: number; y: number; order: number; wait?: number }[], role = 'actor.enemy') => {
  let p: Project = addLevel(createProject('Test'), 'Yard').project;
  const levelId = p.levels!.levels[0]!.id;
  const floorId = p.levels!.levels[0]!.floors[0]!.id;
  const guard = placeAsset(p, levelId, floorId, role, { x: 0, y: 0 });
  p = guard.project;
  for (const s of stops) {
    const node = placeAsset(p, levelId, floorId, 'actor.patrol', { x: s.x, y: s.y });
    p = setParam(node.project, node.ids[0]!, 'path', 'Gate');
    p = setParam(p, node.ids[0]!, 'order', s.order);
    p = setParam(p, node.ids[0]!, 'wait', s.wait ?? 1);
  }
  return { p, levelId, floorId, guard: guard.ids[0]! };
};

const run = (p: Project, s: LevelPlayState, seconds: number, player = { x: 50, y: 50, z: 0 }) => {
  for (let i = Math.round(seconds / 0.1); i > 0; i--) s = tick(p, s, 0.1, player);
  return s;
};

describe('patrols', () => {
  it('stands still without a patrol, and walks one once it names it', () => {
    const { p, guard } = level([{ x: 4, y: 0, order: 1 }]);
    const set = levelsOf(p);
    const item = set.items.find((i) => i.id === guard)!;
    expect(motionOf(set, item)).toBeNull();
    const named = setParam(p, guard, 'patrol', ' gate ');
    const m = motionOf(levelsOf(named), levelsOf(named).items.find((i) => i.id === guard)!);
    expect(m).toMatchObject({ kind: 'patrol', name: 'gate', speed: 1.4 });
  });

  it('keeps a patrol’s stops in their order', () => {
    const { p, levelId } = level([{ x: 8, y: 0, order: 2 }, { x: 4, y: 0, order: 1 }, { x: 8, y: 4, order: 3 }]);
    expect(patrolStops(levelsOf(p), levelId, 'GATE').map((s) => [s.x, s.y])).toEqual([[4, 0], [8, 0], [8, 4]]);
    expect(patrolStops(levelsOf(p), levelId, 'Elsewhere')).toEqual([]);
  });

  it('walks to each stop at its speed, waits there, and goes round again', () => {
    const made = level([{ x: 2, y: 0, order: 1, wait: 1 }, { x: 2, y: 2, order: 2, wait: 1 }]);
    const p = setParam(setParam(made.p, made.guard, 'patrol', 'Gate'), made.guard, 'speed', 2);
    let s = startLevelPlay(p, made.levelId);
    expect(s.actors[made.guard]).toMatchObject({ x: 0, y: 0, moving: false });
    // Half a second at 2 m/s: a metre toward the first stop, facing east.
    s = run(p, s, 0.5);
    expect(s.actors[made.guard]!.x).toBeCloseTo(1, 5);
    expect(s.actors[made.guard]!.yaw).toBeCloseTo(Math.PI / 2, 5);
    expect(s.actors[made.guard]!.moving).toBe(true);
    // There, then waiting a second before the next.
    s = run(p, s, 0.6);
    expect(s.actors[made.guard]).toMatchObject({ x: 2, y: 0, moving: false, stop: 1 });
    s = run(p, s, 0.5);
    expect(s.actors[made.guard]).toMatchObject({ x: 2, y: 0 });
    // On to the second stop, then back to the first: round and round.
    s = run(p, s, 1.5);
    expect(s.actors[made.guard]!.y).toBeCloseTo(2, 5);
    expect(s.actors[made.guard]!.stop).toBe(0);
    s = run(p, s, 2.2);
    expect(s.actors[made.guard]!.x).toBeCloseTo(2, 5);
    expect(s.actors[made.guard]!.y).toBeCloseTo(0, 5);
  });

  it('warns of a patrol named with no stops, and no longer calls patrol stops the game’s to script', () => {
    const { p, guard } = level([{ x: 4, y: 0, order: 1 }]);
    const lost = setParam(p, guard, 'patrol', 'Nowhere');
    expect(levelIssues(lost).map((i) => i.message)).toContainEqual(expect.stringMatching(/ walks the patrol “Nowhere”, which has no patrol nodes\.$/));
    const ok = setParam(p, guard, 'patrol', 'Gate');
    expect(levelIssues(ok, undefined, 'godot').filter((i) => i.message.includes('patrol'))).toEqual([]);
  });

  it('stands still while a cinematic or scene card is up, and when it is not in the level', () => {
    const made = level([{ x: 10, y: 0, order: 1 }]);
    const p = setParam(made.p, made.guard, 'patrol', 'Gate');
    let s: LevelPlayState = { ...startLevelPlay(p, made.levelId), scene: { id: 'x', title: 'A scene', text: '' } };
    s = run(p, s, 1);
    expect(s.actors[made.guard]!.x).toBe(0);
    s = { ...s, scene: undefined, gone: { [made.guard]: true } };
    s = run(p, s, 1);
    expect(s.actors[made.guard]!.x).toBe(0);
  });
});

describe('companions', () => {
  it('follow the player to their follow distance, and wait there', () => {
    const made = level([], 'actor.companion');
    const p = made.p;
    expect(startPoses(levelsOf(p), made.levelId)[made.guard]).toBeTruthy();
    let s = startLevelPlay(p, made.levelId);
    // The player 6 m east: the companion walks until 2 m away, faster while far.
    s = run(p, s, 3, { x: 6, y: 0, z: 0 });
    expect(s.actors[made.guard]!.x).toBeCloseTo(4, 5);
    expect(s.actors[made.guard]!.moving).toBe(false);
    // Near enough: it stays put.
    s = run(p, s, 1, { x: 5, y: 0, z: 0 });
    expect(s.actors[made.guard]!.x).toBeCloseTo(4, 5);
  });

  it('catch up at once when left far behind or on another floor', () => {
    const made = level([], 'actor.companion');
    let s = startLevelPlay(made.p, made.levelId);
    s = tick(made.p, s, 0.1, { x: 0, y: CATCH_UP + 10, z: 0 });
    expect(s.actors[made.guard]!.y).toBeCloseTo(CATCH_UP + 8, 5);
    s = tick(made.p, s, 0.1, { x: 1, y: CATCH_UP + 8, z: 4 });
    expect(s.actors[made.guard]!.z).toBe(4);
  });

  it('stand where they are when told not to follow', () => {
    const made = level([], 'actor.companion');
    const p = setParam(made.p, made.guard, 'follow', false);
    const s = run(p, startLevelPlay(p, made.levelId), 1, { x: 6, y: 0, z: 0 });
    expect(s.actors[made.guard]).toBeUndefined();
  });
});

describe('the sample’s Mara', () => {
  it('paces the cave mouth the same in Play Mode as in every engine', () => {
    const p = sunkenVault();
    const set = levelsOf(p);
    const mara = set.items.find((i) => i.name === 'Mara')!;
    let s = startLevelPlay(p, set.levels[0]!.id);
    s = run(p, s, 5, { x: -40, y: 40, z: 0 });
    // The engines' checks (Godot, Unity, Unreal) see her at (2.35, 2.30) too.
    expect(s.actors[mara.id]!.x).toBeCloseTo(2.345, 2);
    expect(s.actors[mara.id]!.y).toBeCloseTo(2.296, 2);
    const item = buildIR(p).levels[0]!.items.find((i) => i.name === 'Mara')!;
    expect(item.motion).toMatchObject({ kind: 'patrol', name: 'Cave watch', speed: 1.1, stops: [{ at: [1.5, 0, 3], wait: 4 }, { at: [4.5, 0, 0.5], wait: 3 }] });
  });
});

