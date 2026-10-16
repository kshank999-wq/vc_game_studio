import { describe, expect, it } from 'vitest';
import { limitsOf, overBudget, PLATFORMS, tallyOf } from '../level/budget';
import { updateMap } from '../level/hierarchy';
import { levelsOf } from '../level/level';
import { assetOf } from '../level/geometry';
import { levelIssues } from '../level/validate';
import { buildIR } from '../handoff/ir';
import { planHandoff, setTarget } from '../handoff';
import { sunkenVault } from '../sample';
import type { EngineId } from '../types';

const vault = () => {
  const p = sunkenVault();
  return { p, level: levelsOf(p).levels.find((l) => l.name === 'Sunken Vault')! };
};

describe('performance budgets', () => {
  it('counts what a level costs from what is placed', () => {
    const { p, level } = vault();
    const set = levelsOf(p);
    const t = tallyOf(p, level.id);
    const lights = set.items.filter((i) => i.levelId === level.id && !i.hidden && assetOf(set, i).kind === 'light').length;
    expect(lights).toBeGreaterThan(0);
    expect(t.counts.lights).toBe(lights);
    expect(t.counts.triangles).toBeGreaterThan(100);
    expect(t.counts.drawCalls).toBeGreaterThan(10);
    expect(t.counts.actors).toBeGreaterThan(0);
    expect(t.counts.navNodes).toBeGreaterThan(100);
    // What adds most comes first.
    expect(t.top.triangles[0]!.amount).toBeGreaterThanOrEqual(t.top.triangles[1]!.amount);
    // One floor of it costs no more than the whole.
    const floor = tallyOf(p, level.id, level.floors[0]!.id);
    expect(floor.counts.triangles).toBeLessThanOrEqual(t.counts.triangles);
  });

  it('a platform’s limits, with any set by hand', () => {
    expect(limitsOf({ platform: 'mobile' })).toEqual(PLATFORMS.find((x) => x.id === 'mobile')!.limits);
    expect(limitsOf({ platform: 'mobile', limits: { lights: 2 } })).toMatchObject({ lights: 2, shadowLights: 1 });
  });

  it('no budget, no warnings; over one, the preflight names what costs most', () => {
    const { p, level } = vault();
    expect(levelIssues(p).some((i) => i.message.includes('budget'))).toBe(false);
    const fits = updateMap(p, level.id, { budget: { platform: 'pc' } });
    expect(overBudget(fits, level.id)).toEqual([]);
    const tight = updateMap(p, level.id, { budget: { platform: 'mobile', limits: { lights: 1, triangles: 100 } } });
    const over = overBudget(tight, level.id).map((o) => o.metric);
    expect(over).toEqual(expect.arrayContaining(['lights', 'triangles']));
    const issue = levelIssues(tight).find((i) => i.id === level.id && i.message.includes('budget for lights'))!;
    expect(issue.message).toMatch(/over its Mobile budget for lights: \d+ of 1\./);
    expect(issue.export).toMatch(/^Most of it: /);
  });

  it('the handoff carries the budget and the counts, and every engine gets BUDGETS.md', () => {
    const { p, level } = vault();
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    for (const e of engines) expect(planHandoff(setTarget(p, { engine: e })).output!.files.some((f) => f.path.endsWith('BUDGETS.md'))).toBe(false);
    const q = updateMap(p, level.id, { budget: { platform: 'mobile', limits: { lights: 1 } } });
    const b = buildIR(q).levels.find((l) => l.guid === level.id)!.budget!;
    expect(b).toMatchObject({ platform: 'mobile', limits: { lights: 1 } });
    expect(b.over).toContain('lights');
    for (const e of engines) {
      const md = planHandoff(setTarget(q, { engine: e })).output!.files.find((f) => f.path.endsWith('BUDGETS.md'))!.content as string;
      expect(md).toContain('## Sunken Vault');
      expect(md).toMatch(/\| Lights \| \d+ \| 1 \| \*\*over\*\* \|/);
    }
  });
});
