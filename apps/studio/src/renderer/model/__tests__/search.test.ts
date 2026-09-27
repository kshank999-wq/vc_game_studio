import { describe, expect, it } from 'vitest';
import { sunkenVault } from '../sample';
import { destinationOf, search } from '../search';

describe('search', () => {
  const p = sunkenVault();

  it('finds elements by name first, and knows where each one is shown', () => {
    const [top] = search(p, 'vault door');
    expect(top!.label).toBe('The Vault Door');
    const lever = search(p, 'lever').find((r) => r.label === 'Rusted Lever')!;
    // The lever lives inside a scene, so it opens that scene's mind map.
    expect(lever.to).toMatchObject({ kind: 'scene', mode: 'exploded' });
    expect(lever.detail).toContain('in SC-03 The Vault Door');
  });

  it('finds by code, by words in notes and fields, and ignores case and accents', () => {
    expect(search(p, 'sc-03')[0]!.label).toBe('The Vault Door');
    expect(search(p, 'LANTERN ONLY').some((r) => r.label === 'Vault Chamber' && r.snippet)).toBe(true);
    expect(search(p, 'grind sfx')[0]!.label).toBe('Rusted Lever');
  });

  it('finds what is said in the script and opens it there', () => {
    const line = search(p, 'holding it shut').find((r) => r.kind === 'line')!;
    expect(line.label).toMatch(/^MARA: Water’s holding it shut/);
    expect(line.to).toMatchObject({ kind: 'scene', mode: 'open' });
    expect(line.inBible).toBe(false);
  });

  it('every word must match; nothing for an empty query', () => {
    expect(search(p, 'vault zebra')).toEqual([]);
    expect(search(p, '   ')).toEqual([]);
  });

  it('prefers the graph for anything placed on it', () => {
    const scene = Object.values(p.objects).find((o) => o.name === 'The Vault Door' && o.type === 'scene')!;
    expect(destinationOf(p, scene.id)).toEqual({ kind: 'graph', id: scene.id });
  });
});
