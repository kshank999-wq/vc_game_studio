import { describe, expect, it } from 'vitest';
import { gearDo, gearMenu, inHand, setWorldByHand, startLevelPlay, useInHand, type LevelPlayState } from '../level/play';
import { sunkenVault } from '../sample';

const sample = () => {
  const project = sunkenVault();
  const levelId = project.levels!.levels[0]!.id;
  const story = (name: string) => Object.values(project.objects).find((o) => o.name === name)!.id;
  return { project, levelId, story };
};

const said = (s: LevelPlayState) => s.message?.text;
const lastLog = (s: LevelPlayState, n = 1) => s.log.slice(-n).map((l) => l.text);

describe('gear, skills and crafting in Play Mode (spec §8)', () => {
  it('lists what the player can do now: equipment carried, then skills, then recipes, each with why not', () => {
    const { project, levelId, story } = sample();
    let s = startLevelPlay(project, levelId);
    expect(gearMenu(project, s.world).map((o) => [o.label, o.why])).toEqual([
      ['Learn Deep Breath', ''],
      ['Learn Lantern Hood', 'Learn Deep Breath first.'],
      ['Craft Flare', 'Needs Flare Pistol is carried.'],
    ]);
    const [knife, pistol, salvage] = [story('Diving Knife'), story('Flare Pistol'), story('Salvage')];
    s = setWorldByHand(project, s, { ...s.world, items: { ...s.world.items, [knife]: 1, [pistol]: 1, [salvage]: 1 } }, 'give the gear');
    expect(gearMenu(project, s.world).map((o) => [o.act, o.label, o.why])).toEqual([
      ['equip', 'Equip Diving Knife', ''],
      ['equip', 'Equip Flare Pistol', ''],
      ['learn', 'Learn Deep Breath', ''],
      ['learn', 'Learn Lantern Hood', 'Learn Deep Breath first.'],
      ['craft', 'Craft Flare', ''],
    ]);
    s = gearDo(project, s, 'equip', pistol);
    expect(gearMenu(project, s.world).slice(0, 3).map((o) => [o.label, o.why])).toEqual([
      ['Equip Diving Knife', ''],
      ['Use Flare Pistol', 'Out of Flare.'],
      ['Put away Flare Pistol', ''],
    ]);
  });

  it('equips, uses what is in hand until it breaks, learns and crafts, saying so on screen and in the log', () => {
    const { project, levelId, story } = sample();
    const [knife, pistol, salvage, breath, hood] = [story('Diving Knife'), story('Flare Pistol'), story('Salvage'), story('Deep Breath'), story('Lantern Hood')];
    let s = startLevelPlay(project, levelId);
    s = setWorldByHand(project, s, { ...s.world, items: { ...s.world.items, [knife]: 1, [pistol]: 1, [salvage]: 1 } }, 'give the gear');
    expect(said(useInHand(project, s))).toBe('Nothing in hand.');
    s = gearDo(project, s, 'equip', knife);
    expect([said(s), inHand(s), ...lastLog(s)]).toEqual(['Equipped Diving Knife', knife, 'Equipped Diving Knife · Hand']);
    s = useInHand(project, useInHand(project, s));
    expect([said(s), ...lastLog(s)]).toEqual(['Used Diving Knife', 'Used Diving Knife · 1 use left']);
    s = useInHand(project, s);
    expect(lastLog(s, 2)).toEqual(['Used Diving Knife', 'Diving Knife breaks']);
    expect([inHand(s), s.world.items[knife]]).toEqual(['', 0]);
    // Why not goes on screen, and in the log as a warning.
    s = gearDo(project, s, 'learn', hood);
    expect([said(s), s.log.at(-1)]).toEqual(['Learn Deep Breath first.', expect.objectContaining({ kind: 'warn', text: 'Learn Lantern Hood: Learn Deep Breath first.' })]);
    s = gearDo(project, s, 'learn', breath);
    expect([said(s), ...lastLog(s)]).toEqual(['Learned Deep Breath', 'Learned Deep Breath (rank 1 of 2)']);
    s = gearDo(project, s, 'craft', story('Flare'));
    expect([said(s), ...lastLog(s)]).toEqual(['Crafted 2 × Flare', 'Crafted 2 × Flare · from 1 × Salvage']);
    expect(s.world.items[story('Flare')]).toBe(2);
    expect(said(gearDo(project, s, 'unequip', knife))).toBe('Diving Knife is not equipped.');
  });

  it('lets the story settle: the flare pistol in hand at the vault door fires Flare on the door', () => {
    const { project, levelId, story } = sample();
    const pistol = story('Flare Pistol');
    let s = startLevelPlay(project, levelId);
    s = setWorldByHand(project, s, { ...s.world, items: { ...s.world.items, [pistol]: 1 }, visited: { ...s.world.visited, [story('The Vault Door')]: true } }, 'at the door');
    s = gearDo(project, s, 'equip', pistol);
    expect(s.world.fired[story('Flare on the door')]).toBe(true);
    expect(s.world.lore[story('The Last Expedition')]).toBe(true);
    expect(s.log.map((l) => l.text)).toEqual(expect.arrayContaining(['Equipped Flare Pistol · Hand']));
  });
});
