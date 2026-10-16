import { describe, expect, it } from 'vitest';
import { updateMap } from '../level/hierarchy';
import { levelsOf, updateItem } from '../level/level';
import { assetOf, frameOf } from '../level/geometry';
import { streamLayout, streamingIssues } from '../level/streaming';
import { tallyOf } from '../level/budget';
import { levelIssues } from '../level/validate';
import { buildIR } from '../handoff/ir';
import { planHandoff, setTarget } from '../handoff';
import { sunkenVault } from '../sample';
import type { EngineId } from '../types';

const vault = () => {
  const p = sunkenVault();
  return { p, level: levelsOf(p).levels.find((l) => l.name === 'Sunken Vault')! };
};

describe('streaming and world partition', () => {
  it('no plan, no cells', () => {
    const { p, level } = vault();
    expect(streamLayout(p, level.id)).toBeNull();
    expect(streamingIssues(p, level.id)).toEqual([]);
  });

  it('cuts the level into named cells, each with what is in it and its cost', () => {
    const { p, level } = vault();
    const q = updateMap(p, level.id, { streaming: { cell: 8, range: 0 } });
    const l = streamLayout(q, level.id)!;
    expect(l.cols * l.rows).toBe(l.cells.length);
    expect(l.cols).toBeGreaterThan(1);
    expect(l.cells[0]!.key).toBe('A1');
    expect(l.cells[1]!.key).toBe('B1');
    expect(l.cells[l.cols]!.key).toBe('A2');
    // Every item is in exactly one cell, or always loaded.
    const set = levelsOf(q);
    const items = set.items.filter((i) => i.levelId === level.id && !i.hidden);
    const placed = l.cells.flatMap((c) => c.items);
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length + l.always.length).toBe(items.length);
    // An item's centre is inside its cell.
    for (const c of l.cells)
      for (const id of c.items) {
        const f = frameOf(set, set.items.find((i) => i.id === id)!);
        expect(f.x).toBeGreaterThanOrEqual(c.x0 - 1e-6);
        expect(f.x).toBeLessThanOrEqual(c.x1 + 1e-6);
      }
    // The cells' costs add up to the level's.
    const total = tallyOf(q, level.id).counts;
    const sum = l.cells.reduce((n, c) => n + c.counts.triangles, 0);
    const always = l.always.reduce((n, id) => n + (tallyOf(q, level.id).byItem.triangles.get(id) ?? 0), 0);
    expect(sum + always).toBeCloseTo(total.triangles, 3);
    expect(l.cells.reduce((n, c) => n + c.counts.navNodes, 0)).toBe(total.navNodes);
  });

  it('the player start stays loaded, and so does what is marked', () => {
    const { p, level } = vault();
    const set = levelsOf(p);
    const start = set.items.find((i) => i.levelId === level.id && assetOf(set, i).role === 'playerStart')!;
    const other = set.items.find((i) => i.levelId === level.id && !i.hidden && i.id !== start.id)!;
    const l = streamLayout(updateMap(p, level.id, { streaming: { cell: 8, range: 0, always: [other.id] } }), level.id)!;
    expect(l.always).toEqual(expect.arrayContaining([start.id, other.id]));
    expect(l.cells.some((c) => c.items.includes(other.id))).toBe(false);
  });

  it('a wider load range loads more at once', () => {
    const { p, level } = vault();
    const tight = streamLayout(updateMap(p, level.id, { streaming: { cell: 8, range: 0 } }), level.id)!;
    const wide = streamLayout(updateMap(p, level.id, { streaming: { cell: 8, range: 1000 } }), level.id)!;
    const tri = (l: typeof tight) => l.worst.find((w) => w.metric === 'triangles')!.count;
    expect(tri(wide)).toBeGreaterThan(tri(tight));
    expect(tri(wide)).toBeCloseTo(tallyOf(p, level.id).counts.triangles, 3);
  });

  it('warns of a patrol walking out of what is loaded, and a rule reaching too far', () => {
    const { p, level } = vault();
    const q = updateMap(p, level.id, { streaming: { cell: 4, range: 0 } });
    expect(streamingIssues(q, level.id).some((i) => /patrol reaches .* out of what is loaded/.test(i.message))).toBe(true);
    // A rule on one corner acting on something at the other.
    const l = streamLayout(q, level.id)!;
    const filled = l.cells.filter((c) => c.items.length);
    const a = filled[0]!;
    const b = filled[filled.length - 1]!;
    const r = updateItem(q, a.items[0]!, { rules: [{ id: 'far', on: 'interact', actions: [{ kind: 'open', target: b.items[0]! }] }] });
    const issue = streamingIssues(r, level.id).find((i) => i.id === a.items[0])!;
    expect(issue.message).toContain(`(in ${a.key})`);
    expect(issue.message).toContain(`in ${b.key}, which may not be loaded then`);
    // Marked always loaded, it reaches.
    const marked = updateMap(r, level.id, { streaming: { cell: 4, range: 0, always: [b.items[0]!] } });
    expect(streamingIssues(marked, level.id).some((i) => i.id === a.items[0])).toBe(false);
    // The preflight carries them as warnings.
    expect(levelIssues(r).some((i) => i.levelId === level.id && i.severity === 'warning' && i.message.includes('may not be loaded'))).toBe(true);
  });

  it('warns when what is loaded at once is over the budget', () => {
    const { p, level } = vault();
    const q = updateMap(updateMap(p, level.id, { streaming: { cell: 8, range: 0 } }), level.id, { budget: { platform: 'mobile', limits: { triangles: 100 } } });
    expect(streamingIssues(q, level.id).find((i) => i.id === level.id)!.message).toMatch(/^Round cell [A-Z]+\d+ the loaded cells cost \d+ triangles, over the budget of 100\.$/);
  });

  it('the handoff carries the plan, and every engine gets STREAMING.md', () => {
    const { p, level } = vault();
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    for (const e of engines) expect(planHandoff(setTarget(p, { engine: e })).output!.files.some((f) => f.path.endsWith('STREAMING.md'))).toBe(false);
    const q = updateMap(p, level.id, { streaming: { cell: 8, range: 16 } });
    const s = buildIR(q).levels.find((l) => l.guid === level.id)!.streaming!;
    expect(s).toMatchObject({ cell: 8, load_range: 16 });
    expect(s.cells[0]).toMatchObject({ key: 'A1' });
    expect(s.cells[0]!.bounds).toHaveLength(4);
    expect(s.always.length).toBeGreaterThan(0);
    const docs: Record<string, RegExp> = { godot: /ResourceLoader/, unity: /LoadSceneMode\.Additive/, unreal: /Cell Size to 800 and its Loading Range to 1600/, custom: /within 16 m/ };
    for (const e of engines) {
      const md = planHandoff(setTarget(q, { engine: e })).output!.files.find((f) => f.path.endsWith('STREAMING.md'))!;
      expect(md.content).toContain('# Streaming');
      expect(md.content).toMatch(docs[e]!);
      expect(md.content).toContain('| A');
    }
  });
});
