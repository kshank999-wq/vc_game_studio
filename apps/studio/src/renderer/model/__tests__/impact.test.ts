import { describe, expect, it } from 'vitest';
import { deletionImpact, removalImpact } from '../impact';
import { removeObject } from '../project';
import { sunkenVault } from '../sample';

const p = sunkenVault();
const id = (name: string, type?: string) => Object.values(p.objects).find((o) => o.name === name && (!type || o.type === type))!.id;

describe('what a delete takes with it', () => {
  it('a character: the scenes, the lines, the arc lane and the rules that name her', () => {
    const impact = deletionImpact(p, id('Mara'));
    expect(impact.join('\n')).toMatch(/used in \d scenes?/);
    expect(impact.join('\n')).toMatch(/lines? spoken by Mara keep their words/);
    expect(impact.join('\n')).toContain('The arc lane “Mara” stays');
    expect(impact.join('\n')).toMatch(/conditions? or effects? will point at nothing: .*a timeline event/);
  });

  it('an element in rules elsewhere says which', () => {
    const lever = deletionImpact(p, id('Rusted Lever'));
    expect(lever.some((l) => l.includes('will point at nothing: The Vault Door, Seam drains'))).toBe(true);
  });

  it('a scene: its script and timeline, and the elements only it used', () => {
    const impact = deletionImpact(p, id('The Vault Door', 'scene')).join('\n');
    expect(impact).toMatch(/Its script \(\d lines\) and timeline \(\d+ events\) go with it/);
    expect(impact).toMatch(/elements only this scene used stay in the Bible/);
  });

  it('taking an element out of the only scene that uses it deletes it, and says what breaks', () => {
    const r = removalImpact(p, id('The Vault Door', 'scene'), id('Rusted Lever'));
    expect(r.deletes).toBe(true);
    expect(r.impact.some((l) => l.includes('Seam drains'))).toBe(true);
    expect(r.impact.some((l) => l.startsWith('It is used in'))).toBe(false);
    // A character stays in the project: only her lines here lose their speaker.
    const mara = removalImpact(p, id('The Vault Door', 'scene'), id('Mara'));
    expect(mara.deletes).toBe(false);
    expect(mara.impact[0]).toMatch(/lines? Mara speaks in this scene lose their speaker/);
  });

  it('deleting a character unties her arc lane; deleting a location clears the scenes set there', () => {
    const next = removeObject(p, id('Mara'));
    expect(next.lanes.find((l) => l.name === 'Mara')!.characterId).toBeUndefined();
    const chamber = id('Vault Chamber');
    const without = removeObject(p, chamber);
    expect(Object.values(without.objects).some((o) => o.data.locationId === chamber)).toBe(false);
  });
});
