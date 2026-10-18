import { describe, expect, it } from 'vitest';
import { createShooterProject, shooterIssues, starterShooter, updateShooter, MAX_COLS, type ShooterGame } from '../shooter/shooter';
import { autopilot, createShooterSim, formationSpeed, invaderAt, runShooter, shooterSheet, stepShooter } from '../shooter/sim';
import { moduleOf, pathOf } from '../modules';
import { createModuleProject } from '../module-projects';
import { planHandoff, setTarget } from '../handoff';
import { shooterData } from '../handoff/shooter-files';
import type { EngineId } from '../types';

const still = { left: false, right: false, fire: false };
const one = (g: ShooterGame): ShooterGame => ({ ...g, waves: [{ ...g.waves[0]!, rows: [g.invaders[0]!.id], cols: 1 }] });

describe('arcade shooter', () => {
  it('a new arcade shooter starts playable, and its path follows its data', () => {
    const p = createModuleProject('shooter', 'Last Orbit', 'Hold the line.');
    expect(moduleOf(p)).toMatchObject({ id: 'shooter', name: 'Arcade shooter' });
    expect(p.shooter!.concept.premise).toBe('Hold the line.');
    const done = Object.fromEntries(pathOf(p).map((s) => [s.step.id, s.done]));
    expect(done).toEqual({ concept: true, ship: true, invaders: true, waves: true, shields: true, play: false, handoff: false });
    expect(createModuleProject('defense', 'Keep').module).toBe('defense');
  });

  it('says what would stop the game working', () => {
    const g = starterShooter();
    expect(shooterIssues(g)).toEqual([]);
    const broken: ShooterGame = { ...g, waves: [{ ...g.waves[0]!, cols: MAX_COLS + 1, rows: ['gone'] }], ship: { ...g.ship, lives: 0 } };
    const msgs = shooterIssues(broken).map((i) => i.message);
    expect(msgs.some((m) => m.includes('no longer exists'))).toBe(true);
    expect(msgs.some((m) => m.includes(`room for ${MAX_COLS}`))).toBe(true);
    expect(msgs.some((m) => m.includes('at least one life'))).toBe(true);
  });

  it('the formation sweeps, steps down at a side, and speeds up as it thins', () => {
    const g = starterShooter();
    let s = createShooterSim(g);
    const y0 = invaderAt(g, s, s.invaders[0]!)[1];
    const full = formationSpeed(g, s);
    for (let i = 0; i < 300 && s.dir === 1; i++) s = stepShooter(g, s, 0.05, still);
    expect(s.dir).toBe(-1);
    expect(invaderAt(g, s, s.invaders[0]!)[1]).toBeCloseTo(y0 + g.waves[0]!.drop);
    const thin = { ...s, invaders: s.invaders.slice(0, 1) };
    expect(formationSpeed(g, thin)).toBeGreaterThan(full * 2);
  });

  it('a shot takes a hit off the first invader it meets, and a kill scores', () => {
    const base = one({ ...starterShooter(), shields: { count: 0, health: 1 } });
    // Barely moving, so a shot straight up meets it.
    const g = { ...base, waves: [{ ...base.waves[0]!, speed: 0.01 }] };
    let s = createShooterSim(g);
    s = stepShooter(g, s, 0.01, { left: false, right: false, fire: true });
    expect(s.shots).toHaveLength(1);
    for (let i = 0; i < 200 && s.phase === 'running'; i++) s = stepShooter(g, s, 0.01, still);
    expect(s.phase).toBe('won');
    expect(s.score).toBe(g.invaders[0]!.points + g.waves[0]!.bonus);
    expect(s.stats[0]).toMatchObject({ shots: 1, hits: 1 });
  });

  it('shields soak shots, and a formation that reaches the ship wins for it', () => {
    const g = one(starterShooter());
    // The ship starts in the middle; a shield stands there when there is an odd number.
    const shielded = { ...g, shields: { count: 1, health: 2 } };
    let s = stepShooter(shielded, createShooterSim(shielded), 0.01, { left: false, right: false, fire: true });
    for (let i = 0; i < 100; i++) s = stepShooter(shielded, s, 0.01, still);
    expect(s.shields[0]).toBe(1);
    expect(s.invaders).toHaveLength(1);
    const landing = { ...g, waves: [{ ...g.waves[0]!, drop: 3, speed: 6 }], invaders: g.invaders.map((v) => ({ ...v, fire: 0 })) };
    let l = createShooterSim(landing);
    for (let i = 0; i < 2000 && l.phase === 'running'; i++) l = stepShooter(landing, l, 0.05, still);
    expect(l).toMatchObject({ phase: 'lost', lostBy: 'landed' });
  });

  it('bombs cost a life, and lives run out', () => {
    const g = one({ ...starterShooter(), shields: { count: 0, health: 1 } });
    let s = createShooterSim(g);
    s = { ...s, lives: 1, bombs: [{ x: s.shipX, y: 10.6 }] };
    s = stepShooter(g, s, 0.02, still);
    expect(s).toMatchObject({ phase: 'lost', lostBy: 'shot', lives: 0 });
  });

  it('the same game runs the same; the autopilot plays it through', () => {
    const g = starterShooter();
    const a = runShooter(g, 7);
    expect(runShooter(g, 7)).toEqual(a);
    expect(a.stats[0]!.hits).toBeGreaterThan(0);
    const easy = { ...g, waves: g.waves.slice(0, 1) };
    expect(runShooter(easy).outcome).toBe('won');
    expect(autopilot(g, { ...createShooterSim(g), phase: 'won' })).toEqual(still);
  });

  it('steps without changing the state it was given', () => {
    const g = starterShooter();
    const s0 = createShooterSim(g);
    const frozen = JSON.stringify(s0);
    stepShooter(g, s0, 0.5, { left: true, right: false, fire: true });
    expect(JSON.stringify(s0)).toBe(frozen);
  });

  it('sums each wave on paper', () => {
    const g = starterShooter();
    const sheet = shooterSheet(g);
    expect(sheet).toHaveLength(g.waves.length);
    expect(sheet[0]!.count).toBe(g.waves[0]!.rows.length * g.waves[0]!.cols);
  });

  it('every engine gets shooter.json and SHOOTER.md for an arcade shooter, and nothing else does', () => {
    const engines: EngineId[] = ['godot', 'unity', 'unreal', 'custom'];
    const p = createShooterProject('Last Orbit', 'Hold the line.');
    for (const e of engines) {
      const plan = planHandoff(setTarget(p, { engine: e }));
      const data = plan.output!.files.find((f) => f.path.endsWith('shooter.json'))!;
      expect(JSON.parse(data.content)).toMatchObject({ format: 'vcgs-shooter', version: 1, field: { width: 16, height: 12 } });
      expect(plan.output!.files.find((f) => f.path.endsWith('SHOOTER.md'))!.content).toContain('# Arcade shooter');
      expect(plan.output!.files.some((f) => f.path.endsWith('defense.json'))).toBe(false);
      expect(plan.rows.some((r) => r.id === 'shooter')).toBe(true);
    }
    const d = shooterData(updateShooter(p, (g) => g).shooter!);
    expect(d.waves[0]!.rows[0]).toBe('gunner');
  });
});
