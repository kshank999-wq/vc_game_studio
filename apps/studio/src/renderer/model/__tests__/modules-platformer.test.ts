import { describe, expect, it } from 'vitest';
import { createPlatformProject, gridRows, paintTile, parseGrid, platformIssues, resizeGrid, starterPlatformer } from '../platformer/platformer';
import { NONE, carefulRun, createWorld, mapLevel, stepHero, stepWorld, type Input, type World } from '../platformer/sim';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { platformerData } from '../handoff/platformer-files';
import type { EngineId } from '../types';

const rules = starterPlatformer().rules;
const run = (rows: string[], input: (w: World) => Input, frames = 600) => {
  const g = parseGrid(rows);
  let w = createWorld(g);
  for (let i = 0; i < frames && w.phase === 'playing'; i++) w = stepWorld(rules, g, w, input(w));
  return w;
};
const RIGHT: Input = { left: false, right: true, jump: false };

describe('platformer', () => {
  it('a new platformer starts playable, and its path follows its data', () => {
    const p = createModuleProject('platformer', 'Moss Knight', 'A small knight climbs the tower.');
    expect(moduleOf(p)).toMatchObject({ id: 'platformer', name: 'Platformer' });
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, hero: true, levels: true, flow: false, play: false, handoff: false });
    for (const l of p.platformer!.levels) expect(platformIssues(l)).toEqual([]);
  });

  it('reads, paints and resizes levels, with one start and one goal', () => {
    let g = parseGrid(['.S..', '####']);
    expect(g).toMatchObject({ cols: 4, rows: 2 });
    g = paintTile(g, 3, 'S');
    expect(gridRows(g)).toEqual(['...S', '####']);
    expect(platformIssues({ id: 'x', name: 'x', rows: gridRows(g), par: 0 })).toHaveLength(1);
    g = paintTile(g, 0, 'G');
    expect(platformIssues({ id: 'x', name: 'x', rows: gridRows(g), par: 0 })).toEqual([]);
    const big = resizeGrid(g, 12, 8);
    expect(big).toMatchObject({ cols: 12, rows: 8 });
    // The ground stays at the bottom.
    expect(gridRows(big)[7]!.startsWith('####')).toBe(true);
  });

  it('lands on ground, falls into pits, dies on spikes, and jumps up through one-way platforms', () => {
    const g = parseGrid(['.....', '.S...', '#####']);
    let h = createWorld(g).hero;
    for (let i = 0; i < 30; i++) h = stepHero(rules, g, h, NONE).hero;
    expect(h.grounded).toBe(true);
    expect(run(['.S......', '###..###', '###..###'], () => RIGHT, 300)).toMatchObject({ phase: 'dead', cause: 'fell' });
    expect(run(['.S......G', '####^^###'], () => RIGHT, 300)).toMatchObject({ phase: 'dead', cause: 'spikes' });
    // Jump straight up under a one-way platform and come to rest on top of it.
    const up = parseGrid(['.....', '.....', '.....', '.===.', '.S...', '#####']);
    let w = createWorld(up);
    for (let i = 0; i < 20; i++) w = stepWorld(rules, up, w, NONE);
    for (let i = 0; i < 90; i++) w = stepWorld(rules, up, w, { ...NONE, jump: i === 0 });
    expect(w.hero.grounded).toBe(true);
    expect(w.hero.y).toBeLessThan(3);
  });

  it('stomps an enemy from above and is caught by one walking into it', () => {
    const caught = run(['............', '.S......e...', '############'], () => RIGHT, 300);
    expect(caught).toMatchObject({ phase: 'dead', cause: 'enemy' });
    const g = parseGrid(['............', '............', '.S......e...', '############']);
    let w = createWorld(g);
    let best: World | null = null;
    // Some jump timing lands on it.
    for (let t = 0; t < 60 && !best; t++) {
      w = createWorld(g);
      for (let i = 0; i < 300 && w.phase === 'playing' && !w.stomped; i++) w = stepWorld(rules, g, w, { ...RIGHT, jump: i === t });
      if (w.stomped) best = w;
    }
    expect(best?.stomped).toBe(1);
  });

  it('maps a level: the starters reach the goal with every coin, and a tall wall stops it', () => {
    for (const l of starterPlatformer().levels) {
      const m = mapLevel(rules, l);
      expect(m).toMatchObject({ status: 'ready', reachable: true, missedCoins: [] });
      expect(m.reachableCoins).toBe(m.coins);
      expect(m.jumps).toBeGreaterThan(0);
      expect(m.route.length).toBeGreaterThan(0);
    }
    const wall = ['.......#....', '.......#....', '.......#....', '.......#....', '.S.....#..G.', '############'];
    const m = mapLevel(rules, { rows: wall });
    expect(m.reachable).toBe(false);
    expect(m.stand.length).toBeGreaterThan(0);
    expect(mapLevel(rules, { rows: ['....', '####'] }).status).toBe('not ready');
  });

  it('knows a coin out of reach', () => {
    const rows = ['.....o......', '............', '............', '............', '............', '.S........G.', '############'];
    const m = mapLevel(rules, { rows });
    expect(m.reachable).toBe(true);
    expect(m.missedCoins).toEqual([5]);
  });

  it('the careful player finishes every starter level, and the same way every time', () => {
    for (const l of starterPlatformer().levels) {
      const c = carefulRun(rules, l);
      expect(c.finished).toBe(true);
      expect(c.seconds).toBeGreaterThan(0);
      // Its inputs replay to the goal.
      const g = parseGrid(l.rows);
      let w = createWorld(g);
      for (const input of c.inputs) if (w.phase === 'playing') w = stepWorld(rules, g, w, input);
      expect(w.phase).toBe('won');
    }
  });

  it('every engine gets platformer.json and PLATFORMER.md for a platformer, and nothing else does', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createPlatformProject('Moss Knight', 'A small knight.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('platformer.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-platformer', version: 1 });
      expect(plan.output!.files.find((f) => f.path.endsWith('PLATFORMER.md'))!.content).toContain('# Platformer');
      expect(plan.output!.files.some((f) => /(runner|match3|puzzles|cards|arena|shooter|defense)\.json$/.test(f.path))).toBe(false);
      expect(plan.rows.some((r) => r.id === 'platformer')).toBe(true);
    }
    const d = platformerData(p.platformer!);
    expect(d.levels).toHaveLength(3);
    expect(d.levels.every((l) => l.checked.goal_reachable)).toBe(true);
  });
});
