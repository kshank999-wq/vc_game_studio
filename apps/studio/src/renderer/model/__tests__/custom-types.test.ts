import { describe, expect, it } from 'vitest';
import { addCustomType, customTypeOf, customTypesFor, removeCustomType, setCustomType, updateCustomType } from '../custom-types';
import { customOf } from '../details';
import { sunkenVault } from '../sample';
import { buildIR } from '../handoff/ir';
import { viewGroups } from '../bible';

describe('your own kinds of element', () => {
  it('give an element its kind’s fields, travel to the engines, and group in the Bible', () => {
    let p = sunkenVault();
    const lever = Object.values(p.objects).find((o) => o.name === 'Rusted Lever')!;
    const made = addCustomType(p, ' Mechanism ', 'object', ['Weight', ' weight ', 'Noise', '']);
    p = made.project;
    expect(customTypesFor(p, 'object').map((k) => [k.name, k.fields])).toEqual([['Mechanism', ['Weight', 'Noise']]]);
    expect(customTypesFor(p, 'character')).toEqual([]);
    p = setCustomType(p, lever.id, made.id);
    expect(customTypeOf(p, p.objects[lever.id])?.name).toBe('Mechanism');
    // Its fields, empty to fill in (a name already there isn't added twice).
    expect(customOf(p.objects[lever.id]).map((f) => f.key)).toEqual(['Weight', 'Noise']);
    const fields = buildIR(p).objects.find((o) => o.id === lever.id)!.fields;
    expect(fields.customType).toBe('Mechanism');
    expect(fields).toHaveProperty('Weight', '');
    const all = viewGroups(p, 'all');
    expect(all.find((g) => g.label.endsWith('· Mechanism'))?.entries.map((e) => e.id)).toEqual([lever.id]);
    expect(viewGroups(p, 'all', 'mechanism').flatMap((g) => g.entries.map((e) => e.id))).toContain(lever.id);
  });

  it('add new fields to every element of a kind, and leave them plain when the kind goes', () => {
    let p = sunkenVault();
    const lever = Object.values(p.objects).find((o) => o.name === 'Rusted Lever')!;
    const made = addCustomType(p, 'Mechanism', 'object', ['Weight']);
    p = setCustomType(made.project, lever.id, made.id);
    p = updateCustomType(p, made.id, { name: 'Machine', fields: ['Weight', 'Power'] });
    expect(customOf(p.objects[lever.id]).map((f) => f.key)).toEqual(['Weight', 'Power']);
    expect(customTypeOf(p, p.objects[lever.id])?.name).toBe('Machine');
    p = removeCustomType(p, made.id);
    expect(p.customTypes).toBeUndefined();
    expect(p.objects[lever.id]!.data.customType).toBeUndefined();
    // What was written stays.
    expect(customOf(p.objects[lever.id]).map((f) => f.key)).toEqual(['Weight', 'Power']);
  });
});
