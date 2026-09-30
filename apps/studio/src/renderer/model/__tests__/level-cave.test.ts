import { describe, expect, it } from 'vitest';
import { BODY, CROUCH, step, type Body, type Collider } from '../level/controller';
import { levelsOf, placeAsset, resizeItem, setParam, updateItem } from '../level/level';
import { darknessAt, interactWith, isLit, offerFor, present, startLevelPlay, tick, toggleLight, type LevelPlayState } from '../level/play';
import { startWorld } from '../play';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

/** The sample, with the Silt Camp dark and the player's light from Lantern oil (fuel seconds as given). */
const darkCamp = (fuel = 0) => {
  let p: Project = sunkenVault();
  const set = levelsOf(p);
  const levelId = set.levels[0]!.id;
  const floorId = set.levels[0]!.floors[0]!.id;
  const byName = (name: string) => levelsOf(p).items.find((i) => i.name === name)!;
  const oil = Object.values(p.objects).find((o) => o.name === 'Lantern oil')!.id;
  const dark = placeAsset(p, levelId, floorId, 'logic.darkness', { x: 10, y: -9 }, { name: 'Camp dark' });
  p = resizeItem(dark.project, dark.ids[0]!, { w: 8, d: 6, h: 3 });
  const start = byName('Explorer start');
  p = setParam(setParam(p, start.id, 'light', oil), start.id, 'lightFuel', fuel);
  const world = { ...startWorld(p), mechanics: { [oil]: true } };
  return { p, levelId, byName, oil, darkId: dark.ids[0]!, startId: start.id, world };
};

const inCamp = { x: 11.5, y: -10, z: 0 };

describe('darkness and the player’s light', () => {
  it('is dark in a darkness zone, and what is in it can’t be used without a light', () => {
    const { p, levelId, byName, world } = darkCamp();
    let s: LevelPlayState = startLevelPlay(p, levelId, { world });
    s = tick(p, s, 0.1, inCamp);
    expect(darknessAt(p, s)).toEqual({ dark: 0.92, lit: false });
    const key = byName('Vault Key');
    expect(offerFor(p, s, key)!.blocked).toBe('Too dark to see. Turn your light on (L).');
    s = interactWith(p, s, key.id);
    expect(s.world.items).toEqual({});
    // Light on: it can be seen, and taken.
    s = toggleLight(p, s);
    expect(isLit(p, s)).toBe(true);
    expect(darknessAt(p, s)).toEqual({ dark: 0.92, lit: true });
    expect(offerFor(p, s, key)!.blocked).toBeUndefined();
    s = interactWith(p, s, key.id);
    expect(Object.values(s.world.items)).toEqual([1]);
  });

  it('can’t be lit without what lights it, and says what that is', () => {
    const { p, levelId, byName } = darkCamp();
    let s = startLevelPlay(p, levelId);
    s = toggleLight(p, s);
    expect(isLit(p, s)).toBe(false);
    expect(s.message!.text).toBe('You need Lantern oil for light.');
    s = tick(p, s, 0.1, inCamp);
    expect(offerFor(p, s, byName('Vault Key'))!.blocked).toBe('Too dark to see. It needs Lantern oil for light.');
  });

  it('burns its fuel while lit, goes out when it runs out, and a refuel rule fills it again', () => {
    const made = darkCamp(2);
    // Talking to Mara refills the light.
    const p = updateItem(made.p, made.byName('Mara').id, { rules: [{ id: 'r_refuel', on: 'interact', actions: [{ kind: 'refuel', target: made.startId }] }] });
    let s = toggleLight(p, startLevelPlay(p, made.levelId, { world: made.world }));
    expect(s.light).toEqual({ on: true, fuel: 2 });
    s = tick(p, s, 1.5, { x: 0, y: 0, z: 0 });
    expect(s.light.fuel).toBeCloseTo(0.5, 5);
    s = tick(p, s, 1, { x: 0, y: 0, z: 0 });
    expect(s.light).toEqual({ on: false, fuel: 0 });
    expect(s.message!.text).toBe('Your light goes out: no fuel left.');
    expect(toggleLight(p, s).message!.text).toBe('Your light has no fuel left.');
    // Mara, out of the dark, refills it.
    s = interactWith(p, s, made.byName('Mara').id);
    expect(s.light.fuel).toBe(2);
    expect(isLit(p, toggleLight(p, s))).toBe(true);
  });

  it('lasts for ever with no fuel set, and goes out if what lights it is gone', () => {
    const { p, levelId, oil, world } = darkCamp(0);
    let s = toggleLight(p, startLevelPlay(p, levelId, { world }));
    s = tick(p, s, 600, { x: 0, y: 0, z: 0 });
    expect(s.light.on).toBe(true);
    s = tick(p, { ...s, world: { ...s.world, mechanics: { [oil]: false } } }, 0.1, { x: 0, y: 0, z: 0 });
    expect(s.light.on).toBe(false);
  });
});

describe('crouching', () => {
  // A slab whose underside is 1.3 m up, from x 2 to 6: too low to stand under.
  const low: Collider[] = [
    { itemId: 'floor', x: 0, y: 0, hw: 50, hd: 50, rot: 0, bottom: -0.2, top: 0 },
    { itemId: 'slab', x: 4, y: 0, hw: 2, hd: 2, rot: 0, bottom: 1.3, top: 1.6 },
  ];
  const body: Body = { x: 0, y: 0, z: 0, vz: 0, yaw: Math.PI / 2, pitch: 0, grounded: true };
  const walk = (b: Body, crouch: boolean, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) b = step(b, { forward: 1, strafe: 0, jump: false, run: false, crouch }, 0.05, low);
    return b;
  };

  it('gets under what a standing body can’t, slower, and stands again once there is room', () => {
    expect(CROUCH.height).toBeLessThan(1.3);
    expect(BODY.height).toBeGreaterThan(1.3);
    // Standing, the slab's edge stops the body.
    expect(walk(body, false, 2).x).toBeLessThan(2);
    // Crouched, it goes under, at a crouching pace.
    const under = walk(body, true, 1.5);
    expect(under.crouched).toBe(true);
    expect(under.x).toBeGreaterThan(2);
    expect(under.x).toBeLessThan(BODY.walk * CROUCH.speed * 1.5 + 0.1);
    // Letting go under the slab keeps it crouched; past it, it stands.
    const stillUnder = step(under, { forward: 0, strafe: 0, jump: false, run: false, crouch: false }, 0.05, low);
    expect(stillUnder.crouched).toBe(true);
    const past = walk(walk(under, true, 3), false, 0.1);
    expect(past.x).toBeGreaterThan(6.4);
    expect(past.crouched).toBe(false);
  });
});

describe('the sample’s cave', () => {
  it('has a lantern to take, which lights the player’s light, a dark squeeze, and Mara to top up the oil', () => {
    const p = sunkenVault();
    const set = levelsOf(p);
    const levelId = set.levels[0]!.id;
    const byName = (name: string) => set.items.find((i) => i.name === name)!;
    let s = startLevelPlay(p, levelId);
    expect(toggleLight(p, s).message!.text).toBe('You need Lantern oil for light.');
    expect(offerFor(p, s, byName('Lantern'))!.verb).toBe('Take the lantern');
    s = interactWith(p, s, byName('Lantern').id);
    expect(present(p, s, byName('Lantern'))).toBe(false);
    s = toggleLight(p, s);
    expect(s.light).toEqual({ on: true, fuel: 90 });
    // The Squeeze is dark, less so with the light on.
    s = tick(p, s, 10, { x: 0, y: -7.5, z: 0 });
    expect(darknessAt(p, s)).toEqual({ dark: 0.96, lit: true });
    expect(s.light.fuel).toBeCloseTo(80, 5);
    // Mara fills it up again.
    s = interactWith(p, s, byName('Mara').id);
    expect(s.light.fuel).toBe(90);
  });
});
