import { describe, expect, it } from 'vitest';
import { createBlockProject, levelIssues, levelRows, paintCell, parseLevel, resizeBoard, starterBlocks } from '../blocks/blocks';
import { difficulty, liveCells, replay, solveBoard, solveLevel, solved, startState, stars, step } from '../blocks/solver';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { blockData } from '../handoff/block-files';
import type { EngineId } from '../types';

describe('puzzle game', () => {
  it('a new puzzle game starts with levels that solve, and its path follows its data', () => {
    const p = createModuleProject('blocks', 'Tidy Bot', 'A robot tidies a warehouse.');
    expect(moduleOf(p)).toMatchObject({ id: 'blocks', name: 'Puzzle game' });
    expect(p.blocks!.concept.premise).toBe('A robot tidies a warehouse.');
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, rules: true, levels: true, order: true, play: false, handoff: false });
  });

  it('reads and writes the standard text format', () => {
    const rows = ['#####', '#@$.#', '# * #', '#+  #', '#####'];
    const b = parseLevel(rows);
    expect(b).toMatchObject({ cols: 5, rows: 5 });
    expect(b.crates).toEqual([7, 12]);
    expect(b.tiles[8]).toBe('target');
    // Two players in the text: the last one wins.
    expect(b.player).toBe(16);
    expect(levelRows(b)).toEqual(['#####', '# $.#', '# * #', '#+  #', '#####']);
  });

  it('paints cells and resizes, keeping what fits', () => {
    let b = parseLevel(['#####', '#@$.#', '#####']);
    b = paintCell(b, 7, 'crate');
    expect(b.crates).toEqual([]);
    b = paintCell(b, 7, 'crate');
    expect(b.crates).toEqual([7]);
    b = paintCell(b, 6, 'wall');
    expect(b.player).toBe(-1);
    const r = resizeBoard(b, 4, 4);
    expect(r).toMatchObject({ cols: 4, rows: 4 });
    expect(r.tiles.slice(12)).toEqual(['wall', 'wall', 'wall', 'wall']);
  });

  it('says what a level needs before it can be played', () => {
    const msgs = levelIssues(parseLevel(['    ', ' $$.', '    '])).map((i) => i.message);
    expect(msgs).toContain('There is no player start.');
    expect(msgs.some((m) => m.includes('2 crates for 1 targets'))).toBe(true);
    expect(levelIssues(parseLevel([' @$.'])).some((i) => i.message.includes('edge'))).toBe(true);
  });

  it('pushes one crate at a time, never into a wall or another crate, never pulled', () => {
    const b = parseLevel(['#######', '#@$$ .#', '#######']);
    let s = startState(b);
    expect(step(b, s, 'r')).toBeNull();
    expect(step(b, s, 'u')).toBeNull();
    const one = parseLevel(['######', '#@$ .#', '######']);
    s = step(one, startState(one), 'r')!;
    expect(s).toMatchObject({ player: 8, crates: [9], moves: 1, pushes: 1, path: 'R' });
    s = step(one, step(one, s, 'r')!, 'l')!;
    expect(s.crates).toEqual([10]);
    expect(solved(one, s)).toBe(true);
  });

  it('solves in the fewest moves, and the solution replays', () => {
    for (const l of starterBlocks().levels) {
      const sol = solveLevel(l);
      expect(sol.status).toBe('solved');
      const b = parseLevel(l.rows);
      expect(solved(b, replay(b, sol.path)!)).toBe(true);
    }
    expect(solveLevel(starterBlocks().levels[0]!)).toMatchObject({ moves: 3, pushes: 2, path: 'rRR' });
  });

  it('knows a level that can’t be done, and a crate stuck in a corner', () => {
    const corner = parseLevel(['#####', '#$  #', '# @.#', '#####']);
    expect(liveCells(corner).has(6)).toBe(false);
    expect(solveBoard(corner).status).toBe('unsolvable');
    const walled = parseLevel(['#######', '#@ $#.#', '#######']);
    expect(solveBoard(walled).status).toBe('unsolvable');
    expect(solveBoard(parseLevel(['###', '#@#', '###'])).status).toBe('not ready');
    const big = parseLevel(['############', '#@         #', '# $ $ $ $  #', '#          #', '# . . . .  #', '############']);
    expect(solveBoard(big, 500).status).toBe('too big');
  });

  it('rates difficulty and gives stars against par', () => {
    const [first, , , , last] = starterBlocks().levels;
    expect(difficulty(solveLevel(first!))).toBe(1);
    expect(difficulty(solveLevel(last!))).toBeGreaterThan(difficulty(solveLevel(first!)));
    expect(stars(10, 10, 0.5)).toBe(3);
    expect(stars(15, 10, 0.5)).toBe(2);
    expect(stars(16, 10, 0.5)).toBe(1);
  });

  it('every engine gets puzzles.json, with solutions, and PUZZLES.md', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createBlockProject('Tidy Bot', 'A robot tidies.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('puzzles.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-puzzles', version: 1 });
      expect(plan.output!.files.find((f) => f.path.endsWith('PUZZLES.md'))!.content).toContain('# Puzzle game');
      expect(plan.output!.files.some((f) => /(cards|arena|shooter|defense)\.json$/.test(f.path))).toBe(false);
      expect(plan.rows.some((r) => r.id === 'blocks')).toBe(true);
    }
    const d = blockData(p.blocks!);
    expect(d.levels[0]).toMatchObject({ number: 1, solution: 'rRR', best_moves: 3, par: 3, difficulty: 1 });
  });
});
