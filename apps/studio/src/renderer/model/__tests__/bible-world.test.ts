import { describe, expect, it } from 'vitest';
import { viewGroups } from '../bible';
import { FIELDS, setData } from '../details';
import { createProject, makeObject } from '../project';
import type { Project, StoryObject } from '../types';

const add = (p: Project, o: StoryObject): Project => ({ ...p, objects: { ...p.objects, [o.id]: o } });
const now = '2026-10-06T00:00:00.000Z';

describe('the Bible’s world and meaning (Writer spec §4)', () => {
  it('lists factions, and themes grouped into themes, motifs and setups', () => {
    let p = createProject();
    p = add(p, makeObject('faction', 'The Order', now, { code: 'FAC-01' }));
    const theme = makeObject('theme', 'What we bury', now, { code: 'THM-01' });
    const motif = makeObject('theme', 'Lanterns', now, { kind: 'Motif' });
    const setup = makeObject('theme', 'The sealed door', now, { kind: 'Setup / payoff', setUp: 'The shrine', paidOff: 'The vault' });
    p = [theme, motif, setup].reduce(add, p);
    expect(viewGroups(p, 'factions').flatMap((g) => g.entries.map((e) => e.id))).toHaveLength(1);
    expect(viewGroups(p, 'themes').map((g) => [g.label, g.entries.length])).toEqual([['Themes', 1], ['Motifs', 1], ['Setups and payoffs', 1]]);
    expect(viewGroups(p, 'all').map((g) => g.label)).toEqual(expect.arrayContaining(['Faction', 'Theme / Motif']));
  });

  it('gives characters traits, goals, secrets, relationships and a faction, and items a category and stacking', () => {
    const keys = (type: 'character' | 'inventory' | 'skill') => FIELDS[type]!.map((f) => f.key);
    expect(keys('character')).toEqual(expect.arrayContaining(['traits', 'goals', 'secrets', 'relationships', 'faction']));
    expect(keys('inventory')).toEqual(expect.arrayContaining(['category', 'stacks', 'requires']));
    expect(keys('skill')).toEqual(expect.arrayContaining(['duration', 'cooldown']));
    let p = createProject();
    const mara = makeObject('character', 'Mara', now);
    p = setData(add(p, mara), mara.id, { secrets: 'She sealed the vault herself' });
    expect(p.objects[mara.id]!.data.secrets).toBe('She sealed the vault herself');
  });
});
