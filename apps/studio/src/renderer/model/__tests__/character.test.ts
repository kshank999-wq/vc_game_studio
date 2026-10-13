import { describe, expect, it } from 'vitest';
import { ABILITY_LIBRARY, describeAction } from '../character/abilities';
import {
  addCustomAbility,
  addLibraryAbility,
  addSkillAbility,
  capacityOf,
  characterIssues,
  characters,
  createCharacter,
  duplicateCharacter,
  equipStarting,
  exportCharacter,
  grayboxOf,
  importCharacter,
  matchesCharacter,
  moveAbility,
  overrideAbility,
  patchInventory,
  patchProfile,
  profileOf,
  removeAbility,
  setStartingItem,
  toggleRole,
  updateAbility,
} from '../character/profile';
import { renameObject } from '../project';
import { sunkenVault } from '../sample';
import { speakers } from '../scene';
import type { Project } from '../types';

const byName = (p: Project, name: string) => Object.values(p.objects).find((o) => o.name === name)!;
const scene = (p: Project) => Object.values(p.objects).find((o) => o.type === 'scene')!.id;

describe('the character registry (Character Creator spec §1, §3)', () => {
  it('makes a character with a stable id, a CH- code, a unique slug and its archetype’s defaults', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Grub the Orc', roles: ['enemy'], archetype: 'orc' });
    p = made.project;
    const o = p.objects[made.id]!;
    expect(o.type).toBe('character');
    expect(o.data.code).toMatch(/^CH-\d\d$/);
    const prof = profileOf(o);
    expect(prof.slug).toBe('grub_the_orc');
    expect(prof.roles).toEqual(['enemy']);
    expect(prof.stats.health).toBe(120);
    expect(prof.art.placeholder.prop).toBe('sword');
    expect(prof.abilities.map((a) => a.name)).toEqual(['Running', 'Perception', 'Melee attack']);
    expect(o.data.color).toBe(prof.art.placeholder.tint);
    // It is in the registry and searchable.
    expect(characters(p).some((c) => c.id === made.id)).toBe(true);
    expect(matchesCharacter(o, 'orc')).toBe(true);
    expect(matchesCharacter(o, '', 'npc')).toBe(false);
    // A second of the same name gets its own slug and code.
    const again = createCharacter(p, { name: 'Grub the Orc', roles: ['enemy'], archetype: 'orc' });
    expect(profileOf(again.project.objects[again.id]!).slug).toBe('grub_the_orc_2');
    expect(again.project.objects[again.id]!.data.code).not.toBe(o.data.code);
  });

  it('is a dialogue speaker at once, and a rename keeps the id and the slug', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Old Fen', roles: ['npc'], archetype: 'villager' });
    p = made.project;
    expect(speakers(p, scene(p)).some((s) => s.character.id === made.id)).toBe(true);
    p = renameObject(p, made.id, 'Fen the Ferryman');
    const o = p.objects[made.id]!;
    expect(o.name).toBe('Fen the Ferryman');
    expect(profileOf(o).slug).toBe('old_fen');
    expect(speakers(p, scene(p)).find((s) => s.character.id === made.id)?.character.name).toBe('Fen the Ferryman');
  });

  it('reads characters made before the Character Creator, and every change bumps the revision', () => {
    let p = sunkenVault();
    const explorer = byName(p, 'The Explorer');
    expect(profileOf(explorer).roles).toEqual(['player']);
    expect(profileOf(explorer).revision).toBe(0);
    p = patchProfile(p, explorer.id, { species: 'Human' });
    p = toggleRole(p, explorer.id, 'ally');
    const prof = profileOf(p.objects[explorer.id]!);
    expect(prof.species).toBe('Human');
    expect(prof.roles).toEqual(['player', 'ally']);
    expect(prof.revision).toBe(2);
    // The edit history keeps what changed.
    expect(p.objects[explorer.id]!.data.profile).toBeTruthy();
  });

  it('duplicates with a new id, code and slug', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Orc', roles: ['enemy'], archetype: 'orc' });
    p = made.project;
    const copy = duplicateCharacter(p, made.id)!;
    const a = profileOf(copy.project.objects[made.id]!);
    const b = profileOf(copy.project.objects[copy.id]!);
    expect(copy.id).not.toBe(made.id);
    expect(b.slug).toBe('orc_copy');
    expect(b.abilities.map((x) => x.name)).toEqual(a.abilities.map((x) => x.name));
    expect(b.abilities[0]!.id).not.toBe(a.abilities[0]!.id);
  });
});

describe('ability cards (spec §4)', () => {
  it('come from the library with defaults, take overrides, and say honestly whether the graybox plays them', () => {
    expect(ABILITY_LIBRARY.filter((a) => a.graybox === 'working').map((a) => a.key)).toEqual(['run', 'jump', 'perception']);
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Ash', roles: ['enemy'], archetype: 'blank' });
    p = made.project;
    const add = addLibraryAbility(p, made.id, 'fireball');
    p = add.project;
    p = overrideAbility(p, made.id, add.cardId!, { range: 30 });
    let card = profileOf(p.objects[made.id]!).abilities[0]!;
    expect(card.overrides).toEqual({ range: 30 });
    expect(grayboxOf(card)).toBe('stub');
    // Back to the default drops the override.
    p = overrideAbility(p, made.id, add.cardId!, { range: 20 });
    card = profileOf(p.objects[made.id]!).abilities[0]!;
    expect(card.overrides).toEqual({});
    // Costs mana, but it has none: said.
    expect(characterIssues(p, made.id).some((i) => i.text.includes('costs mana'))).toBe(true);
    expect(characterIssues(p, made.id).some((i) => i.severity === 'info' && i.text.includes('graybox stub'))).toBe(true);
  });

  it('can be a project skill, or a custom power of typed, validated actions', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Ash', roles: ['player'], archetype: 'blank' });
    p = made.project;
    p = addSkillAbility(p, made.id, byName(p, 'Deep Breath').id).project;
    const custom = addCustomAbility(p, made.id, 'Roar');
    p = custom.project;
    const card = profileOf(p.objects[made.id]!).abilities[1]!;
    expect(describeAction(card.actions![0]!)).toBe('At once: Damage 10 points → an enemy, when target in range');
    p = updateAbility(p, made.id, card.id, { actions: [{ ...card.actions![0]!, condition: 'healthBelow', conditionValue: '', event: 'Bad Event' }] });
    const errors = characterIssues(p, made.id).filter((i) => i.severity === 'error').map((i) => i.text);
    expect(errors.some((t) => t.includes('Roar: action 1: Own health below needs a percentage'))).toBe(true);
    expect(errors.some((t) => t.includes('lower-case key'))).toBe(true);
    // Reorder and remove.
    p = moveAbility(p, made.id, card.id, -1);
    expect(profileOf(p.objects[made.id]!).abilities[0]!.name).toBe('Roar');
    p = removeAbility(p, made.id, card.id);
    expect(profileOf(p.objects[made.id]!).abilities.map((a) => a.name)).toEqual(['Deep Breath']);
  });
});

describe('inventory profile (spec §5)', () => {
  it('counts slots, stacks and weight, and says when the starting items don’t fit', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Ash', roles: ['player'], archetype: 'blank' });
    p = made.project;
    const flare = byName(p, 'Flare').id;
    const knife = byName(p, 'Diving Knife').id;
    p = setStartingItem(p, made.id, flare, 12);
    p = setStartingItem(p, made.id, knife, 1);
    const inv = () => profileOf(p.objects[made.id]!).inventory;
    expect(capacityOf(p, inv()).slots.of).toBe(0);
    expect(characterIssues(p, made.id).filter((i) => i.area === 'inventory' && i.severity === 'error')).toEqual([]);
    p = patchInventory(p, made.id, { mode: 'slots', slots: 4 });
    expect(capacityOf(p, inv()).slots.used).toBe(13);
    expect(characterIssues(p, made.id).some((i) => i.text === 'The starting items take 13 slots; it has 4.')).toBe(true);
    p = patchInventory(p, made.id, { mode: 'stack', stack: 10 });
    expect(capacityOf(p, inv()).slots.used).toBe(3);
    expect(characterIssues(p, made.id).some((i) => i.text.includes('slots; it has'))).toBe(false);
    p = patchInventory(p, made.id, { mode: 'weight', weight: 0 });
    expect(characterIssues(p, made.id).some((i) => i.text.includes('capacity above 0 kg'))).toBe(true);
  });

  it('equips starting gear only in a slot it fits, and only while carried', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Ash', roles: ['player'], archetype: 'blank' });
    p = made.project;
    const knife = byName(p, 'Diving Knife').id;
    const flare = byName(p, 'Flare').id;
    p = equipStarting(p, made.id, 'Hand', knife);
    expect(profileOf(p.objects[made.id]!).inventory.items).toEqual([{ item: knife, qty: 1 }]);
    expect(characterIssues(p, made.id).filter((i) => i.area === 'inventory')).toEqual([]);
    p = equipStarting(p, made.id, 'Armour', knife);
    expect(characterIssues(p, made.id).some((i) => i.text === 'Diving Knife goes in Hand, not Armour.')).toBe(true);
    p = equipStarting(p, made.id, 'Off-hand', flare);
    expect(characterIssues(p, made.id).some((i) => i.text === 'Flare isn’t equipment, so it can’t go in Off-hand.')).toBe(true);
    // Dropping the item from the starting items unequips it.
    p = setStartingItem(p, made.id, knife, 0);
    expect(profileOf(p.objects[made.id]!).inventory.equipment.find((e) => e.slot === 'Hand')?.item).toBeUndefined();
  });

  it('refuses unsupported role combinations', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Ash', roles: ['player', 'extra'], archetype: 'blank' });
    p = made.project;
    expect(characterIssues(p, made.id).some((i) => i.severity === 'error' && i.text.includes('ambient extra'))).toBe(true);
  });
});

describe('import and export (spec §10)', () => {
  it('round-trips a character into another project, matching items by name and reporting what it can’t', () => {
    let p = sunkenVault();
    const made = createCharacter(p, { name: 'Ash', roles: ['player'], archetype: 'hero' });
    p = made.project;
    p = equipStarting(p, made.id, 'Hand', byName(p, 'Diving Knife').id);
    p = addSkillAbility(p, made.id, byName(p, 'Deep Breath').id).project;
    const file = JSON.parse(JSON.stringify(exportCharacter(p, made.id)));
    expect(file.format).toBe('vcgs-character');
    // Into the same project: a new id, a new slug.
    const same = importCharacter(p, file);
    if ('error' in same) throw new Error(same.error);
    expect(same.id).not.toBe(made.id);
    expect(profileOf(same.project.objects[same.id]!).slug).toBe('ash_2');
    // Into a fresh sample: the items and skill match by name; the id is kept.
    const other = sunkenVault();
    const into = importCharacter(other, file);
    if ('error' in into) throw new Error(into.error);
    expect(into.id).toBe(made.id);
    const prof = profileOf(into.project.objects[into.id]!);
    expect(prof.inventory.equipment.find((e) => e.slot === 'Hand')?.item).toBe(byName(other, 'Diving Knife').id);
    expect(prof.abilities.some((a) => a.source.kind === 'skill' && a.source.id === byName(other, 'Deep Breath').id)).toBe(true);
    expect(importCharacter(other, { format: 'nope' })).toEqual({ error: 'That isn’t a VC Game Studio character file.' });
  });
});
