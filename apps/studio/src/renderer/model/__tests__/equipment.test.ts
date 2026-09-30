import { describe, expect, it } from 'vitest';
import { equipCheck, equipmentList, statTotal, usesLeft, useCheck } from '../equipment';
import { checkPath, pathOf } from '../paths';
import { applyStoryEffects, gear, gearIn, playToDecision, startPlay, startWorld, type PlayWorld } from '../play';
import { describeCondition, describeEffect, evaluate } from '../rules';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;

describe('weapons and equipment (spec §8)', () => {
  it('go in their slot when carried, add up their stats, and put back what was there', () => {
    const p = sunkenVault();
    const knife = byName(p, 'Diving Knife');
    const pistol = byName(p, 'Flare Pistol');
    expect(equipmentList(p).map((o) => o.name)).toEqual(['Diving Knife', 'Flare Pistol']);
    let world: PlayWorld = startWorld(p);
    expect(equipCheck(p, world, knife)).toBe("You don't carry Diving Knife.");
    expect(equipCheck(p, world, byName(p, 'Vault Key'))).toBe('Not equipment.');
    world = { ...world, items: { [knife]: 1, [pistol]: 1 } };
    let r = gearIn(p, world, knife, 'equip');
    expect(r.log).toEqual([{ kind: 'gear', text: 'Equipped Diving Knife', detail: 'Hand' }]);
    world = r.world;
    expect(statTotal(p, world, 'damage')).toBe(2);
    expect(equipCheck(p, world, knife)).toBe('Diving Knife is already equipped.');
    // The pistol takes the hand: the knife is put back.
    r = gearIn(p, world, pistol, 'equip');
    expect(r.log[0]).toEqual({ kind: 'gear', text: 'Equipped Flare Pistol', detail: 'Hand · put away Diving Knife' });
    world = r.world;
    expect(world.equipped).toEqual({ Hand: pistol });
    expect([statTotal(p, world, 'Damage'), statTotal(p, world, 'Light')]).toEqual([1, 3]);
    world = gearIn(p, world, pistol, 'unequip').world;
    expect(world.equipped).toEqual({});
    expect(gearIn(p, world, pistol, 'unequip').needs).toBe('Flare Pistol is not equipped.');
  });

  it('spend their ammunition and wear out with use, and break', () => {
    const p = sunkenVault();
    const knife = byName(p, 'Diving Knife');
    const pistol = byName(p, 'Flare Pistol');
    const flare = byName(p, 'Flare');
    let world: PlayWorld = { ...startWorld(p), items: { [knife]: 1, [pistol]: 1, [flare]: 1 } };
    expect(useCheck(p, world, pistol)).toBe('Equip Flare Pistol first.');
    world = gearIn(p, world, pistol, 'equip').world;
    let r = gearIn(p, world, pistol, 'use');
    expect(r.log).toEqual([{ kind: 'gear', text: 'Used Flare Pistol', detail: '0 Flare left' }]);
    world = r.world;
    expect(useCheck(p, world, pistol)).toBe('Out of Flare.');
    // The knife: three uses, then it breaks and is gone.
    world = gearIn(p, world, knife, 'equip').world;
    expect(usesLeft(p, world, knife)).toBe(3);
    world = gearIn(p, world, knife, 'use').world;
    r = gearIn(p, world, knife, 'use');
    expect(r.log[0]).toMatchObject({ detail: '1 use left' });
    r = gearIn(p, r.world, knife, 'use');
    expect(r.log.map((e) => e.text)).toEqual(['Used Diving Knife', 'Diving Knife breaks']);
    expect(r.world.items[knife]).toBe(0);
    expect(r.world.equipped).toEqual({});
  });

  it('are asked about by conditions, equipped by effects, and come out of their slot once gone', () => {
    const p = sunkenVault();
    const knife = byName(p, 'Diving Knife');
    const on = { kind: 'equipped' as const, ref: knife, op: 'equipped' as const };
    expect(describeCondition(p, on)).toBe('Diving Knife is equipped');
    expect(describeEffect(p, { kind: 'equip', ref: knife })).toBe('equip Diving Knife');
    // An effect can't equip what isn't carried.
    expect(applyStoryEffects(p, startWorld(p), [{ kind: 'equip', ref: knife }]).world.equipped).toEqual({});
    const armed = applyStoryEffects(p, startWorld(p), [{ kind: 'give', ref: knife }, { kind: 'equip', ref: knife }]).world;
    expect(evaluate({ match: 'all', items: [on] }, armed)).toBe(true);
    const lost = applyStoryEffects(p, armed, [{ kind: 'take', ref: knife }]).world;
    expect(evaluate({ match: 'all', items: [on] }, lost)).toBe(false);
    expect(applyStoryEffects(p, armed, [{ kind: 'unequip', ref: knife }]).world.equipped).toEqual({});
  });

  it('are decisions on a path, replayed when the path is checked; the sample gives the knife at the cave mouth', () => {
    const p = sunkenVault();
    const knife = byName(p, 'Diving Knife');
    let play = playToDecision(p, startPlay(p));
    expect(play.world.items[knife]).toBe(1);
    play = gear(p, gear(p, play, knife, 'equip'), knife, 'use');
    expect(play.decisions!.slice(-2)).toEqual([{ kind: 'equip', at: knife }, { kind: 'useItem', at: knife }]);
    const path = pathOf(play, 'Cuts free', undefined, 1);
    expect(checkPath(p, path)).toMatchObject({ ok: true });
    // Without the knife in SC-01, the path can't equip it.
    const cave = p.events.find((e) => e.label === 'Light the lantern')!;
    const without: Project = { ...p, events: p.events.map((e) => (e.id === cave.id ? { ...e, effects: e.effects!.filter((x) => x.ref !== knife) } : e)) };
    expect(checkPath(without, path).problem).toMatch(/Diving Knife can't be equipped: You don't carry Diving Knife\.$/);
  });
});

describe('equipment in the handoff', () => {
  it('goes to every engine with its slot, stats, ammunition and durability', async () => {
    const { buildIR } = await import('../handoff/ir');
    const { json, storySchema } = await import('../handoff/json');
    const ir = buildIR(sunkenVault());
    expect(ir.equipment).toEqual([
      { item: 'diving_knife', name: 'Diving Knife', slot: 'Hand', stats: [{ name: 'Damage', value: 2 }], ammo: null, ammoPerUse: 1, durability: 3 },
      { item: 'flare_pistol', name: 'Flare Pistol', slot: 'Hand', stats: [{ name: 'Damage', value: 1 }, { name: 'Light', value: 3 }], ammo: { item: 'flare', name: 'Flare' }, ammoPerUse: 1, durability: 0 },
    ]);
    expect(JSON.parse(json.generate!(ir, 'vcgs').files[0]!.content).equipment).toHaveLength(2);
    expect(storySchema().properties.equipment).toBeTruthy();
  });
});

describe('conditions on stat values (spec §8)', () => {
  it('ask what the equipped items add up to, by stat name in any case', async () => {
    const { brokenReferences } = await import('../rules');
    const { statNames, statsOf } = await import('../equipment');
    const p = sunkenVault();
    const knife = byName(p, 'Diving Knife');
    const pistol = byName(p, 'Flare Pistol');
    expect(statNames(p)).toEqual(['Damage', 'Light']);
    const strong = { kind: 'stat' as const, ref: 'Damage', op: 'atLeast' as const, value: 2 };
    const dim = { kind: 'stat' as const, ref: 'light', op: 'below' as const, value: 1 };
    expect(describeCondition(p, strong)).toBe('Damage is at least 2');
    expect(describeCondition(p, dim)).toBe('light is below 1');
    let world: PlayWorld = { ...startWorld(p), items: { [knife]: 1, [pistol]: 1 } };
    const rule = (c: typeof strong | typeof dim) => evaluate({ match: 'all', items: [c] }, { ...world, stats: statsOf(p, world) });
    expect([rule(strong), rule(dim)]).toEqual([false, true]);
    world = gearIn(p, world, knife, 'equip').world;
    expect([rule(strong), rule(dim)]).toEqual([true, true]);
    world = gearIn(p, world, pistol, 'equip').world;
    expect(statsOf(p, world)).toEqual({ damage: 1, light: 3 });
    expect([rule(strong), rule(dim)]).toEqual([false, false]);
    // A stat name is not a reference to anything in the story.
    const withRule: Project = { ...p, events: p.events.map((e, i) => (i === 0 ? { ...e, when: { match: 'all', items: [strong] } } : e)) };
    expect(brokenReferences(withRule)).toEqual(brokenReferences(p));
  });

  it('are settled against in play: a trigger waiting on a stat fires once the gear is equipped', () => {
    const base = sunkenVault();
    const knife = byName(base, 'Diving Knife');
    const drains = byName(base, 'Seam drains');
    const p: Project = { ...base, objects: { ...base.objects, [drains]: { ...base.objects[drains]!, data: { ...base.objects[drains]!.data, rule: { match: 'all', items: [{ kind: 'stat', ref: 'Damage', op: 'atLeast', value: 2 }] } } } } };
    const play = playToDecision(p, startPlay(p));
    expect(play.world.fired[drains]).toBeFalsy();
    const armed = gear(p, play, knife, 'equip');
    expect(armed.world.stats).toEqual({ damage: 2 });
    expect(armed.world.fired[drains]).toBe(true);
    expect(gear(p, armed, knife, 'unequip').world.stats).toEqual({});
  });

  it('keep the stat name in the handoff', async () => {
    const { buildIR } = await import('../handoff/ir');
    const p = sunkenVault();
    const strong = { kind: 'stat' as const, ref: 'Damage', op: 'atLeast' as const, value: 2 };
    const withRule: Project = { ...p, events: p.events.map((e, i) => (i === 0 ? { ...e, when: { match: 'all', items: [strong] } } : e)) };
    expect(JSON.stringify(buildIR(withRule))).toContain('"kind":"stat","ref":"Damage"');
  });
});
