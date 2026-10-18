import { FIELD, type ShooterGame } from './shooter';

/**
 * The arcade shooter running: the formation sweeps side to side, stepping
 * down at each side and speeding up as it thins; the lowest invader in each
 * column fires down; the ship fires up; shields soak hits from both sides.
 * One step function drives the play preview (a frame at a time, from the
 * keys) and the autopilot run (straight to the end), so what the designer
 * plays is what the numbers say. Random fire comes from a seed kept in the
 * state, so the same game runs the same.
 */

export interface SimInvader {
  invaderId: string;
  row: number;
  col: number;
  hp: number;
}

export interface Bullet {
  x: number;
  y: number;
}

export interface WaveStat {
  seconds: number;
  shots: number;
  hits: number;
  livesLost: number;
  score: number;
}

export interface ShooterState {
  t: number;
  wave: number;
  phase: 'running' | 'breather' | 'won' | 'lost';
  breatherLeft: number;
  /** Why the game was lost. */
  lostBy?: 'shot' | 'landed';
  shipX: number;
  cooldown: number;
  /** Seconds the ship can't be hit, after losing a life. */
  shielded: number;
  lives: number;
  score: number;
  nextLifeAt: number;
  invaders: SimInvader[];
  /** The formation's offset from where it started, and which way it is going. */
  fx: number;
  fy: number;
  dir: 1 | -1;
  shots: Bullet[];
  bombs: Bullet[];
  shields: number[];
  stats: WaveStat[];
  seed: number;
}

export interface Input {
  left: boolean;
  right: boolean;
  fire: boolean;
}

const HIT = { w: 0.45, h: 0.35 };
const SHIELD = { w: 0.8, h: 0.35 };
const SHIP = { w: 0.5, h: 0.4 };

/** mulberry32: the next random number in [0, 1) and the seed after it. */
const rand = (seed: number): [number, number] => {
  let t = (seed + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
};

const blankStat = (): WaveStat => ({ seconds: 0, shots: 0, hits: 0, livesLost: 0, score: 0 });

const formationFor = (g: ShooterGame, wave: number): SimInvader[] => {
  const w = g.waves[wave];
  if (!w) return [];
  const health = new Map(g.invaders.map((i) => [i.id, i.health]));
  return w.rows.flatMap((invaderId, row) => (health.has(invaderId) ? Array.from({ length: Math.max(0, Math.round(w.cols)) }, (_, col) => ({ invaderId, row, col, hp: health.get(invaderId)! })) : []));
};

/** Where an invader is on the field. */
export const invaderAt = (g: ShooterGame, s: ShooterState, v: SimInvader): [number, number] => {
  const cols = g.waves[s.wave]?.cols ?? 1;
  const left = (FIELD.width - (cols - 1) * FIELD.colGap) / 2;
  return [left + v.col * FIELD.colGap + s.fx, FIELD.formationTop + v.row * FIELD.rowGap + s.fy];
};

/** Where each shield is, left to right. */
export const shieldXs = (g: ShooterGame): number[] => Array.from({ length: g.shields.count }, (_, i) => (FIELD.width * (i + 1)) / (g.shields.count + 1));

/** A fresh game at the first wave. */
export const createShooterSim = (g: ShooterGame, seed = 1): ShooterState => ({
  t: 0,
  wave: 0,
  phase: g.waves.length ? 'running' : 'won',
  breatherLeft: 0,
  shipX: FIELD.width / 2,
  cooldown: 0,
  shielded: 0,
  lives: g.ship.lives,
  score: 0,
  nextLifeAt: g.rules.extraLifeEvery > 0 ? g.rules.extraLifeEvery : Infinity,
  invaders: formationFor(g, 0),
  fx: 0,
  fy: 0,
  dir: 1,
  shots: [],
  bombs: [],
  shields: Array.from({ length: g.shields.count }, () => g.shields.health),
  stats: g.waves.length ? [blankStat()] : [],
  seed,
});

/** The formation's sideways speed now: faster as it thins. */
export const formationSpeed = (g: ShooterGame, s: ShooterState): number => {
  const w = g.waves[s.wave];
  if (!w) return 0;
  const total = w.rows.length * w.cols;
  const gone = total ? 1 - s.invaders.length / total : 0;
  return w.speed * (1 + g.rules.speedUp * gone);
};

/** A bullet hits a shield: the shield takes it. Returns whether one did. */
const intoShield = (g: ShooterGame, s: ShooterState, b: Bullet, xs: number[]): boolean => {
  if (Math.abs(b.y - FIELD.shieldY) > SHIELD.h) return false;
  const i = xs.findIndex((x, k) => s.shields[k]! > 0 && Math.abs(b.x - x) <= SHIELD.w);
  if (i < 0) return false;
  s.shields[i]!--;
  return true;
};

/** Move the game on by dt seconds with what the player is pressing. Returns a new state; the old one is left as it was. */
export const stepShooter = (g: ShooterGame, prev: ShooterState, dt: number, input: Input): ShooterState => {
  if (prev.phase === 'won' || prev.phase === 'lost') return prev;
  const s: ShooterState = { ...prev, t: prev.t + dt, invaders: prev.invaders.map((v) => ({ ...v })), shots: prev.shots.map((b) => ({ ...b })), bombs: prev.bombs.map((b) => ({ ...b })), shields: [...prev.shields], stats: prev.stats.map((x) => ({ ...x })) };
  // The ship moves between waves too.
  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  s.shipX = Math.max(SHIP.w, Math.min(FIELD.width - SHIP.w, s.shipX + move * g.ship.speed * dt));
  if (s.phase === 'breather') {
    s.breatherLeft -= dt;
    if (s.breatherLeft > 0) return s;
    s.phase = 'running';
    s.invaders = formationFor(g, s.wave);
    s.fx = 0;
    s.fy = 0;
    s.dir = 1;
  }
  const wave = g.waves[s.wave]!;
  const stat = s.stats[s.wave]!;
  stat.seconds += dt;
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.shielded = Math.max(0, s.shielded - dt);
  if (input.fire && s.cooldown <= 0) {
    s.shots.push({ x: s.shipX, y: FIELD.shipY - SHIP.h });
    s.cooldown = 1 / Math.max(0.01, g.ship.fireRate);
    stat.shots++;
  }
  // The formation sweeps, and steps down at a side.
  s.fx += s.dir * formationSpeed(g, s) * dt;
  const xs = s.invaders.map((v) => invaderAt(g, s, v));
  const minX = Math.min(...xs.map((p) => p[0]));
  const maxX = Math.max(...xs.map((p) => p[0]));
  if (s.invaders.length && ((s.dir > 0 && maxX >= FIELD.width - 0.5) || (s.dir < 0 && minX <= 0.5))) {
    s.dir = s.dir > 0 ? -1 : 1;
    s.fy += wave.drop;
  }
  const shields = shieldXs(g);
  // Shots up.
  const byId = new Map(g.invaders.map((i) => [i.id, i]));
  s.shots = s.shots.filter((b) => {
    b.y -= g.ship.shotSpeed * dt;
    if (b.y < 0) return false;
    if (intoShield(g, s, b, shields)) return false;
    const v = s.invaders.find((x) => {
      if (x.hp <= 0) return false;
      const [ix, iy] = invaderAt(g, s, x);
      return Math.abs(ix - b.x) <= HIT.w && Math.abs(iy - b.y) <= HIT.h;
    });
    if (!v) return true;
    v.hp--;
    stat.hits++;
    if (v.hp <= 0) {
      const points = byId.get(v.invaderId)?.points ?? 0;
      s.score += points;
      stat.score += points;
    }
    return false;
  });
  s.invaders = s.invaders.filter((v) => v.hp > 0);
  // The lowest in each column fires.
  const lowest = new Map<number, SimInvader>();
  for (const v of s.invaders) if ((lowest.get(v.col)?.row ?? -1) < v.row) lowest.set(v.col, v);
  for (const v of lowest.values()) {
    const perSecond = ((byId.get(v.invaderId)?.fire ?? 0) * wave.fireScale) / 60;
    const [r, seed] = rand(s.seed);
    s.seed = seed;
    if (r < perSecond * dt) {
      const [x, y] = invaderAt(g, s, v);
      s.bombs.push({ x, y: y + HIT.h });
    }
  }
  // Bombs down.
  let hitNow = false;
  s.bombs = s.bombs.filter((b) => {
    b.y += g.rules.enemyShotSpeed * dt;
    if (b.y > FIELD.height) return false;
    if (intoShield(g, s, b, shields)) return false;
    if (Math.abs(b.x - s.shipX) <= SHIP.w && Math.abs(b.y - FIELD.shipY) <= SHIP.h) {
      if (s.shielded <= 0) {
        s.lives--;
        stat.livesLost++;
        s.shielded = 1.5;
        hitNow = true;
      }
      return false;
    }
    return true;
  });
  // A hit clears the air, as in the arcade.
  if (hitNow) s.bombs = [];
  // A life every so many points.
  while (s.score >= s.nextLifeAt) {
    s.lives++;
    s.nextLifeAt += g.rules.extraLifeEvery;
  }
  // Landed: the formation reached the ship's row.
  const low = Math.max(...s.invaders.map((v) => invaderAt(g, s, v)[1]));
  if (s.invaders.length && low >= FIELD.shipY - SHIP.h) {
    s.phase = 'lost';
    s.lostBy = 'landed';
    return s;
  }
  if (s.lives <= 0) {
    s.lives = 0;
    s.phase = 'lost';
    s.lostBy = 'shot';
    return s;
  }
  // Wave cleared.
  if (!s.invaders.length) {
    s.score += wave.bonus;
    stat.score += wave.bonus;
    s.shots = [];
    s.bombs = [];
    if (s.wave >= g.waves.length - 1) s.phase = 'won';
    else {
      s.wave++;
      s.stats.push(blankStat());
      s.phase = 'breather';
      s.breatherLeft = g.rules.breather;
    }
  }
  return s;
};

/**
 * A steady player: lines up under the nearest invader that can be hit,
 * leading the formation's sweep, sidesteps bombs about to land, and holds
 * fire under a standing shield. A guide to how hard the game is, not a
 * stand-in for playing it.
 */
export const autopilot = (g: ShooterGame, s: ShooterState): Input => {
  const none = { left: false, right: false, fire: false };
  if (s.phase !== 'running' && s.phase !== 'breather') return none;
  const x = s.shipX;
  // Bombs about to land near the ship: step away.
  const danger = s.bombs.filter((b) => b.y > FIELD.shipY - 3 && b.y < FIELD.shipY + 0.2 && Math.abs(b.x - x) < SHIP.w + 0.45);
  if (danger.length && s.shielded <= 0) {
    const from = danger.reduce((n, b) => n + b.x, 0) / danger.length;
    const goRight = from <= x ? x < FIELD.width - 1 : x < 1;
    return { left: !goRight, right: goRight, fire: false };
  }
  const shields = shieldXs(g);
  const underShield = shields.some((sx, k) => s.shields[k]! > 0 && Math.abs(x - sx) <= SHIELD.w + 0.05);
  // Aim where the target will be when the shot gets there.
  const lowest = new Map<number, SimInvader>();
  for (const v of s.invaders) if ((lowest.get(v.col)?.row ?? -1) < v.row) lowest.set(v.col, v);
  const vx = s.dir * formationSpeed(g, s);
  let aim: number | undefined;
  let best = Infinity;
  for (const v of lowest.values()) {
    const [ix, iy] = invaderAt(g, s, v);
    const lead = ix + vx * ((FIELD.shipY - iy) / g.ship.shotSpeed);
    const d = Math.abs(lead - x);
    if (d < best) {
      best = d;
      aim = lead;
    }
  }
  if (aim === undefined) return none;
  const fire = Math.abs(aim - x) <= HIT.w * 0.8 && !underShield;
  if (Math.abs(aim - x) < 0.1) return { left: false, right: false, fire };
  return { left: aim < x, right: aim > x, fire };
};

export interface ShooterRun {
  outcome: 'won' | 'lost' | 'timeout';
  lostBy?: 'shot' | 'landed';
  /** Waves cleared. */
  cleared: number;
  lives: number;
  score: number;
  seconds: number;
  stats: WaveStat[];
}

/** Let the autopilot play the whole game, as fast as it goes, and say how it went. Breathers are skipped. */
export const runShooter = (g: ShooterGame, seed = 1, dt = 1 / 30, maxSeconds = 1800): ShooterRun => {
  let s = createShooterSim(g, seed);
  while (s.phase !== 'won' && s.phase !== 'lost' && s.t < maxSeconds) {
    s = stepShooter(g, s, dt, autopilot(g, s));
    if (s.phase === 'breather') s = { ...s, breatherLeft: 0 };
  }
  const outcome = s.phase === 'won' ? 'won' : s.phase === 'lost' ? 'lost' : 'timeout';
  return { outcome, lostBy: s.lostBy, cleared: outcome === 'won' ? g.waves.length : s.wave, lives: s.lives, score: s.score, seconds: Math.round(s.t), stats: s.stats };
};

/** What each wave holds, on paper. */
export const shooterSheet = (g: ShooterGame) =>
  g.waves.map((w, i) => {
    let health = 0;
    let points = 0;
    let fire = 0;
    for (const id of w.rows) {
      const v = g.invaders.find((x) => x.id === id);
      if (!v) continue;
      health += v.health * w.cols;
      points += v.points * w.cols;
      fire = Math.max(fire, v.fire * w.fireScale);
    }
    return { wave: i + 1, count: w.rows.length * w.cols, health, points: points + w.bonus, topFire: Math.round(fire * 10) / 10 };
  });
