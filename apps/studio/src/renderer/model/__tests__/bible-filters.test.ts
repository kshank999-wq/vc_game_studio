import { describe, expect, it } from 'vitest';
import { viewGroups } from '../bible';
import { applyFilters, filterChoices, groupChoices, matchesFilter, regroup, scenesIn, statusOf } from '../bible-filters';
import { sunkenVault } from '../sample';
import { findIssues } from '../validate';

const p = sunkenVault();
const issues = new Map(findIssues(p).map((i) => [i.id, i.message]));
const id = (name: string, type?: string) => Object.values(p.objects).find((o) => o.name === name && (!type || o.type === type))!.id;
const names = (groups: ReturnType<typeof viewGroups>) => groups.flatMap((g) => g.entries.map((e) => (e.kind === 'object' ? e.object.name : e.line.text)));

describe('Bible filters', () => {
  it('narrows a view to one scene', () => {
    const all = viewGroups(p, 'all');
    const vault = applyFilters(p, all, [{ kind: 'scene', sceneId: id('The Vault Door', 'scene') }], issues);
    expect(names(vault)).toEqual(expect.arrayContaining(['Rusted Lever', 'Mara', 'Seam drains', 'The Vault Door']));
    expect(names(vault)).not.toContain('The Cave Mouth');
  });

  it('filters characters by voice, and lines by VO status', () => {
    const characters = applyFilters(p, viewGroups(p, 'characters'), [{ kind: 'vo', value: 'has' }], issues);
    expect(names(characters).sort()).toEqual(['Mara', 'The Explorer']);
    const todo = applyFilters(p, viewGroups(p, 'dialogue'), [{ kind: 'vo', value: 'todo' }], issues);
    expect(names(todo).length).toBe(3);
    expect(applyFilters(p, viewGroups(p, 'dialogue'), [{ kind: 'vo', value: 'recorded' }], issues)).toEqual([]);
  });

  it('every filter must hold, and the menus only offer filters that keep something', () => {
    const objects = viewGroups(p, 'objects');
    const both = applyFilters(p, objects, [{ kind: 'tag', tag: 'Audio' }, { kind: 'type', type: 'object' }], issues);
    expect(names(both)).toEqual(['Rusted Lever']);
    const choices = filterChoices(p, objects.flatMap((g) => g.entries), issues);
    expect(choices.find((c) => c.heading === 'PRODUCTION')!.options.map((o) => o.filter)).toEqual([
      { kind: 'tag', tag: 'Animation' },
      { kind: 'tag', tag: 'Audio' },
    ]);
    expect(choices.find((c) => c.heading === 'TYPE')!.options.map((o) => o.count)).toEqual([1, 1]);
  });

  it('knows what needs a look, what is unused and what is complete', () => {
    const lever = viewGroups(p, 'objects').flatMap((g) => g.entries).find((e) => e.id === id('Rusted Lever'))!;
    expect(statusOf(p, lever, issues)).toBe('complete');
    const orphan = { ...p, connections: p.connections.filter((c) => c.targetId !== id('Rusted Lever')) };
    expect(statusOf(orphan, lever, new Map())).toBe('unused');
    expect(matchesFilter(p, lever, { kind: 'rules' }, issues)).toBe(false);
    const trigger = viewGroups(p, 'logic').flatMap((g) => g.entries).find((e) => e.id === id('Seam drains'))!;
    expect(matchesFilter(p, trigger, { kind: 'rules' }, issues)).toBe(true);
  });

  it('regroups by scene (showing an element under each scene it is in), status, or not at all', () => {
    const characters = viewGroups(p, 'characters');
    const byScene = regroup(p, characters, 'scene', issues);
    expect(byScene.map((g) => g.label)).toEqual(expect.arrayContaining(['SC-03 The Vault Door']));
    expect(regroup(p, characters, 'none', issues)).toHaveLength(1);
    expect(groupChoices(characters.flatMap((g) => g.entries))).toContain('role');
    expect(scenesIn(p, viewGroups(p, 'dialogue').flatMap((g) => g.entries)).map((s) => s.name)).toEqual(['The Vault Door']);
  });
});
