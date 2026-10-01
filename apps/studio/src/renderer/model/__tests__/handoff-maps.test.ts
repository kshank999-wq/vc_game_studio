import { describe, expect, it } from 'vitest';
import { buildIR } from '../handoff/ir';
import { updateMap } from '../level/hierarchy';
import { levelsOf, updateItem } from '../level/level';
import { sunkenVault } from '../sample';

const level = (ir: ReturnType<typeof buildIR>, key: string) => ir.levels.find((l) => l.key === key)!;

describe('maps and travel in the engine handoff (Level Designer spec V2 §12, §13)', () => {
  it('gives each map its place in the hierarchy, and its children how they are reached', () => {
    const ir = buildIR(sunkenVault());
    expect(ir.levels.map((l) => [l.key, l.map.kind, l.map.parent, l.map.boundary])).toEqual([
      ['sunken_vault', 'level', 'the_drowned_coast', 'transition'],
      ['the_drowned_coast', 'world', null, 'continuous'],
      ['old_quarter', 'district', 'the_drowned_coast', 'streamed'],
    ]);
    const world = level(ir, 'the_drowned_coast');
    expect(world.map).toMatchObject({ size: [10000, 10000], grid: 100, environment: 'Overcast coast, sea fog', placement: null });
    const quarter = world.map.children.find((c) => c.key === 'old_quarter')!;
    expect(quarter).toMatchObject({ boundary: 'streamed', placement: { position: [-2000, 0, 1500], turn: 0 }, size: [1200, 800], centre: [-2000, 0, 1500], load_margin: 120 });
    // A level reached by a transition has no place in its parent.
    expect(world.map.children.find((c) => c.key === 'sunken_vault')).toMatchObject({ placement: null, anchor: null });
    // The child says the same of itself; the harbour says what it opens into.
    expect(level(ir, 'old_quarter').map.placement).toEqual(quarter.placement);
    expect(world.items.find((i) => i.name === 'Greywater Harbour')!.opens).toBe('old_quarter');
    // Bound puzzle parts go with their items.
    expect(level(ir, 'sunken_vault').items.find((i) => i.name === 'Vault Chamber')!.puzzles).toEqual([{ puzzle: 'the_vault_door', role: 'entry' }]);
  });

  it('places a child turned with the item it details, its origin turned too', () => {
    let p = sunkenVault();
    const set = levelsOf(p);
    const harbour = set.items.find((i) => i.name === 'Greywater Harbour')!;
    const quarter = set.levels.find((l) => l.name === 'Old Quarter')!;
    p = updateItem(p, harbour.id, { rotation: 90 });
    p = updateMap(p, quarter.id, { origin: { x: 100, y: 0 } });
    const child = level(buildIR(p), 'the_drowned_coast').map.children.find((c) => c.key === 'old_quarter')!;
    // Turned 90° on the plan (east to south): its 0, 0 is 100 m east of its centre, so 100 m south of the harbour.
    expect(child.placement).toEqual({ position: [-2000, 0, 1600], turn: -90 });
    expect(child.centre).toEqual([-2000, 0, 1500]);
  });

  it('sends travel links with their points, ends, lock and where they lead', () => {
    const world = level(buildIR(sunkenVault()), 'the_drowned_coast');
    const harbour = world.items.find((i) => i.name === 'Greywater Harbour')!.guid;
    expect(world.travel.map((t) => [t.key, t.kind, t.transition, t.from === harbour, t.to_map, t.one_way, t.locked])).toEqual([
      ['coast_road', 'road', 'walk', true, null, false, false],
      ['down_into_the_vault', 'loading', 'loading', false, 'sunken_vault', true, true],
    ]);
    expect(world.travel[0]).toMatchObject({ points: [[-2000, 0, 1500], [-200, 0, 900], [1800, 0, -1200]], length: 4797.367 });
    expect(world.travel[1]!.unlock_when).toEqual({ match: 'all', items: [{ kind: 'visited', ref: 'sc_01_the_cave_mouth', op: 'visited' }] });
  });
});
