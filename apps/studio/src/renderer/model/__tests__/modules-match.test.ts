import { describe, expect, it } from 'vitest';
import { createMatchProject, levelIssues, paintShape, parseShape, shapeRows, starterMatch, type MatchGame, type MatchLevel } from '../match/match';
import { canSwap, createMatch, goalMet, levelReport, moves, movesFor, runLevel, swap, type MatchState } from '../match/sim';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { matchData } from '../handoff/match-files';
import type { EngineId } from '../types';

/** A board set by hand: rows of colour digits, . for no gem. */
const rig = (g: MatchGame, l: MatchLevel, rows: string[]): MatchState => {
  const s = createMatch(g, { ...l, rows: rows.map((r) => r.replace(/[0-9]/g, '.')) });
  return { ...s, gems: rows.join('').split('').map((ch) => (ch === '.' ? null : { c: Number(ch), s: 0 as const })) };
};

describe('match-3', () => {
  it('a new match-3 game starts playable, and its path follows its data', () => {
    const p = createModuleProject('match', 'Crown Jewels', 'Sort the treasury.');
    expect(moduleOf(p)).toMatchObject({ id: 'match', name: 'Match-3' });
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, rules: true, levels: true, balance: false, play: false, handoff: false });
  });

  it('reads and paints board shapes', () => {
    let s = parseShape(['..#', 'j..']);
    expect(s).toMatchObject({ cols: 3, rows: 2 });
    expect(s.cell).toEqual([true, true, false, true, true, true]);
    expect(s.jelly[3]).toBe(true);
    s = paintShape(s, 2, 'jelly');
    expect(shapeRows(s)).toEqual(['..j', 'j..']);
  });

  it('says what would stop a level working', () => {
    const g = starterMatch();
    expect(g.levels.flatMap((l) => levelIssues(g, l))).toEqual([]);
    const l = { ...g.levels[0]!, rows: ['....', '....'], goal: { kind: 'jelly' as const, amount: 0, color: 0 } };
    const msgs = levelIssues(g, l).map((i) => i.message);
    expect(msgs).toContain('The board needs at least 12 cells.');
    expect(msgs.some((m) => m.includes('needs jelly'))).toBe(true);
  });

  it('fills a fresh board with no line of three and at least one move', () => {
    const g = starterMatch();
    for (const l of g.levels) {
      for (let seed = 1; seed < 6; seed++) {
        const s = createMatch(g, l, seed);
        expect(s.gems.every((gm, i) => !!gm === s.shape.cell[i])).toBe(true);
        expect(moves(s).length).toBeGreaterThan(0);
      }
    }
  });

  it('a swap only counts if it lines up three; matched gems clear, fall and refill', () => {
    const g = starterMatch();
    const l = { ...g.levels[0]!, colors: 5 };
    // Row 0 is 1 1 2 1: swapping the last two lines up three 1s.
    const w = rig(g, l, ['1121', '3343', '4214', '2032']);
    expect(canSwap(w, 0, 1)).toBe(false);
    expect(canSwap(w, 2, 3)).toBe(true);
    const after = swap(g, l, w, 2, 3);
    expect(after.moves).toBe(l.moves - 1);
    expect(after.cleared).toEqual(expect.arrayContaining([0, 1, 2]));
    expect(after.score).toBeGreaterThanOrEqual(3 * g.rules.points);
    expect(after.collected[1]).toBeGreaterThanOrEqual(3);
    expect(after.gems.every((gm) => !!gm)).toBe(true);
    expect(swap(g, l, w, 0, 1)).toBe(w);
  });

  it('four in a line leaves a line gem, five a bomb; a line gem clears its column', () => {
    const g = starterMatch();
    const l = { ...g.levels[0]!, colors: 5 };
    const base = ['23043', '34123', '41234', '12341'];
    // Row 0 is 0 0 1 0 2 with a 0 under the 1: swapping them makes four 0s.
    const four = swap(g, l, rig(g, l, ['00102', ...base]), 2, 7);
    expect(four.cleared).toEqual(expect.arrayContaining([0, 1, 3]));
    expect(four.gems[2]).toMatchObject({ c: 0, s: 1 });
    const five = swap(g, l, rig(g, l, ['00100', ...base]), 2, 7);
    expect(five.cleared).toEqual(expect.arrayContaining([0, 1, 3, 4]));
    expect(five.gems[2]).toMatchObject({ c: 0, s: 3 });
    // A down line gem at the top left, matched in row 0, clears the whole first column.
    const lined = rig(g, l, ['1121', '3343', '4214', '2032']);
    lined.gems[0] = { c: 1, s: 2 };
    const fired = swap(g, l, lined, 2, 3);
    expect(fired.cleared).toEqual(expect.arrayContaining([0, 4, 8, 12]));
  });

  it('no specials when the rules turn them off', () => {
    const g = { ...starterMatch(), rules: { ...starterMatch().rules, specials: false } };
    const l = { ...g.levels[0]!, colors: 5 };
    const s = swap(g, l, rig(g, l, ['00102', '23043', '34123', '41234', '12341']), 2, 7);
    expect(s.cleared).toEqual(expect.arrayContaining([0, 1, 2, 3]));
    expect(s.gems.every((gm) => !gm || gm.s === 0)).toBe(true);
  });

  it('the goal is met for a score, a colour collected, or the jelly cleared', () => {
    const g = starterMatch();
    const [score, collect, jelly] = g.levels;
    const s = createMatch(g, score!, 3);
    expect(goalMet(score!, { ...s, score: score!.goal.amount })).toBe(true);
    expect(goalMet(collect!, { ...s, collected: s.collected.map((n, i) => (i === collect!.goal.color ? collect!.goal.amount : n)) })).toBe(true);
    const j = createMatch(g, jelly!, 3);
    expect(goalMet(jelly!, j)).toBe(false);
    expect(goalMet(jelly!, { ...j, jelly: j.jelly.map(() => false) })).toBe(true);
  });

  it('the studio plays levels through, the same every time, and sums them up', () => {
    const g = starterMatch();
    const l = g.levels[0]!;
    const r = runLevel(g, l, 4);
    expect(r.needed).not.toBeNull();
    expect(runLevel(g, l, 4)).toEqual(r);
    const rep = levelReport(g, l, 10);
    expect(rep.runs).toBe(10);
    expect(rep.curve[rep.curve.length - 1]).toBe(rep.finished);
    const m = movesFor(rep, 0.5)!;
    expect(rep.curve[m]).toBeGreaterThanOrEqual(0.5);
    expect(m === 0 || rep.curve[m - 1]! < 0.5).toBe(true);
  });

  it('every engine gets match3.json and MATCH3.md for a match-3 game, and nothing else does', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createMatchProject('Crown Jewels', 'Sort the treasury.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('match3.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-match3', version: 1 });
      expect(plan.output!.files.find((f) => f.path.endsWith('MATCH3.md'))!.content).toContain('# Match-3');
      expect(plan.output!.files.some((f) => /(puzzles|cards|arena|shooter|defense)\.json$/.test(f.path))).toBe(false);
      expect(plan.rows.some((r) => r.id === 'match')).toBe(true);
    }
    const d = matchData(p.match!);
    expect(d.levels[1]).toMatchObject({ goal: { kind: 'collect', amount: 25, gem: 'Sapphire' }, goal_text: 'Collect 25 Sapphire' });
  });
});
