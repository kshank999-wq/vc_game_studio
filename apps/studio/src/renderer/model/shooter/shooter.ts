import type { Project } from '../types';
import { createProject, newId } from '../project';

/**
 * Arcade shooter (game modules): a Space Invaders–style game as data the
 * designer roughs in and refines: the player's ship, the invaders, the waves
 * they come down in (rows of them in formation), the shields, and the
 * scoring. The play preview and the autopilot run it (sim.ts); the handoff
 * sends it to the engine as data.
 */

/** The playfield, in units: 16 wide, 12 high, row 0 at the top. */
export const FIELD = { width: 16, height: 12, shipY: 11, shieldY: 9.4, formationTop: 1.5, colGap: 1.2, rowGap: 0.9 } as const;

export interface Ship {
  /** Units a second. */
  speed: number;
  /** Shots a second at most. */
  fireRate: number;
  /** Units a second. */
  shotSpeed: number;
  lives: number;
}

export interface Invader {
  id: string;
  name: string;
  /** Hits it takes. */
  health: number;
  points: number;
  /** Shots a minute, while it is the lowest in its column. */
  fire: number;
  notes?: string;
}

export interface Wave {
  id: string;
  /** The formation, top row first: which invader fills each row. */
  rows: string[];
  /** Invaders a row. */
  cols: number;
  /** Units a second the formation moves sideways at the start. */
  speed: number;
  /** Units it steps down each time it reaches a side. */
  drop: number;
  /** Times the invaders' own fire rate, for this wave. */
  fireScale: number;
  /** Points for clearing it. */
  bonus: number;
}

export interface Shields {
  count: number;
  /** Hits each takes, from either side, before it is gone. */
  health: number;
}

export interface Rules {
  /** How much faster the formation gets as it thins: 1 is twice as fast when the last one is left. */
  speedUp: number;
  /** Units a second the invaders' shots fall. */
  enemyShotSpeed: number;
  /** A life every so many points. 0: none. */
  extraLifeEvery: number;
  /** Seconds between waves. */
  breather: number;
}

export interface ShooterGame {
  concept: { premise?: string; theme?: string; platform?: 'mobile' | 'pc' | 'console' | 'web'; notes?: string };
  ship: Ship;
  invaders: Invader[];
  waves: Wave[];
  shields: Shields;
  rules: Rules;
}

const invader = (name: string, s: Partial<Invader>): Invader => ({ id: newId('iv'), name, health: 1, points: 10, fire: 3, ...s });

/** A small playable start to sculpt from: three invaders, four waves, four shields. */
export const starterShooter = (): ShooterGame => {
  const drone = invader('Drone', { health: 1, points: 10, fire: 2 });
  const gunner = invader('Gunner', { health: 1, points: 20, fire: 6 });
  const tank = invader('Tank', { health: 3, points: 40, fire: 4 });
  const w = (rows: string[], cols: number, speed: number, drop: number, fireScale: number, bonus: number): Wave => ({ id: newId('wv'), rows, cols, speed, drop, fireScale, bonus });
  return {
    concept: { premise: '', platform: 'mobile' },
    ship: { speed: 7, fireRate: 3, shotSpeed: 14, lives: 3 },
    invaders: [drone, gunner, tank],
    waves: [
      w([gunner.id, drone.id, drone.id], 8, 1, 0.3, 1, 100),
      w([tank.id, gunner.id, drone.id, drone.id], 8, 1.1, 0.3, 1.1, 150),
      w([tank.id, gunner.id, gunner.id, drone.id, drone.id], 9, 1.2, 0.35, 1.3, 200),
      w([tank.id, tank.id, gunner.id, gunner.id, drone.id], 10, 1.3, 0.35, 1.5, 300),
    ],
    shields: { count: 4, health: 8 },
    rules: { speedUp: 1.5, enemyShotSpeed: 5, extraLifeEvery: 1500, breather: 2 },
  };
};

/** A new arcade shooter project: the starter game to sculpt from, with its premise. */
export const createShooterProject = (name: string, premise = ''): Project => {
  const g = starterShooter();
  return { ...createProject(name.trim() || 'Untitled Game'), module: 'shooter', shooter: { ...g, concept: { ...g.concept, premise: premise.trim() } } };
};

/** Change the arcade shooter game; starts one from the starter if there is none. */
export const updateShooter = (project: Project, change: (game: ShooterGame) => ShooterGame): Project => ({ ...project, shooter: change(project.shooter ?? starterShooter()) });

export const newInvader = (): Invader => invader('New invader', {});
export const newWave = (invaderId: string): Wave => ({ id: newId('wv'), rows: invaderId ? [invaderId, invaderId, invaderId] : [], cols: 8, speed: 1.2, drop: 0.45, fireScale: 1, bonus: 100 });

/** The most invaders a row the field has room for. */
export const MAX_COLS = Math.floor((FIELD.width - 1.6) / FIELD.colGap) + 1;
/** The most rows before the formation starts on top of the shields. */
export const MAX_ROWS = Math.floor((FIELD.shieldY - 2 - FIELD.formationTop) / FIELD.rowGap) + 1;

export interface ShooterIssue {
  severity: 'error' | 'warning';
  message: string;
}

/** What would stop the game working, or likely make it no fun. */
export const shooterIssues = (g: ShooterGame): ShooterIssue[] => {
  const out: ShooterIssue[] = [];
  const err = (message: string) => out.push({ severity: 'error', message });
  const warn = (message: string) => out.push({ severity: 'warning', message });
  if (!g.invaders.length) err('There are no invaders.');
  if (!g.waves.length) err('There are no waves.');
  if (g.ship.speed <= 0 || g.ship.fireRate <= 0 || g.ship.shotSpeed <= 0) err('The ship needs a speed, a fire rate and a shot speed.');
  if (g.ship.lives < 1) err('The player needs at least one life.');
  const ids = new Set(g.invaders.map((i) => i.id));
  g.waves.forEach((w, i) => {
    if (!w.rows.length || w.cols < 1) err(`Wave ${i + 1} has no invaders.`);
    if (w.rows.some((r) => !ids.has(r))) err(`Wave ${i + 1} has a row of an invader that no longer exists.`);
    if (w.cols > MAX_COLS) err(`Wave ${i + 1} has ${w.cols} a row; the field has room for ${MAX_COLS}.`);
    if (w.rows.length > MAX_ROWS) err(`Wave ${i + 1} has ${w.rows.length} rows; ${MAX_ROWS} fit above the shields.`);
    if (w.speed <= 0) err(`Wave ${i + 1} doesn't move: give it a speed.`);
    if (w.drop <= 0) warn(`Wave ${i + 1} never steps down, so it can't reach the player.`);
  });
  for (const v of g.invaders) if (v.health < 1) err(`${v.name} needs at least 1 health.`);
  if (g.waves.length && g.invaders.length && g.invaders.every((v) => v.fire <= 0)) warn('No invader fires: nothing can cost the player a life but the formation landing.');
  if (g.shields.count > 8) warn('More than 8 shields leave no gaps to shoot through.');
  return out;
};
