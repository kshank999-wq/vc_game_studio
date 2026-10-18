import { describe, expect, it } from 'vitest';
import { ARENA, arenaIssues, createArenaProject, laneXs, starterArena, type ArenaGame } from '../arena/arena';
import { createArena, deploy, matchup, matchups, opponentMove, runMatch, stepArena, towersDown } from '../arena/sim';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { arenaData } from '../handoff/arena-files';
import type { EngineId } from '../types';

const named = (g: ArenaGame, name: string) => g.units.find((u) => u.name === name)!;

describe('head-to-head arena', () => {
  it('a new arena starts playable, and its path follows its data', () => {
    const p = createModuleProject('arena', 'Dueling Green', 'Rival schools settle it on the green.');
    expect(moduleOf(p)).toMatchObject({ id: 'arena', name: 'Head-to-head arena' });
    expect(p.arena!.concept.premise).toBe('Rival schools settle it on the green.');
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, field: true, units: true, match: true, decks: true, play: false, handoff: false });
  });

  it('says what would stop the game working', () => {
    const g = starterArena();
    expect(arenaIssues(g)).toEqual([]);
    const broken: ArenaGame = { ...g, decks: { blue: [], red: ['gone'] }, units: g.units.map((u, i) => (i === 0 ? { ...u, cost: 99 } : u)) };
    const msgs = arenaIssues(broken).map((i) => i.message);
    expect(msgs.some((m) => m.includes('player’s deck is empty'))).toBe(true);
    expect(msgs.some((m) => m.includes('no longer exists'))).toBe(true);
    expect(msgs.some((m) => m.includes('costs 99'))).toBe(true);
  });

  it('lays out a keep and a guard a lane for each side', () => {
    const g = { ...starterArena(), match: { ...starterArena().match, lanes: 3 } };
    const s = createArena(g);
    expect(laneXs(3)).toHaveLength(3);
    expect(s.towers.filter((t) => t.side === 'blue')).toHaveLength(4);
    expect(s.towers.find((t) => t.id === 'blue-keep')!.y).toBe(ARENA.length - ARENA.keepY);
    expect(s.towers.find((t) => t.id === 'red-keep')!.y).toBe(ARENA.keepY);
  });

  it('playing a card costs energy and keeps to your half; energy builds to its cap', () => {
    const g = starterArena();
    const knight = named(g, 'Knight');
    let s = createArena(g);
    s = deploy(g, s, 'blue', knight.id, 4, 1);
    expect(s.energy.blue).toBe(g.match.energyStart - knight.cost);
    expect(s.fighters[0]!.y).toBeGreaterThan(ARENA.length / 2);
    const broke = deploy(g, s, 'blue', named(g, 'Giant').id, 4, 12);
    expect(broke).toBe(s);
    for (let i = 0; i < 1000; i++) s = stepArena(g, s, 0.1, []);
    expect(s.energy.red).toBe(g.match.energyMax);
    expect(deploy(g, s, 'blue', named(g, 'Archers').id, 4, 12).fighters.filter((f) => f.unitId === named(g, 'Archers').id)).toHaveLength(2);
  });

  it('units walk to the towers and knock them down; a keep down ends it', () => {
    const g = { ...starterArena(), match: { ...starterArena().match, lanes: 1 } };
    let s = createArena(g);
    for (let i = 0; i < 6; i++) s = deploy(g, s, 'blue', named(g, 'Giant').id, ARENA.width / 2, 9, true);
    for (let i = 0; i < 4000 && s.phase === 'running'; i++) s = stepArena(g, s, 0.05, []);
    expect(s).toMatchObject({ phase: 'over', winner: 'blue', reason: 'keep' });
    expect(towersDown(s).red).toBeGreaterThanOrEqual(1);
  });

  it('at time, more towers down wins, else a draw', () => {
    const g = { ...starterArena(), match: { ...starterArena().match, length: 1 } };
    let s = createArena(g);
    s = { ...s, towers: s.towers.map((t) => (t.id === 'red-0' ? { ...t, hp: 0 } : t)) };
    for (let i = 0; i < 30; i++) s = stepArena(g, s, 0.05, []);
    expect(s).toMatchObject({ phase: 'over', winner: 'blue', reason: 'towers' });
    let even = createArena(g);
    for (let i = 0; i < 30; i++) even = stepArena(g, even, 0.05, []);
    expect(even).toMatchObject({ winner: 'draw', reason: 'time' });
  });

  it('the opponent defends against units on its half, and otherwise attacks the weakest guard', () => {
    const g = starterArena();
    let s = { ...createArena(g), energy: { blue: 10, red: 10 } };
    s = deploy(g, s, 'blue', named(g, 'Knight').id, 2, 9);
    s = { ...s, fighters: s.fighters.map((f) => ({ ...f, y: 5 })) };
    const d = opponentMove(g, s, 'red');
    const played = d.fighters.filter((f) => f.side === 'red');
    expect(played.length).toBeGreaterThan(0);
    expect(played[0]!.y).toBeLessThan(5);
    expect(d.next.red).toBe(1);
    const calm = { ...createArena(g), energy: { blue: 10, red: 10 }, towers: createArena(g).towers.map((t) => (t.id === 'blue-1' ? { ...t, hp: 10 } : t)) };
    const a = opponentMove(g, calm, 'red');
    expect(a.fighters[0]!.x).toBeCloseTo(laneXs(g.match.lanes)[1]!);
  });

  it('matchups come out the same both ways, and a unit against itself is even', () => {
    const g = starterArena();
    const archers = named(g, 'Archers');
    const bats = named(g, 'Bats');
    const ab = matchup(g, archers, bats);
    const ba = matchup(g, bats, archers);
    expect(ab.winner).toBe('a');
    expect(ba.winner).toBe('b');
    expect(matchup(g, archers, archers).winner).toBe('draw');
    // A unit that goes only for towers, unopposed by a unit that can't hit it, walks through.
    const giant = named(g, 'Giant');
    expect(matchup(g, giant, named(g, 'Bomber'))).toMatchObject({ winner: 'a', how: 'through' });
    const table = matchups(g);
    expect(table).toHaveLength(g.units.length);
    expect(table.every((row) => row.length === g.units.length)).toBe(true);
  });

  it('two decks played by the studio come to a result, the same every time', () => {
    const g = starterArena();
    const r = runMatch(g);
    expect(['blue', 'red', 'draw']).toContain(r.winner);
    expect(runMatch(g)).toEqual(r);
  });

  it('steps without changing the state it was given', () => {
    const g = starterArena();
    let s0 = deploy(g, createArena(g), 'blue', named(g, 'Knight').id, 3, 10);
    s0 = deploy(g, s0, 'red', named(g, 'Knight').id, 3, 6, true);
    const frozen = JSON.stringify(s0);
    stepArena(g, s0, 0.5, ['red']);
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('every engine gets arena.json and ARENA.md for an arena, and nothing else does', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createArenaProject('Dueling Green', 'Rival schools.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('arena.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-arena', version: 1, field: { width: 9, length: 16 } });
      expect(plan.output!.files.find((f) => f.path.endsWith('ARENA.md'))!.content).toContain('# Head-to-head arena');
      expect(plan.output!.files.some((f) => f.path.endsWith('shooter.json') || f.path.endsWith('defense.json'))).toBe(false);
      expect(plan.rows.some((r) => r.id === 'arena')).toBe(true);
    }
    const d = arenaData(p.arena!);
    expect(d.decks.player).toEqual(['knight', 'archers', 'giant', 'bats', 'bomber']);
    expect(d.units.find((u) => u.key === 'giant')!.buildings_only).toBe(true);
  });
});
