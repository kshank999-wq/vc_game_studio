import { describe, expect, it } from 'vitest';
import { createDefenseProject, defenseIssues, pathClick, resizeMap, spotClick, starterDefense, statsAt, costTo, updateDefense, type DefenseGame } from '../defense/defense';
import { createSim, runDefense, stepSim, waveSheet } from '../defense/sim';
import { moduleOf, nextStep, pathOf, tickStep } from '../modules';
import { createProject } from '../project';
import { planHandoff, setTarget } from '../handoff';
import { defenseData } from '../handoff/defense-files';
import type { EngineId } from '../types';

const rich = (g: DefenseGame): DefenseGame => ({ ...g, economy: { ...g.economy, startGold: 5000 }, layout: g.map.spots.map((_, i) => ({ spot: i, towerId: g.towers[i % g.towers.length]!.id, level: 1 })) });

describe('game modules', () => {
  it('a project is a story game unless it says otherwise', () => {
    const p = createProject('Test');
    expect(moduleOf(p).id).toBe('story');
    expect(moduleOf(p).workspaces).toContain('graph');
    expect(moduleOf(createDefenseProject('Keep')).id).toBe('defense');
    expect(moduleOf(createDefenseProject('Keep')).workspaces).toEqual(['graph', 'bible', 'notes', 'engine']);
  });

  it('the path ticks what the project shows done, and what is ticked by hand', () => {
    let p = createProject('Test');
    const before = pathOf(p);
    expect(before.map((s) => s.step.id)).toEqual(['setup', 'spine', 'characters', 'scenes', 'levels', 'play', 'refine', 'handoff']);
    expect(nextStep(p)?.id).toBe('setup');
    p = { ...p, setup: { kind: 'linear', premise: 'A keeper must hold the light.', progression: 'acts', units: 3, resources: [] } };
    expect(pathOf(p)[0]!.done).toBe(true);
    p = tickStep(p, 'play', true);
    const play = pathOf(p).find((s) => s.step.id === 'play')!;
    expect(play).toMatchObject({ done: true, manual: true });
    p = tickStep(p, 'play', false);
    expect(pathOf(p).find((s) => s.step.id === 'play')!.done).toBe(false);
  });

  it('a new castle defense game starts playable, and its path follows its data', () => {
    const p = createDefenseProject('Keep', 'Hold the keep through the night.');
    expect(p.defense!.concept.premise).toBe('Hold the keep through the night.');
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toMatchObject({ concept: true, map: true, towers: true, enemies: true, waves: true, economy: true, handoff: false });
    // The starter's test layout of two towers doesn't hold: balancing is the designer's.
    expect(done.play).toBe(false);
    const won = updateDefense(p, rich);
    expect(pathOf(won).find((s) => s.step.id === 'play')!.done).toBe(true);
  });
});

describe('castle defense', () => {
  it('lays the path cell by cell, takes its end back, and keeps spots off it', () => {
    let m = { cols: 6, rows: 4, path: [], spots: [[1, 1]] } as DefenseGame['map'];
    m = pathClick(m, [0, 1]);
    m = pathClick(m, [1, 1]);
    m = pathClick(m, [2, 1]);
    expect(m.path).toEqual([[0, 1], [1, 1], [2, 1]]);
    expect(m.spots).toEqual([]);
    m = pathClick(m, [2, 1]);
    expect(m.path).toEqual([[0, 1], [1, 1]]);
    m = pathClick(m, [5, 3]);
    expect(m.path).toEqual([[5, 3]]);
    m = spotClick(m, [5, 3]);
    expect(m.spots).toEqual([]);
    m = spotClick(m, [2, 2]);
    expect(m.spots).toEqual([[2, 2]]);
    m = spotClick(m, [2, 2]);
    expect(m.spots).toEqual([]);
  });

  it('a smaller map keeps what fits and cuts the path where it leaves', () => {
    const g = starterDefense();
    const m = resizeMap(g.map, 7, 7);
    expect(m.cols).toBe(7);
    expect(m.path.every(([c]) => c < 7)).toBe(true);
    expect(m.path.length).toBeLessThan(g.map.path.length);
    expect(m.spots.every(([c]) => c < 7)).toBe(true);
  });

  it('upgrades cost and change stats a level at a time', () => {
    const t = starterDefense().towers[0]!;
    expect(statsAt(t, 1).damage).toBe(t.damage);
    expect(statsAt(t, 2).damage).toBe(t.upgrades[0]!.damage);
    expect(costTo(t, 3)).toBe(t.cost + t.upgrades[0]!.cost + t.upgrades[1]!.cost);
  });

  it('says what would stop the game working', () => {
    const g = starterDefense();
    expect(defenseIssues(g)).toEqual([]);
    const broken: DefenseGame = { ...g, map: { ...g.map, path: [[0, 0], [3, 3]] }, towers: g.towers.map((t) => ({ ...t, hitsAir: false })), economy: { ...g.economy, startGold: 10 } };
    const msgs = defenseIssues(broken).map((i) => i.message);
    expect(msgs.some((m) => m.includes('path jumps'))).toBe(true);
    expect(msgs.some((m) => m.includes('fly, but no tower can hit them'))).toBe(true);
    expect(msgs.some((m) => m.includes('more than the 10'))).toBe(true);
  });

  it('runs the waves: towers kill, kills pay, leaks cost lives, and the same game runs the same', () => {
    const g = starterDefense();
    const weak = runDefense(g);
    expect(weak.outcome).toBe('lost');
    expect(weak.stats[0]!.spawned).toBe(8);
    expect(weak.stats.some((s) => s.leaked > 0)).toBe(true);
    expect(runDefense(g)).toEqual(weak);
    const strong = runDefense(rich(g));
    expect(strong).toMatchObject({ outcome: 'won', cleared: g.waves.length, lives: g.economy.lives });
    expect(strong.stats.every((s) => s.leaked === 0 && s.killed === s.spawned)).toBe(true);
    // No towers: everything leaks.
    expect(runDefense({ ...g, layout: [] }).stats[0]!.killed).toBe(0);
  });

  it('builds a layout as the gold comes in, and skips flyers for towers that can’t hit them', () => {
    const g = starterDefense();
    const cannon = g.towers[1]!;
    const many = g.map.spots.map((_, i) => ({ spot: i, towerId: cannon.id, level: 1 }));
    const s = createSim(g, many);
    expect(s.towers).toHaveLength(Math.floor(g.economy.startGold / cannon.cost));
    expect(s.unbuilt).toBe(many.length - s.towers.length);
    // Only cannons (no air), and only bats: none dies.
    const bats: DefenseGame = { ...rich(g), layout: many, waves: [{ id: 'w', bonus: 0, groups: [{ enemyId: g.enemies[2]!.id, count: 3, gap: 1, delay: 0 }] }] };
    const r = runDefense(bats);
    expect(r.stats[0]).toMatchObject({ spawned: 3, killed: 0, leaked: 3 });
  });

  it('steps without changing the state it was given', () => {
    const g = starterDefense();
    const s0 = createSim(g);
    const frozen = JSON.stringify(s0);
    stepSim(g, s0, 1);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('sums each wave on paper', () => {
    const g = starterDefense();
    const sheet = waveSheet(g);
    expect(sheet).toHaveLength(g.waves.length);
    expect(sheet[0]).toMatchObject({ wave: 1, count: 8, health: 8 * g.enemies[0]!.health });
    expect(sheet[sheet.length - 1]!.goldAfter).toBeGreaterThan(g.economy.startGold);
  });

  it('every engine gets defense.json and DEFENSE.md for a castle defense game, and a story game none', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const story = createProject('Story');
    for (const e of engines) expect(planHandoff(setTarget(story, { engine: e })).output!.files.some((f) => f.path.endsWith('defense.json'))).toBe(false);
    const p = createDefenseProject('Keep', 'Hold the keep.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('defense.json'))!;
      const doc = plan.output!.files.find((f) => f.path.endsWith('DEFENSE.md'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-defense', version: 1, map: { cols: 12, rows: 7 } });
      expect(doc.content).toContain('# Castle defense');
      expect(doc.content).toContain('max(1, damage − armor)');
      expect(plan.rows.some((r) => r.id === 'defense')).toBe(true);
    }
    const d = defenseData(p.defense!);
    expect(d.waves[0]!.groups[0]!.enemy).toBe('goblin');
    expect(d.towers[0]!.levels).toHaveLength(3);
  });
});
