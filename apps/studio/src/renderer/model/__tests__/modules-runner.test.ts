import { describe, expect, it } from 'vitest';
import { cellAt, chunkLength, createRunnerProject, paintChunk, resizeChunk, runnerIssues, speedAt, speedRange, starterRunner, type Chunk } from '../runner/runner';
import { botRun, buildTrack, chunkReport, endlessTrack, passable, plan, runReport, startRun, stepRun, wayThrough } from '../runner/sim';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { runnerData } from '../handoff/runner-files';
import type { EngineId } from '../types';

const named = (name: string) => starterRunner().chunks.find((c) => c.name === name)!;
const lone = (c: Chunk, speed: number) => buildTrack([{ chunk: null, length: 6, speed, index: -1 }, { chunk: c, speed, index: 0 }, { chunk: null, length: 6, speed, index: -1 }]);

describe('runner', () => {
  it('a new runner starts playable, and its path follows its data', () => {
    const p = createModuleProject('runner', 'Rooftop Fox', 'A courier fox races the storm.');
    expect(moduleOf(p)).toMatchObject({ id: 'runner', name: 'Runner' });
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, runner: true, chunks: true, mix: false, play: false, handoff: false });
    expect(runnerIssues(p.runner!)).toEqual([]);
  });

  it('reads, paints and resizes chunks', () => {
    let c = named('Hop');
    expect(chunkLength(c)).toBe(16);
    expect(cellAt(c, 8, 0)).toBe('solid');
    expect(cellAt(c, 7, 2)).toBe('coin');
    c = paintChunk(c, 3, -1, 'pit');
    expect(cellAt(c, 3, -1)).toBe('empty');
    c = paintChunk(c, 3, 1, 'solid');
    expect(cellAt(c, 3, 1)).toBe('solid');
    c = resizeChunk(c, 10);
    expect(chunkLength(c)).toBe(10);
    expect(c.rows.every((r) => r.length === 10)).toBe(true);
  });

  it('speeds up with distance to the top speed, and each tier comes in faster', () => {
    const r = starterRunner().rules;
    expect(speedAt(r.physics, 0)).toBe(r.physics.startSpeed);
    expect(speedAt(r.physics, 400)).toBe(r.physics.startSpeed + r.physics.speedUp * 4);
    expect(speedAt(r.physics, 100_000)).toBe(r.physics.maxSpeed);
    expect(speedRange(r, 3)[0]).toBeGreaterThan(speedRange(r, 1)[0]);
  });

  it('runs into a block, falls into a pit, and gets through when it jumps or slides', () => {
    const r = starterRunner().rules;
    const hop = lone(named('Hop'), 7);
    let s = startRun();
    while (s.alive && !s.end) s = stepRun(r, hop, s, 'none');
    expect(s).toMatchObject({ alive: false, end: 'hit' });
    const gap = lone(named('Gap'), 7);
    s = startRun();
    while (s.alive && !s.end) s = stepRun(r, gap, s, 'none');
    expect(s).toMatchObject({ alive: false, end: 'fell' });
    const duck = lone(named('Duck'), 7);
    const way = plan(r, duck, startRun(), duck.length - 3)!;
    expect(way.filter((a) => a === 'slide')).toHaveLength(1);
    s = startRun();
    for (const a of way) s = stepRun(r, duck, s, a);
    expect(s.alive).toBe(true);
    expect(s.coins).toBeGreaterThan(0);
  });

  it('knows a chunk that can’t be got through', () => {
    const r = starterRunner().rules;
    const tall = { ...named('Hop'), rows: ['........#.......', '........#.......', '........#.......', '........#.......'] };
    expect(passable(r, tall, 7)).toBe(false);
    const wide = { ...named('Gap'), ground: '___.........____' };
    expect(passable(r, wide, 7)).toBe(false);
    for (const c of starterRunner().chunks) for (const v of speedRange(r, c.tier)) expect(passable(r, c, v)).toBe(true);
    expect(wayThrough(r, named('Hop'), 7)!.length).toBeGreaterThan(5);
  });

  it('the studio’s runner gets through easy chunks every time, and slips on tight ones', () => {
    const g = starterRunner();
    expect(chunkReport(g, named('Hop'))).toMatchObject({ slow: true, fast: true, slowRate: 1, fastRate: 1 });
    const loose = { ...g, rules: { ...g.rules, timingMs: 0 } };
    expect(botRun(loose.rules, lone(named('Stairs'), g.rules.physics.maxSpeed), 1).end).toBe('finished');
    // A pit six units wide at the start speed: a jump only just clears it, and timing slips show.
    const wide = { ...named('Gap'), ground: '_____......_____' };
    const r = chunkReport(g, wide);
    expect(r.slow).toBe(true);
    expect(r.slowRate).toBeGreaterThan(0);
    expect(r.slowRate).toBeLessThan(1);
  });

  it('endless runs follow the tiers, never the same chunk twice running, and end somewhere', () => {
    const g = starterRunner();
    const t = endlessTrack(g, 9, 1200);
    const order: number[] = [];
    for (let x = 0; x < t.length; x++) if (t.from[x]! >= 0 && t.from[x] !== t.from[x - 1]) order.push(t.from[x]!);
    expect(order.slice(0, 5).every((i) => g.chunks[i]!.tier === 1)).toBe(true);
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1]);
    const rep = runReport(g, 6, 1200);
    expect(rep.distances).toHaveLength(6);
    expect(rep.median).toBeGreaterThan(200);
    expect(runReport(g, 6, 1200)).toEqual(rep);
  });

  it('every engine gets runner.json and RUNNER.md for a runner, and nothing else does', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createRunnerProject('Rooftop Fox', 'A courier fox.');
    for (const e of engines) {
      const plan2 = planHandoff(setTarget(p, { engine: e }));
      const data = plan2.output!.files.find((f) => f.path.endsWith('runner.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-runner', version: 1, physics: { start_speed: 7 } });
      expect(plan2.output!.files.find((f) => f.path.endsWith('RUNNER.md'))!.content).toContain('# Runner');
      expect(plan2.output!.files.some((f) => /(match3|puzzles|cards|arena|shooter|defense)\.json$/.test(f.path))).toBe(false);
      expect(plan2.rows.some((r) => r.id === 'runner')).toBe(true);
    }
    const d = runnerData(p.runner!);
    expect(d.chunks.every((c) => c.checked.passable)).toBe(true);
    expect(d.chunks[0]).toMatchObject({ name: 'Hop', tier: 1, length: 16 });
  });
});
