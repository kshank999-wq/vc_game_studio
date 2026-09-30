import { describe, expect, it } from 'vitest';
import { craftCheck, describeRecipe, recipesOf } from '../crafting';
import { checkPath, pathOf } from '../paths';
import { choose, craft, craftIn, playToDecision, promptOf, startPlay, startWorld, type Play, type PlayWorld } from '../play';
import { sunkenVault } from '../sample';
import type { Project } from '../types';

/** Take the lantern, win against the eels in SC-02, and play on to the vault's free play. */
const toTheVault = (project: Project): Play => {
  let play = playToDecision(project, choose(project, playToDecision(project, startPlay(project)), 0));
  const eels = promptOf(project, play);
  if (eels.kind === 'choice' && eels.symbol === 'encounter') play = playToDecision(project, choose(project, play, 0));
  return play;
};
const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!.id;

describe('crafting (spec §8)', () => {
  it('uses up the ingredients and gives what it makes, when its rule holds', () => {
    const p = sunkenVault();
    const flare = byName(p, 'Flare');
    const salvage = byName(p, 'Salvage');
    const pistol = byName(p, 'Flare Pistol');
    expect(recipesOf(p).map((o) => o.name)).toEqual(['Flare']);
    expect(describeRecipe(p, p.objects[flare]!)).toBe('1 × Salvage → 2 × Flare');
    let world: PlayWorld = startWorld(p);
    expect(craftCheck(p, world, byName(p, 'Vault Key'))).toBe('Not craftable.');
    expect(craftCheck(p, world, flare)).toBe('Needs Flare Pistol is carried.');
    world = { ...world, items: { [pistol]: 1 } };
    expect(craftCheck(p, world, flare)).toBe('Needs 1 × Salvage (you have 0).');
    world = { ...world, items: { ...world.items, [salvage]: 2 } };
    const r = craftIn(p, world, flare);
    expect(r.log).toEqual([{ kind: 'craft', text: 'Crafted 2 × Flare', detail: 'from 1 × Salvage' }]);
    expect([r.world.items[salvage], r.world.items[flare], r.world.found[flare]]).toEqual([1, 2, true]);
  });

  it('is a decision on a path, replayed when the path is checked', () => {
    const p = sunkenVault();
    const flare = byName(p, 'Flare');
    let play = toTheVault(p);
    play = craft(p, play, flare);
    expect(play.decisions!.at(-1)).toEqual({ kind: 'craft', at: flare });
    const path = pathOf(play, 'More flares', undefined, 1);
    expect(checkPath(p, path)).toMatchObject({ ok: true });
    const pricier: Project = { ...p, objects: { ...p.objects, [flare]: { ...p.objects[flare]!, data: { ...p.objects[flare]!.data, recipe: { ingredients: [{ item: byName(p, 'Salvage'), amount: 5 }], makes: 2 } } } } };
    expect(checkPath(pricier, path).problem).toMatch(/Flare can't be crafted: Needs 5 × Salvage \(you have 2\)\.$/);
  });
});

describe('crafting in the handoff', () => {
  it('goes to every engine with what each recipe takes and makes, and when', async () => {
    const { buildIR } = await import('../handoff/ir');
    const { json, storySchema } = await import('../handoff/json');
    const ir = buildIR(sunkenVault());
    expect(ir.recipes).toEqual([
      { item: 'flare', name: 'Flare', makes: 2, ingredients: [{ item: 'salvage', name: 'Salvage', amount: 1 }], when: { match: 'all', items: [{ kind: 'item', ref: 'flare_pistol', op: 'has' }] }, whenText: 'Flare Pistol is carried' },
    ]);
    expect(JSON.parse(json.generate!(ir, 'vcgs').files[0]!.content).recipes).toHaveLength(1);
    expect(storySchema().properties.recipes).toBeTruthy();
  });
});
