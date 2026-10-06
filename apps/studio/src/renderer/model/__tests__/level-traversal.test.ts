import { describe, expect, it } from 'vitest';
import { CLIMB, SWIM, step, type Body } from '../level/controller';
import { addLevel, placeAsset, resizeItem, setParam } from '../level/level';
import { spendStamina, startLevelPlay, STAMINA, traversalAt } from '../level/play';
import { createProject } from '../project';
import type { Project } from '../types';

const body = (z = 0): Body => ({ x: 0, y: 0, z, vz: 0, yaw: 0, pitch: 0, grounded: true });
const floor = [{ itemId: 'f', x: 0, y: 0, hw: 50, hd: 50, rot: 0, bottom: -0.2, top: 0 }];
const still = { forward: 0, strafe: 0, jump: false, run: false };

describe('climbing and swimming', () => {
  it('climbs a ladder with forward, goes down with back, and does not fall', () => {
    let b = step(body(), { ...still, forward: 1, ladder: true }, 0.5, floor);
    expect(b.z).toBeCloseTo(CLIMB * 0.5, 5);
    expect(b.climbing).toBe(true);
    // Let go of the keys: it holds on.
    b = step(b, { ...still, ladder: true }, 0.5, floor);
    expect(b.z).toBeCloseTo(CLIMB * 0.5, 5);
    b = step(b, { ...still, forward: -1, ladder: true }, 1, floor);
    expect(b.z).toBe(0);
    expect(b.grounded).toBe(true);
    // Off the ladder, it is no longer climbing.
    expect(step(b, still, 0.1, floor).climbing).toBe(false);
  });

  it('wades in shallow water, swims in deep: slower, sinking slowly, jump to rise', () => {
    const wade = step(body(), { ...still, forward: 1, water: 0.6 }, 0.5, floor);
    expect(wade.swimming).toBeUndefined();
    // Afloat in deep water (the floor far below).
    const deep = { ...body(-3), grounded: false };
    const sink = step(deep, { ...still, water: 0 }, 0.5, floor);
    expect(sink.swimming).toBe(true);
    expect(sink.z).toBeLessThan(-3);
    expect(sink.z).toBeGreaterThan(-3 - SWIM.sink * 0.5 - 1e-9);
    const up = step(deep, { ...still, jump: true, water: 0 }, 0.5, floor);
    expect(up.z).toBeGreaterThan(-3);
    // Treading water: no higher than the surface less its depth.
    let tread = deep;
    for (let i = 0; i < 40; i++) tread = step(tread, { ...still, jump: true, water: 0 }, 0.1, floor);
    expect(tread.z).toBeLessThanOrEqual(-SWIM.depth + 0.05 + 1e-9);
    const swim = step(deep, { ...still, forward: 1, run: true, water: 0 }, 1, floor);
    expect(Math.abs(swim.y)).toBeLessThan(4); // walk pace × SWIM.pace, never a run
  });
});

describe('where the player is, and stamina', () => {
  const level = (stamina = true) => {
    let p: Project = addLevel(createProject('Test'), 'Cave').project;
    const levelId = p.levels!.levels[0]!.id;
    const floorId = p.levels!.levels[0]!.floors[0]!.id;
    const start = placeAsset(p, levelId, floorId, 'actor.player', { x: 0, y: 0 });
    p = setParam(start.project, start.ids[0]!, 'stamina', stamina);
    const ladder = placeAsset(p, levelId, floorId, 'arch.ladder', { x: 10, y: 0 });
    p = ladder.project;
    const pool = placeAsset(p, levelId, floorId, 'logic.water', { x: -10, y: 0 });
    p = resizeItem(pool.project, pool.ids[0]!, { w: 6, d: 6, h: 2 });
    return { p, levelId };
  };

  it('finds the ladder in reach and the water around the player', () => {
    const { p, levelId } = level();
    const s = startLevelPlay(p, levelId);
    expect(traversalAt(p, s, { x: 10, y: 0.3, z: 0 })).toEqual({ ladder: true });
    expect(traversalAt(p, s, { x: 10, y: 0, z: 5 })).toEqual({ ladder: false }); // above its top
    expect(traversalAt(p, s, { x: -10, y: 0, z: 0 })).toEqual({ ladder: false, water: 2 });
    expect(traversalAt(p, s, { x: 0, y: 0, z: 0 })).toEqual({ ladder: false });
  });

  it('runs down with effort, comes back at rest, and out of it in deep water the player drowns', () => {
    const { p, levelId } = level();
    let s = startLevelPlay(p, levelId);
    s = spendStamina(p, s, 2, { run: true });
    expect(s.stamina).toBeCloseTo(100 - STAMINA.run * 2, 5);
    s = spendStamina(p, s, 1, {});
    expect(s.stamina).toBeCloseTo(100 - STAMINA.run * 2 + STAMINA.rest, 5);
    s = spendStamina(p, s, 60, { swim: true });
    expect(s.stamina).toBe(0);
    expect(s.log.some((l) => l.text === 'Out of stamina')).toBe(true);
    const health = s.health;
    s = spendStamina(p, s, 1, { swim: true });
    expect(s.health).toBeCloseTo(health - STAMINA.drown, 5);
  });

  it('leaves stamina alone unless the level tracks it', () => {
    const { p, levelId } = level(false);
    const s = startLevelPlay(p, levelId);
    expect(spendStamina(p, s, 10, { run: true })).toBe(s);
  });
});
