import { describe, expect, it } from 'vitest';
import { spineSequence } from '../layout';
import { blankSetup, containerName, createFromSetup, defaultsFor, setupSummary, updateSetup } from '../setup';
import { readProject } from '../storage';

describe('the Game Setup Wizard', () => {
  it('divides the spine into the chosen containers, Beginning to Ending', () => {
    const p = createFromSetup('Dust Road', { ...blankSetup('linear'), units: 3 });
    const names = spineSequence(p).map((id) => p.objects[id]!.name);
    expect(names).toEqual(['Beginning', 'Act I', 'Act II', 'Act III', 'Ending']);
    expect(p.name).toBe('Dust Road');
  });

  it('names containers after the progression model', () => {
    const setup = { ...blankSetup('shooter') };
    expect(setup.progression).toBe('missions');
    expect(containerName(setup, 1)).toBe('Mission 2');
    expect(containerName({ ...setup, progression: 'custom', customUnit: 'Heist' }, 0)).toBe('Heist 1');
  });

  it('writes the premise into the Beginning and puts the resources in the Bible', () => {
    const p = createFromSetup('Hollow', { ...blankSetup('rpg'), premise: '  A town forgets its dead.  ', resources: ['Health', 'Currency', 'Health', ' '] });
    const begin = p.objects[spineSequence(p)[0]!]!;
    expect(begin.data.summary).toBe('A town forgets its dead.');
    const items = Object.values(p.objects).filter((o) => o.type === 'inventory').map((o) => [o.name, o.data.code]);
    expect(items).toEqual([['Health', 'ITM-01'], ['Currency', 'ITM-02']]);
    expect(p.setup?.premise).toBe('A town forgets its dead.');
  });

  it('keeps the answers in the file, leaving out what was left blank', () => {
    const p = createFromSetup('Hollow', { ...blankSetup('puzzle'), tone: '', themes: ['memory', ' '] });
    const reread = readProject(JSON.parse(JSON.stringify(p)))!;
    expect(reread.setup).toEqual({ kind: 'puzzle', progression: 'chapters', units: 4, resources: ['Keys', 'Collectibles'], endings: 'single', themes: ['memory'] });
  });

  it('offers sensible starts for each kind of game', () => {
    expect(defaultsFor('survival').endings).toBe('open');
    expect(defaultsFor('branching').progression).toBe('chapters');
  });

  it('changes the answers later without touching what was made from them', () => {
    const p = createFromSetup('Hollow', blankSetup('linear'));
    const q = updateSetup(p, { ...p.setup!, tone: 'Dry, funny', units: 9 });
    expect(q.setup?.tone).toBe('Dry, funny');
    expect(spineSequence(q)).toEqual(spineSequence(p));
    expect(setupSummary(q.setup!).map((r) => r.label)).toContain('Tone');
  });
});
