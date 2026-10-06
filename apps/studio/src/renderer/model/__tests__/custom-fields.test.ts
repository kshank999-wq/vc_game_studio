import { describe, expect, it } from 'vitest';
import { customOf, setCustom, setField } from '../details';
import { sunkenVault } from '../sample';
import { buildIR } from '../handoff/ir';
import { viewGroups } from '../bible';

describe('custom fields', () => {
  it('are kept in order, travel with the element, and lose to its own fields on a clash', () => {
    let p = sunkenVault();
    const key = Object.values(p.objects).find((o) => o.name === 'Vault Key')!;
    expect(customOf(key)).toEqual([]);
    p = setField(p, key.id, 'weight', 'heavy');
    p = setCustom(p, key.id, [
      { key: 'Rarity', value: 'unique' },
      { key: ' ', value: 'no name, not sent' },
      { key: 'weight', value: 'light' },
    ]);
    expect(customOf(p.objects[key.id]).map((f) => f.key)).toEqual(['Rarity', ' ', 'weight']);
    const fields = buildIR(p).items.find((i) => i.id === key.id)!.fields;
    expect(fields.Rarity).toBe('unique');
    expect(fields.weight).toBe('heavy');
    expect(Object.values(fields)).not.toContain('no name, not sent');
    // The Bible finds an element by its own fields too.
    expect(viewGroups(p, 'all', 'unique').flatMap((g) => g.entries.map((e) => e.id))).toContain(key.id);
    expect(setCustom(p, key.id, []).objects[key.id]!.data.custom).toBeUndefined();
  });
});
