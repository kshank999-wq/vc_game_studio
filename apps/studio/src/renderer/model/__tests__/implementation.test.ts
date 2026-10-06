import { describe, expect, it } from 'vitest';
import { implementationStatuses } from '../implementation';
import { renameObject } from '../project';
import { sunkenVault as buildSample } from '../sample';
import type { Project } from '../types';

const exported = (project: Project, ids: string[], at: string): Project => ({
  ...project,
  handoff: { target: { engine: 'godot', projectFolder: '', outputPath: 'game', exportOnSave: false }, last: { at, engine: 'godot', files: 1, fingerprints: Object.fromEntries(ids.map((id) => [id, 'x'])) } },
});

describe('implementation status on story nodes', () => {
  it('says nothing before the first export', () => {
    expect(implementationStatuses(buildSample()).size).toBe(0);
  });

  it('marks what was sent, what was edited since and what was never sent', () => {
    const sample = buildSample();
    const scenes = Object.values(sample.objects).filter((o) => o.type === 'scene' && sample.placements[o.id]);
    const [a, b, c] = scenes.map((s) => s.id);
    const later = new Date(Date.now() + 60_000).toISOString();
    let p = exported(sample, [a!, b!], later);
    let status = implementationStatuses(p);
    expect(status.get(a!)).toBe('implemented');
    expect(status.get(c!)).toBe('unbound');
    // Plot points generate nothing of their own: no badge.
    const plotPoint = Object.values(p.objects).find((o) => o.type === 'plotPoint')!;
    expect(status.has(plotPoint.id)).toBe(false);
    // An edit after the export.
    p = exported(sample, [a!, b!], new Date(Date.now() - 60_000).toISOString());
    p = renameObject(p, a!, 'Renamed after export');
    status = implementationStatuses(p);
    expect(status.get(a!)).toBe('needsUpdate');
  });
});
