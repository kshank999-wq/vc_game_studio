import { describe, expect, it } from 'vitest';
import { sunkenVault } from '../sample';
import { findIssues } from '../validate';
import type { Project } from '../types';

const p = sunkenVault();
const id = (project: Project, name: string, type?: string) => Object.values(project.objects).find((o) => o.name === name && (!type || o.type === type))!.id;
const withData = (project: Project, oid: string, data: Record<string, unknown>, notes?: string): Project => ({
  ...project,
  objects: { ...project.objects, [oid]: { ...project.objects[oid]!, data: { ...project.objects[oid]!.data, ...data }, ...(notes !== undefined ? { notes } : {}) } },
});

describe('validation (spec §25)', () => {
  it('the sample has nothing to look at', () => {
    expect(findIssues(p)).toEqual([]);
  });

  it('a scene used in the Bible but not on the graph is orphaned', () => {
    const scene = id(p, 'Lost Below');
    const placements = { ...p.placements };
    delete placements[scene];
    const orphan = { ...p, placements, connections: p.connections.filter((c) => c.sourceId !== scene && c.targetId !== scene) };
    expect(findIssues(orphan)).toContainEqual({ id: scene, message: expect.stringMatching(/Not on the story graph/) });
  });

  it('a character or object used in a scene with nothing about it in the Bible', () => {
    const mara = id(p, 'Mara');
    const bare = withData(p, mara, { role: '', arc: '' }, '');
    expect(findIssues(bare)).toContainEqual({ id: mara, message: 'Used in SC-03 but has no role or description in the Bible.' });
    const key = id(p, 'Vault Key');
    expect(findIssues(withData(p, key, { persists: '', use: '' }, ''))).toContainEqual({ id: key, message: expect.stringMatching(/has no description or use/) });
  });

  it('a timeline choice with one option, and a branch that reconnects to nothing', () => {
    const scene = id(p, 'The Vault Door', 'scene');
    const noBranches = { ...p, branches: [] };
    expect(findIssues(noBranches)).toContainEqual({ id: scene, message: expect.stringMatching(/only one option/) });
    const lost = { ...p, branches: p.branches.map((b) => ({ ...b, rejoinEventId: 'gone' })) };
    expect(findIssues(lost)).toContainEqual({ id: scene, message: 'The option “Force it” reconnects to an event that is gone.' });
  });
});
